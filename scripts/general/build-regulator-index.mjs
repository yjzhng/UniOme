#!/usr/bin/env node
// Build a lightweight regulator index for the Regulation explorer: for every regulator that appears in the
// per-gene `regulatedBy` edges, record its own gene uniqID (nullable — small molecules/complexes) and its
// type (TF / sRNA / …). regulon_members.json already gives regulator→targets; this adds the per-regulator
// metadata the network needs without the API having to scan every gene file at request time.
//   regulation/regulators.json  { "<regulatorName>": { uniqID: string|null, type: string } }
// Reads only local files (no network). Run AFTER build-regulation / fetch-regulation.
//   node scripts/general/build-regulator-index.mjs [taxid=83333]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const regDir = resolve(RESOURCES, folder, 'regulation');
  const indexFile = resolve(regDir, 'index.json');
  if (!existsSync(indexFile)) { console.log(`[regulators] ${folder}: no regulation/index.json — skipping`); return; }

  const index = JSON.parse(readFileSync(indexFile, 'utf8')); // uniqID → summary
  const out = {}; // regulator name → { uniqID, type }
  for (const uid of Object.keys(index)) {
    let rec;
    try { rec = JSON.parse(readFileSync(resolve(regDir, `${uid}.json`), 'utf8')); } catch { continue; }
    for (const e of rec.regulatedBy ?? []) {
      if (!e?.name || out[e.name]) continue;
      out[e.name] = { uniqID: e.uniqID ?? null, type: e.regulatorType ?? 'other' };
    }
  }

  writeFileSync(resolve(regDir, 'regulators.json'), JSON.stringify(out));
  const byType = {};
  for (const v of Object.values(out)) byType[v.type] = (byType[v.type] ?? 0) + 1;
  console.log(`[regulators] ${folder}: ${Object.keys(out).length} regulators — ${Object.entries(byType).map(([t, n]) => `${t}:${n}`).join(', ')}`);
}

main();
