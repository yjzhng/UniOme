#!/usr/bin/env node
// One-time, build-time fetch of enzyme REACTIONS (catalytic activity) into resources/. Local-first.
//   • source: UniProt `cc_catalytic_activity` — curated catalytic-activity comments, each carrying a
//     reaction equation cross-referenced to Rhea (RHEA:…) and an EC number.
// Queried in accession batches via the UniProt search API (a few dozen requests for the proteome),
// then mapped to our CDS features by UniProt accession.
// Writes resources/<org>/proteins/reactions.json: { acc: [{ name, rhea, ec }] }
//
// Usage: node scripts/build-reactions.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const UA = 'Mozilla/5.0 (UniOme reactions fetcher; research/local-first)';
const BATCH = 100; // accessions per search query
const SEARCH = 'https://rest.uniprot.org/uniprotkb/search';

// Distinct UniProt accessions of CDS features in the org's *_DB.csv.
function cdsAccessions(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const accs = new Set();
  for (const r of rows) {
    if ((r.type ?? '').trim() === 'CDS') {
      const u = (r.UniProtID ?? '').trim();
      if (u) accs.add(u);
    }
  }
  return [...accs];
}

// One UniProt entry's catalytic-activity comments → our compact reaction records.
function reactionsOf(entry) {
  const out = [];
  for (const c of entry.comments ?? []) {
    if (c.commentType !== 'CATALYTIC ACTIVITY') continue;
    const rx = c.reaction;
    if (!rx?.name) continue;
    const rhea = (rx.reactionCrossReferences ?? []).find((x) => x.database === 'Rhea' && /^RHEA:\d+$/.test(x.id))?.id ?? null;
    out.push({ name: rx.name, rhea, ec: rx.ecNumber ?? null });
  }
  return out;
}

async function fetchBatch(accs) {
  const query = accs.map((a) => `accession:${a}`).join(' OR ');
  const url = `${SEARCH}?query=${encodeURIComponent(query)}&fields=accession,cc_catalytic_activity&format=json&size=${BATCH}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`UniProt search HTTP ${res.status}`);
  const json = await res.json();
  return json.results ?? [];
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const accs = cdsAccessions(folder);
  console.log(`[reactions] ${folder}: ${accs.length} CDS accessions, batch ${BATCH}`);

  const byAcc = {};
  let withRx = 0;
  for (let i = 0; i < accs.length; i += BATCH) {
    const batch = accs.slice(i, i + BATCH);
    let results;
    try {
      results = await fetchBatch(batch);
    } catch (err) {
      console.error(`[reactions] batch ${i / BATCH} FAILED — ${err.message}`);
      continue;
    }
    for (const entry of results) {
      const acc = entry.primaryAccession;
      const rxs = reactionsOf(entry);
      if (rxs.length) { byAcc[acc] = rxs; withRx++; }
    }
    process.stdout.write(`\r[reactions] ${Math.min(i + BATCH, accs.length)}/${accs.length} fetched · ${withRx} with reactions`);
  }
  process.stdout.write('\n');

  const sorted = Object.fromEntries(Object.keys(byAcc).sort().map((k) => [k, byAcc[k]]));
  const out = resolve(RESOURCES, folder, 'proteins', 'reactions.json');
  writeFileSync(out, JSON.stringify(sorted, null, 0) + '\n');
  console.log(`[reactions] wrote ${out} — ${withRx} enzymes`);
}

main().catch((e) => { console.error(e); process.exit(1); });
