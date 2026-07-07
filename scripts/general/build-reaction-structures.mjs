#!/usr/bin/env node
// Enriches the reactions index with 2D structure data, for the structural reaction viewer.
//   • For each reaction's Rhea id → participant ChEBI ids, in equation order (Rhea TSV API).
//   • For each distinct ChEBI id → 2D structure SMILES + R-group flag (ChEBI backend API).
// Rewrites resources/<org>/proteins/reactions.json with each reaction split into
//   left/right participants ({ name, chebi }), and writes resources/<org>/proteins/chebi.json
//   { "CHEBI:nnnnn": { smiles, rgroup } } (SMILES deduplicated across reactions).
//
// Prerequisite: scripts/build-reactions.mjs (produces reactions.json with name/rhea/ec).
// Usage: node scripts/build-reaction-structures.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const UA = 'Mozilla/5.0 (UniOme reaction-structures fetcher; research/local-first)';
const RHEA_BATCH = 50;
const CHEBI_BATCH = 50;
const RHEA_SEARCH = 'https://www.rhea-db.org/rhea';
const CHEBI_BATCH_API = 'https://www.ebi.ac.uk/chebi/backend/api/public/compounds/';

// Split a UniProt/Rhea equation into substrate + product tokens (the participant order matches
// the Rhea chebi-id list). Returns null when it isn't a standard "A = B" equation.
function splitEquation(name) {
  const sides = name.replace(/\.$/, '').split(' = ');
  if (sides.length !== 2) return null;
  return { left: sides[0].split(' + '), right: sides[1].split(' + ') };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
  return res.text();
}

// rheaId → ordered [chebiId, …] for a batch of Rhea ids.
async function fetchRheaChebis(rheaIds) {
  const query = rheaIds.join(' OR ');
  const url = `${RHEA_SEARCH}?query=${encodeURIComponent(query)}&columns=rhea-id,chebi-id&format=tsv`;
  const tsv = await getText(url);
  const out = new Map();
  for (const line of tsv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [rid, chebis] = line.split('\t');
    out.set(rid.trim(), (chebis ?? '').split(';').map((c) => c.trim()).filter(Boolean));
  }
  return out;
}

// chebiId → { smiles, rgroup } for a batch of ChEBI ids.
async function fetchChebiStructures(chebiIds) {
  const url = `${CHEBI_BATCH_API}?chebi_ids=${encodeURIComponent(chebiIds.join(','))}`;
  const json = await getJson(url);
  const out = new Map();
  for (const [id, rec] of Object.entries(json)) {
    const st = rec?.data?.default_structure;
    if (st?.smiles) out.set(id, { smiles: st.smiles, rgroup: !!st.is_r_group });
  }
  return out;
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const rxPath = resolve(RESOURCES, folder, 'proteins', 'reactions.json');
  const byAcc = JSON.parse(readFileSync(rxPath, 'utf8'));

  // 1) distinct Rhea ids → ChEBI id lists.
  const rheaIds = [...new Set(Object.values(byAcc).flat().map((r) => r.rhea).filter(Boolean))];
  console.log(`[structures] ${rheaIds.length} distinct Rhea reactions → fetching participants`);
  const rheaChebis = new Map();
  for (let i = 0; i < rheaIds.length; i += RHEA_BATCH) {
    try {
      const m = await fetchRheaChebis(rheaIds.slice(i, i + RHEA_BATCH));
      for (const [k, v] of m) rheaChebis.set(k, v);
    } catch (e) { console.error(`\n[structures] rhea batch ${i} — ${e.message}`); }
    process.stdout.write(`\r[structures] rhea ${Math.min(i + RHEA_BATCH, rheaIds.length)}/${rheaIds.length}`);
  }
  process.stdout.write('\n');

  // 2) split each reaction into left/right participants, attaching ChEBI ids positionally.
  const chebiSet = new Set();
  let aligned = 0, total = 0;
  for (const reactions of Object.values(byAcc)) {
    for (const r of reactions) {
      total++;
      const parts = splitEquation(r.name);
      if (!parts) { r.left = []; r.right = []; continue; }
      const chebis = r.rhea ? rheaChebis.get(r.rhea) ?? [] : [];
      const flat = [...parts.left, ...parts.right];
      const ok = chebis.length === flat.length;
      if (ok) aligned++;
      const mk = (token, idx) => {
        const chebi = ok ? chebis[idx] : null;
        if (chebi) chebiSet.add(chebi);
        return { name: token, chebi };
      };
      r.left = parts.left.map((t, i) => mk(t, i));
      r.right = parts.right.map((t, i) => mk(t, parts.left.length + i));
    }
  }
  console.log(`[structures] ${aligned}/${total} reactions aligned to ChEBI participants · ${chebiSet.size} distinct compounds`);

  // 3) distinct ChEBI ids → SMILES.
  const chebiIds = [...chebiSet];
  const chebiMap = {};
  for (let i = 0; i < chebiIds.length; i += CHEBI_BATCH) {
    try {
      const m = await fetchChebiStructures(chebiIds.slice(i, i + CHEBI_BATCH));
      for (const [k, v] of m) chebiMap[k] = v;
    } catch (e) { console.error(`\n[structures] chebi batch ${i} — ${e.message}`); }
    process.stdout.write(`\r[structures] chebi ${Math.min(i + CHEBI_BATCH, chebiIds.length)}/${chebiIds.length}`);
  }
  process.stdout.write('\n');

  writeFileSync(rxPath, JSON.stringify(byAcc, null, 0) + '\n');
  const chebiOut = resolve(RESOURCES, folder, 'proteins', 'chebi.json');
  const sortedChebi = Object.fromEntries(Object.keys(chebiMap).sort().map((k) => [k, chebiMap[k]]));
  writeFileSync(chebiOut, JSON.stringify(sortedChebi, null, 0) + '\n');
  console.log(`[structures] wrote ${rxPath}\n[structures] wrote ${chebiOut} — ${Object.keys(chebiMap).length} structures`);
}

main().catch((e) => { console.error(e); process.exit(1); });
