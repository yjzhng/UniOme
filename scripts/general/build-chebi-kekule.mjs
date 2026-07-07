#!/usr/bin/env node
// Replaces the stored ChEBI SMILES (lowercase-aromatic, which smiles-drawer renders with an
// aromaticity circle) with PubChem's Kekulé SMILES (explicit alternating double bonds), mapped via
// the ChEBI registry-id cross-reference. Keeps the same compound/protonation (PubChem CID is the
// one PubChem assigns to that ChEBI id) and the existing `rgroup` flag; falls back to the current
// SMILES when PubChem has no entry. Rewrites resources/<org>/proteins/chebi.json.
//
// Usage: node scripts/build-chebi-kekule.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const UA = 'Mozilla/5.0 (UniOme chebi-kekule fetcher; research/local-first)';
const CONCURRENCY = 5;
const PUG = (chebi) => `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/xref/RegistryID/${chebi}/property/SMILES/JSON`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// Kekulé SMILES for one ChEBI id (null if PubChem has no mapping), with light retry on throttling.
async function kekuleSmiles(chebi) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await fetch(PUG(chebi), { headers: { 'User-Agent': UA, Accept: 'application/json' } }); }
    catch { await sleep(500 * (attempt + 1)); continue; }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status === 503) { await sleep(800 * (attempt + 1)); continue; }
    if (!res.ok) return null;
    const j = await res.json();
    return j?.PropertyTable?.Properties?.[0]?.SMILES ?? null;
  }
  return null;
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const path = resolve(RESOURCES, folder, 'proteins', 'chebi.json');
  const chebi = JSON.parse(readFileSync(path, 'utf8'));
  const ids = Object.keys(chebi);
  console.log(`[kekule] ${ids.length} ChEBI compounds → PubChem Kekulé SMILES (concurrency ${CONCURRENCY})`);

  let updated = 0, missed = 0, done = 0;
  await pool(ids, CONCURRENCY, async (id) => {
    const smi = await kekuleSmiles(id);
    if (smi) { chebi[id].smiles = smi; updated++; } else { missed++; }
    if (++done % 100 === 0 || done === ids.length) process.stdout.write(`\r[kekule] ${done}/${ids.length} · ${updated} updated · ${missed} kept`);
  });
  process.stdout.write('\n');

  const sorted = Object.fromEntries(Object.keys(chebi).sort().map((k) => [k, chebi[k]]));
  writeFileSync(path, JSON.stringify(sorted, null, 0) + '\n');
  console.log(`[kekule] wrote ${path} — ${updated} kekulé, ${missed} unchanged`);
}

main().catch((e) => { console.error(e); process.exit(1); });
