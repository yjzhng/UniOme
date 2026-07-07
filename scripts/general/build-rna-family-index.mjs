#!/usr/bin/env node
// Build the Rfam-family → member-genes index for the Relationships "shared family" (RNA) view
// (RNA genes sharing an Rfam family). No network: reads resources/<org>/rna/index.json
// (uniqID → URS), resources/<org>/rna/features/<URS>.json (rfam.acc/id), and the _DB.csv
// (uniqID → gene), writes (under resources/<org>/relationship/):
//   family_members.json  { rfamAcc: { id, name, link, members:[{name,uniqID}] } }
//   gene_family.json      { uniqID: [{ acc }] }
// The RNA viewer's Family track uses a single fixed colour, so no colorIndex is stored.
//
// Usage: node scripts/build-rna-family-index.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const RFAM = (acc) => `https://rfam.org/family/${acc}`;

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const rnaDir = resolve(RESOURCES, folder, 'rna');
  const indexFile = resolve(rnaDir, 'index.json');
  if (!existsSync(indexFile)) throw new Error(`no rna/index.json in ${folder}`);
  const index = JSON.parse(readFileSync(indexFile, 'utf8')); // uniqID → {urs,taxid}

  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const geneOf = new Map(); // uniqID → display name
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    if (uniqID) geneOf.set(uniqID, (r.gene ?? '').trim() || uniqID);
  }

  // Cache rfam per URS (multiple uniqIDs can map to the same URS).
  const rfamOf = new Map(); // urs → {acc,id} | null
  const readRfam = (urs) => {
    if (rfamOf.has(urs)) return rfamOf.get(urs);
    let rf = null;
    try {
      const doc = JSON.parse(readFileSync(resolve(rnaDir, 'features', `${urs}.json`), 'utf8'));
      if (doc?.rfam?.acc) rf = { acc: doc.rfam.acc, id: doc.rfam.id ?? doc.rfam.acc };
    } catch { /* no features file */ }
    rfamOf.set(urs, rf);
    return rf;
  };

  const familyMembers = {}; // rfamAcc → {id,name,link,members}
  const geneFamily = {}; // uniqID → [{acc}]
  const memberSeen = new Map(); // rfamAcc → Set(uniqID)

  for (const [uniqID, hit] of Object.entries(index)) {
    const rf = hit?.urs ? readRfam(hit.urs) : null;
    if (!rf) continue;
    const entry = (familyMembers[rf.acc] ??= { id: rf.acc, name: rf.id, link: RFAM(rf.acc), members: [] });
    const ms = memberSeen.get(rf.acc) ?? memberSeen.set(rf.acc, new Set()).get(rf.acc);
    if (!ms.has(uniqID)) { ms.add(uniqID); entry.members.push({ name: geneOf.get(uniqID) ?? uniqID, uniqID }); }
    (geneFamily[uniqID] ??= []).push({ acc: rf.acc });
  }

  const outDir = resolve(RESOURCES, folder, 'relationship');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'family_members.json'), JSON.stringify(familyMembers, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'gene_family.json'), JSON.stringify(geneFamily, null, 2) + '\n');
  console.log(`[rna-family] ${Object.keys(familyMembers).length} Rfam families, ${Object.keys(geneFamily).length} RNA genes → ${folder}/relationship/`);
}

main();
