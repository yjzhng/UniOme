#!/usr/bin/env node
// One-time, build-time fetch of ESSENTIALITY for S. aureus NCTC 8325 into resources/. Local-first.
// Source: DEG (Database of Essential Genes, http://tubic.org/deg), set DEG1061 = Coe et al. 2019
// "Multi-strain Tn-Seq reveals common daptomycin resistance determinants in S. aureus" (PLoS Pathog).
// This is a genome-wide Tn-seq screen done directly on NCTC 8325 (NC_007795.1), so every essential
// record carries a `locus_tag: SAOUHSC_#####` field that maps 1:1 onto our feature locus_tag — no
// gene-symbol crosswalk needed. Because the screen is genome-wide, we treat the DEG essential set as
// the positive list and call every OTHER CDS in our DB "non-essential" (mirrors the Mtb build, which
// emits both calls across the assayed genome). The DEG bacteria index lists other NCTC 8325 sets too
// (e.g. DEG1017 = Chaudhuri 2009 TMDH, gene/UniProt-keyed); DEG1061 is preferred as the directly
// locus-keyed modern Tn-seq study. CAVEAT: DEG1061 is rich-medium (MHBII) Tn-seq, so "essential" means
// required for growth in rich medium; conditional essentials are out of scope.
// Writes resources/<org>/essentiality/tnseq.json: { uniqID: { call, source } }
//
// Data file: a one-time download of the DEG protein annotation table cached under
// resources/<org>/_assets/deg_annotation_p.csv (semicolon-delimited, quoted). If absent it is fetched.
//
// Usage: node scripts/organisms/93061_Sa/build-essentiality.mjs [taxid=93061]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, orgDir, findDb } from '../../lib/org.mjs';

const DEG_URL = 'http://tubic.org/deg/public/download/deg_annotation_p.csv.zip';
const DEG_SET = 'DEG1061'; // Coe 2019 Tn-seq, NCTC 8325
const SOURCE = 'Coe 2019 (Tn-seq, via DEG)';

// DEG annotation columns (semicolon-delimited, no header): [0]=set id, [2]=gene, [10]=note (may carry
// "locus_tag: SAOUHSC_#####"), among others.
const COL_SET = 0;
const COL_NOTE = 10;

async function loadDegAnnotation(folder) {
  const cached = resolve(RESOURCES, folder, '_assets', 'deg_annotation_p.csv');
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  // Fallback: fetch + unzip on the fly (kept simple; the repo caches the CSV so this rarely runs).
  const { execFileSync } = await import('node:child_process');
  const zip = resolve(RESOURCES, folder, '_assets', 'deg_annotation_p.csv.zip');
  mkdirSync(resolve(RESOURCES, folder, '_assets'), { recursive: true });
  const buf = Buffer.from(await (await fetch(DEG_URL)).arrayBuffer());
  writeFileSync(zip, buf);
  execFileSync('unzip', ['-o', '-j', zip, 'deg_annotation_p.csv', '-d', resolve(RESOURCES, folder, '_assets')]);
  return readFileSync(cached, 'utf8');
}

async function main() {
  const taxid = process.argv[2] || '93061';
  const folder = orgFolder(taxid);

  // locus_tag (SAOUHSC_#####) -> uniqID
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const cds = rows.filter((r) => (r.type ?? '').trim() === 'CDS' && (r.locus_tag ?? '').trim());
  const uniqByLocus = new Map(cds.map((r) => [r.locus_tag.trim(), (r.uniqID ?? '').trim()]));

  const txt = await loadDegAnnotation(folder);
  const deg = Papa.parse(txt, { delimiter: ';', quoteChar: '"', skipEmptyLines: true }).data;
  const set = deg.filter((r) => r[COL_SET] === DEG_SET);
  if (set.length === 0) throw new Error(`DEG set ${DEG_SET} not found in annotation table`);

  // Collect the essential uniqIDs by parsing "locus_tag: SAOUHSC_#####" out of the note column.
  const essentialUniq = new Set();
  let matched = 0, unmatched = 0;
  for (const r of set) {
    const m = (r[COL_NOTE] ?? '').match(/locus_tag:\s*(SAOUHSC_\d+)/i);
    if (!m) { unmatched++; continue; }
    const uniq = uniqByLocus.get(m[1]);
    if (!uniq) { unmatched++; continue; } // in DEG but not in our DB
    essentialUniq.add(uniq);
    matched++;
  }
  console.log(`[essentiality] DEG ${DEG_SET}: ${set.length} essential genes; ${matched} mapped, ${unmatched} unmatched`);

  // Genome-wide screen: every CDS gets a call; essential if in the DEG set, else non-essential.
  const out = {};
  let ess = 0;
  for (const r of cds) {
    const uniq = (r.uniqID ?? '').trim();
    if (!uniq) continue;
    const call = essentialUniq.has(uniq) ? 'essential' : 'non-essential';
    if (call === 'essential') ess++;
    out[uniq] = { call, source: SOURCE };
  }

  const dir = resolve(orgDir(taxid), 'essentiality');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'tnseq.json'), JSON.stringify(out) + '\n');
  console.log(`[essentiality] ${Object.keys(out).length} features (${ess} essential) → ${folder}/essentiality/tnseq.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
