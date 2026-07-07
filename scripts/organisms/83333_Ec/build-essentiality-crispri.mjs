#!/usr/bin/env node
// One-time, build-time fetch of gene/RNA ESSENTIALITY from a genome-wide CRISPRi screen, used as
// the FALLBACK source where EcoCyc has no knockout-growth call (notably all RNA loci — rRNA/tRNA/
// sRNA — and the ~100 CDS EcoCyc never assayed). Local-first.
//
// Source: high-throughput CRISPRi in E. coli K-12 MG1655 (our exact strain) — "Systematic
//   genome-wide querying of coding and non-coding functional elements in E. coli using CRISPRi"
//   (bioRxiv 2020.03.04.975888). Per-feature fitness is derived from two supplementary
//   sheets, joined on the sgRNA variable-region sequence:
//     Table 1  "sgRNA annotations (1a)" → seq → gene name + bnumber (gene-targeting guides only)
//     Table 10 "End-point averaged,merged (10c)" → seq → replicate-averaged fitness (log-ratio of
//              guide abundance) in LB (rich) and M9 (minimal), aerobic, with edgeR FDR.
//   Data repo: https://github.com/hsrishi/HT-CRISPRi (paper/SupplementaryTables.zip).
//
// Per feature: median fitness across its guides. Call mirrors EcoCyc's rich/minimal logic so the two
// sources are comparable:
//   essential   = strong depletion in LB (rich)         : LB ≤ -2 and FDR < 0.05
//   conditional = tolerated in LB but depleted in M9     : M9 ≤ -2 and FDR < 0.05 (auxotroph-like)
//   non-essential = otherwise
// The -2 cutoff sits in the empty valley of a cleanly bimodal distribution (essential mode ≈ -5,
// neutral mode ≈ 0); validated: ftsZ/dnaA/murA essential, thrA conditional, rnpB/ffs/ssrA essential
// sRNAs, ssrS/oxyS/ryhB non-essential sRNAs.
//
// CAVEAT (surfaced in the UI): a single-locus knockdown cannot reveal essentiality for features with
// paralogous redundancy — the 7 rRNA operons and redundant tRNA isoacceptors read "non-essential"
// because sister copies compensate. dCas9 is also polar (represses downstream of an operon-internal
// target). The honest signal is for single-copy ncRNAs (rnpB, ffs, ssrA, …).
//
// Writes resources/<org>/essentiality/crispri.json: { uniqID: { call, lb, m9 } }
//
// Usage: node scripts/build-essentiality-crispri.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import Papa from 'papaparse';
import XLSX from 'xlsx';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const ZIP_URL = 'https://raw.githubusercontent.com/hsrishi/HT-CRISPRi/master/paper/SupplementaryTables.zip';
const FIT_THRESHOLD = -2; // log-ratio cutoff for "strong depletion"
const FDR_MAX = 0.05;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Download + unzip the supplementary tables once into the org's _assets cache.
function ensureTables(cacheDir) {
  const zip = resolve(cacheDir, 'crispri_supp.zip');
  const t1 = resolve(cacheDir, 'Supplementary_Table_1.xlsx');
  const t10 = resolve(cacheDir, 'Supplementary_Table_10.xlsx');
  if (existsSync(t1) && existsSync(t10)) return { t1, t10 };
  if (!existsSync(zip)) {
    console.log('[crispri] downloading supplementary tables (~30 MB)…');
    execSync(`curl -sL -o "${zip}" "${ZIP_URL}"`, { stdio: 'inherit' });
  }
  console.log('[crispri] extracting Table 1 + Table 10…');
  execSync(`unzip -o -q "${zip}" "Supplementary_Table_1.xlsx" "Supplementary_Table_10.xlsx" -d "${cacheDir}"`, { stdio: 'inherit' });
  if (!existsSync(t1) || !existsSync(t10)) throw new Error('extraction failed — tables not found in zip');
  return { t1, t10 };
}

// seq → { gene, bnum } for gene-targeting guides (skip promoter/TFBS guides).
function readGuideTargets(path) {
  const ws = XLSX.readFile(path).Sheets['sgRNA annotations (1a)'];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const map = new Map();
  for (const r of rows) {
    const cat = String(r['category'] ?? '');
    if (!/gene/i.test(cat)) continue;
    const gene = r['gene name'];
    if (gene == null) continue;
    map.set(String(r['seq']), { gene: String(gene).trim(), bnum: r['bnumber'] == null ? null : String(r['bnumber']).trim() });
  }
  return map;
}

// seq → { lb, m9, lbFdr, m9Fdr }. Header is on the 2nd row (range:1), behind a grouping row.
function readGuideFitness(path) {
  const ws = XLSX.readFile(path).Sheets['End-point averaged,merged (10c)'];
  const rows = XLSX.utils.sheet_to_json(ws, { range: 1, defval: null });
  const num = (v) => (typeof v === 'number' ? v : v == null || v === '' ? null : Number(v));
  const map = new Map();
  for (const r of rows) {
    if (r['seq'] == null) continue;
    map.set(String(r['seq']), { lb: num(r['LB_ae_avgLR']), m9: num(r['M9_ae_avgLR']), lbFdr: num(r['LB_ae_FDR']), m9Fdr: num(r['M9_ae_FDR']) });
  }
  return map;
}

// Depleted in both media → essential; LB only (rescued by slow growth) → conditional (fast growth);
// M9 only (rescued by nutrients) → conditional (starvation); neither → non-essential.
function classify(lb, lbFdr, m9, m9Fdr) {
  const lbDep = lb != null && lb <= FIT_THRESHOLD && (lbFdr == null || lbFdr < FDR_MAX);
  const m9Dep = m9 != null && m9 <= FIT_THRESHOLD && (m9Fdr == null || m9Fdr < FDR_MAX);
  if (lbDep && m9Dep) return 'essential';
  if (lbDep) return 'conditional-fastgrowth';
  if (m9Dep) return 'conditional-starvation';
  return 'non-essential';
}

async function main() {
  const taxid = process.argv[2];
  if (!taxid) throw new Error('usage: node scripts/build-essentiality-crispri.mjs <taxid>');
  const folder = orgFolder(taxid);

  const cacheDir = resolve(RESOURCES, folder, '_assets');
  mkdirSync(cacheDir, { recursive: true });
  const { t1, t10 } = ensureTables(cacheDir);

  const targets = readGuideTargets(t1);
  const fitness = readGuideFitness(t10);

  // Aggregate guides per feature (keyed by bnumber when present, else gene name).
  const agg = new Map(); // key → { gene, bnum, lb:[], m9:[], lbFdr:[], m9Fdr:[] }
  for (const [seq, { gene, bnum }] of targets) {
    const f = fitness.get(seq);
    if (!f) continue;
    const key = bnum || gene;
    let e = agg.get(key);
    if (!e) { e = { gene, bnum, lb: [], m9: [], lbFdr: [], m9Fdr: [] }; agg.set(key, e); }
    if (f.lb != null) { e.lb.push(f.lb); e.lbFdr.push(f.lbFdr ?? 1); }
    if (f.m9 != null) { e.m9.push(f.m9); e.m9Fdr.push(f.m9Fdr ?? 1); }
  }

  // Map to our features: by locus_tag (= bnumber) first, then gene name.
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const dbRows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const byLocus = new Map();
  const byGene = new Map();
  for (const r of dbRows) {
    const lt = (r.locus_tag ?? '').trim();
    const gn = (r.gene ?? '').trim();
    const u = (r.uniqID ?? '').trim();
    if (lt) byLocus.set(lt, u);
    if (gn && !byGene.has(gn.toLowerCase())) byGene.set(gn.toLowerCase(), u);
  }

  const out = {};
  const calls = {};
  let viaBnum = 0, viaGene = 0, unmapped = 0;
  for (const e of agg.values()) {
    const lb = median(e.lb), m9 = median(e.m9);
    const call = classify(lb, median(e.lbFdr), m9, median(e.m9Fdr));
    let uniq = e.bnum ? byLocus.get(e.bnum) : undefined;
    if (uniq) viaBnum++;
    else if ((uniq = byGene.get(e.gene.toLowerCase()))) viaGene++;
    else { unmapped++; continue; }
    out[uniq] = { call, lb: lb == null ? null : Math.round(lb * 100) / 100, m9: m9 == null ? null : Math.round(m9 * 100) / 100 };
    calls[call] = (calls[call] ?? 0) + 1;
  }

  const outDir = resolve(RESOURCES, folder, 'essentiality');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'crispri.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`[crispri] ${Object.keys(out).length} features → ${folder}/essentiality/crispri.json`, calls);
  console.log(`[crispri] mapped: ${viaBnum} by locus_tag, ${viaGene} by gene name; ${unmapped} unmapped`);
}

main().catch((e) => { console.error(e); process.exit(1); });
