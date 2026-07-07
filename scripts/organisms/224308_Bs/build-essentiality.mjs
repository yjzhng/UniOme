#!/usr/bin/env node
// One-time, build-time fetch of ESSENTIALITY for B. subtilis 168 into resources/. Local-first.
// Source: DEG (Database of Essential Genes, http://tubic.org/deg), set DEG1001 = Kobayashi et al. 2003
// "Essential Bacillus subtilis genes" (PNAS 100:4678-83) — the classic genome-wide single-gene
// knockout study, 271 essential genes on NC_000964. UPGRADE PATH: Koo et al. 2017 (Cell Systems) and
// the SubtiWiki essential-gene category are BSU-keyed alternatives; wire one in if a cleaner copy of
// their table is obtained.
//
// Mapping: DEG1001 records carry no BSU locus_tag, but they do carry a gene symbol (col 2) and one or
// more UniProt accessions (col 12). We map UniProt->uniqID first (highest fidelity) and fall back to
// gene symbol. The UniProt field can list two accessions (e.g. "P31113 A3F3D8" for menH/ubiE/menG); we
// try each token. This reaches 271/271. Because the knockout study is genome-wide, we treat the DEG
// essential set as the positive list and call every OTHER CDS in our DB "non-essential" (mirrors the
// Mtb build). CAVEAT: rich-medium essentiality; conditional essentials are out of scope. NOTE: our DB
// locus_tags are BSU_##### (underscore) — we don't key on locus here, but the normalization helper is
// retained for any future BSU#####-keyed source.
// Writes resources/<org>/essentiality/tnseq.json: { uniqID: { call, source } }
//
// Data file: a one-time download of the DEG protein annotation table cached under
// resources/<org>/_assets/deg_annotation_p.csv (semicolon-delimited, quoted). If absent it is fetched.
//
// Usage: node scripts/organisms/224308_Bs/build-essentiality.mjs [taxid=224308]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, orgDir, findDb } from '../../lib/org.mjs';

const DEG_URL = 'http://tubic.org/deg/public/download/deg_annotation_p.csv.zip';
const DEG_SET = 'DEG1001'; // Kobayashi 2003 knockout, B. subtilis 168
const SOURCE = 'Kobayashi 2003 (knockout, via DEG)';

// DEG annotation columns (semicolon-delimited, no header): [0]=set id, [2]=gene, [12]=UniProt acc(s).
const COL_SET = 0;
const COL_GENE = 2;
const COL_UNIPROT = 12;

// Normalize a BSU locus_tag to the underscore form our DB uses (BSU_#####). Retained for future
// BSU#####-keyed sources; not used by the UniProt/gene mapping below.
function normLocus(lt) {
  const m = (lt ?? '').trim().match(/^BSU_?(\d+)$/i);
  return m ? `BSU_${m[1]}` : (lt ?? '').trim();
}

async function loadDegAnnotation(folder) {
  const cached = resolve(RESOURCES, folder, '_assets', 'deg_annotation_p.csv');
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const { execFileSync } = await import('node:child_process');
  const zip = resolve(RESOURCES, folder, '_assets', 'deg_annotation_p.csv.zip');
  mkdirSync(resolve(RESOURCES, folder, '_assets'), { recursive: true });
  const buf = Buffer.from(await (await fetch(DEG_URL)).arrayBuffer());
  writeFileSync(zip, buf);
  execFileSync('unzip', ['-o', '-j', zip, 'deg_annotation_p.csv', '-d', resolve(RESOURCES, folder, '_assets')]);
  return readFileSync(cached, 'utf8');
}

async function main() {
  const taxid = process.argv[2] || '224308';
  const folder = orgFolder(taxid);

  // Build UniProt->uniqID and gene->uniqID lookups over our CDS rows.
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const cds = rows.filter((r) => (r.type ?? '').trim() === 'CDS' && (r.locus_tag ?? '').trim());
  const uniqByUP = new Map();
  const uniqByGene = new Map();
  for (const r of cds) {
    const uniq = (r.uniqID ?? '').trim();
    const up = (r.UniProtID ?? '').trim();
    const g = (r.gene ?? '').trim().toLowerCase();
    if (up && !uniqByUP.has(up)) uniqByUP.set(up, uniq);
    if (g && !uniqByGene.has(g)) uniqByGene.set(g, uniq);
  }
  void normLocus; // available for future locus-keyed sources

  const txt = await loadDegAnnotation(folder);
  const deg = Papa.parse(txt, { delimiter: ';', quoteChar: '"', skipEmptyLines: true }).data;
  const set = deg.filter((r) => r[COL_SET] === DEG_SET);
  if (set.length === 0) throw new Error(`DEG set ${DEG_SET} not found in annotation table`);

  const essentialUniq = new Set();
  let matched = 0; const unmatched = [];
  for (const r of set) {
    let uniq;
    for (const tok of (r[COL_UNIPROT] ?? '').trim().split(/\s+/)) {
      if (tok && uniqByUP.has(tok)) { uniq = uniqByUP.get(tok); break; }
    }
    if (!uniq) {
      const g = (r[COL_GENE] ?? '').trim().toLowerCase();
      if (g && g !== '-' && uniqByGene.has(g)) uniq = uniqByGene.get(g);
    }
    if (!uniq) { unmatched.push(`${r[COL_GENE]}/${r[COL_UNIPROT]}`); continue; }
    essentialUniq.add(uniq);
    matched++;
  }
  console.log(`[essentiality] DEG ${DEG_SET}: ${set.length} essential genes; ${matched} mapped, ${unmatched.length} unmatched`);
  if (unmatched.length) console.log(`[essentiality] unmatched: ${unmatched.join(', ')}`);

  // Genome-wide knockout study: every CDS gets a call; essential if in the DEG set, else non-essential.
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
