#!/usr/bin/env node
// One-time, build-time fetch of ESSENTIALITY for M. tuberculosis into resources/. Local-first.
// Source: MtbTnDB consolidated binary matrix (github.com/ajinich/mtb_tn_db, data/SI_datasets/SI_bin.csv),
// keyed by Rv id = our H37Rv locus_tag. The matrix has one column per Tn-seq study; most columns are
// condition-specific differential screens (NOT a core-essential call — e.g. dnaA is flagged in only
// one of 40), so a naive all-study vote is wrong. We use the one clean genome-wide IN-VITRO essential
// gene column: `2003A_Sassetti` (Sassetti, Boyd & Rubin 2003 — the classic Himar1 essential genome,
// ~614 genes incl. dnaA). UPGRADE PATH: DeJesus et al. 2017 Table S3 (ES/ESD/GD/GA/NE per Rv) is the
// modern gold standard but its XLSX is hotlink-blocked on NCBI — wire it once a reliable copy exists.
// Writes resources/<org>/essentiality/tnseq.json: { uniqID: { call, source } }
//
// Usage: node scripts/organisms/83332_Mtb/build-essentiality.mjs [taxid=83332]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, findDb } from '../../lib/org.mjs';

const SI_BIN = 'https://raw.githubusercontent.com/ajinich/mtb_tn_db/master/data/SI_datasets/SI_bin.csv';
const UA = 'Mozilla/5.0 (UniOme essentiality fetcher; research/local-first)';
const COL = '2003A_Sassetti'; // the genome-wide in-vitro essential-gene column
const SOURCE = 'Sassetti 2003 (Tn-seq, via MtbTnDB)';

async function main() {
  const taxid = process.argv[2] || '83332';
  const folder = orgFolder(taxid);

  // Rv (locus_tag) → uniqID
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const uniqByLocus = new Map(rows.filter((r) => (r.locus_tag ?? '').trim()).map((r) => [(r.locus_tag).trim(), (r.uniqID ?? '').trim()]));

  const csv = await (await fetch(SI_BIN, { headers: { 'User-Agent': UA } })).text();
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  if (!(parsed.meta.fields ?? []).includes(COL)) throw new Error(`MtbTnDB column "${COL}" not found`);
  console.log(`[essentiality] MtbTnDB: ${parsed.data.length} genes; using ${COL}`);

  const out = {};
  let ess = 0;
  for (const row of parsed.data) {
    const uniq = uniqByLocus.get((row.Rv_ID ?? '').trim());
    const cell = (row[COL] ?? '').trim();
    if (!uniq || cell === '') continue; // not in our DB, or not assayed
    const call = Number(cell) === 1 ? 'essential' : 'non-essential';
    if (call === 'essential') ess++;
    out[uniq] = { call, source: SOURCE };
  }

  const dir = resolve(RESOURCES, folder, 'essentiality');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'tnseq.json'), JSON.stringify(out) + '\n');
  console.log(`[essentiality] ${Object.keys(out).length} features (${ess} essential) → ${folder}/essentiality/tnseq.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
