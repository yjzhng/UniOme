#!/usr/bin/env node
// One-time, build-time fetch of molecular INTERACTIONS into resources/. Local-first: runs
// once, then UniOme serves from disk.
//
// INTERACTIONS = molecular only (physical / predicted-physical). Regulatory relationships are
// a DIFFERENT concept and live in scripts/fetch-regulation.mjs (RegulonDB).
//   • protein (CDS) → STRING (functional association: physical + predicted), keyed by the
//                     STRING id <taxid>.<locus_tag> (b-number) — exact, no name ambiguity.
//                   + IntAct (experimental physical, via PSICQUIC MITAB), keyed by UniProt acc.
//   • RNA → no molecular-interaction source wired yet (RNAInter was unreachable at probe
//           time; STRING must NOT be queried with an sRNA id — it maps to a neighbour gene).
// Partners are linked back to our features by b-number (STRING) / UniProt acc (IntAct); each
// partner carries a `db` tag so the UI can split STRING physical/predicted vs IntAct.
//
// Usage:
//   node scripts/fetch-interactions.mjs <taxid>                 # ALL proteins
//   node scripts/fetch-interactions.mjs <taxid> --genes a,b,c   # panel test (by gene name)
//
// Resumable: features whose <uniqID>.json already has IntAct partners are skipped; STRING-only
// files from a previous run get IntAct merged in without re-hitting STRING.

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';
import { loadOrganismManifest } from '../lib/manifest.mjs';

const CONCURRENCY = 4; // gentle on STRING / RegulonDB
// STRING species + the org's own/own-species taxids (for IntAct partner filtering) are read from
// the organism manifest in main() — STRING is a general source, but the species id is per organism.
let STRING_SPECIES = '';
let SELF_TAXIDS = new Set();
const STRING_LIMIT = 40; // top-N partners per protein
const INTACT_LIMIT = 60; // top-N IntAct partners per protein (by evidence count)
const UA = 'Mozilla/5.0 (UniOme interactions fetcher; research/local-first)';

const STRING_PARTNERS = (id) =>
  `https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(id)}` +
  `&species=${STRING_SPECIES}&limit=${STRING_LIMIT}&caller_identity=uniome`;

// IntAct via the EBI IntAct REST API (JSON; more robust than PSICQUIC, which throttles hard).
// Query by UniProt acc (protein) or RNAcentral URS (RNA); paginated.
const INTACT_REST = (queryEnc, page, size) =>
  `https://www.ebi.ac.uk/intact/ws/interaction/findInteractions/${queryEnc}?page=${page}&pageSize=${size}`;
const INTACT_PAGE = 100;
const INTACT_MAX_PAGES = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET with backoff on rate-limit / network error (mirrors fetch-rna-assets.get).
async function get(url, { json = false, attempt = 0 } = {}) {
  const headers = { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' };
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (attempt < 6) { await sleep(Math.min(30000, 500 * 2 ** attempt) + Math.random() * 500); return get(url, { json, attempt: attempt + 1 }); }
    throw err;
  }
  if ((res.status === 429 || res.status === 503) && attempt < 6) {
    await sleep(Math.min(30000, 500 * 2 ** attempt) + Math.random() * 500);
    return get(url, { json, attempt: attempt + 1 });
  }
  return res;
}

// All features (CDS + RNA) — we need every type for routing, and lookup maps for linking.
function allFeatures(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const text = readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8');
  const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  return rows
    .map((r) => ({
      uniqID: (r.uniqID ?? '').trim(),
      type: (r.type ?? '').trim(),
      gene: (r.gene ?? '').trim(),
      locus_tag: (r.locus_tag ?? '').trim(),
      product: (r.product ?? '').trim(),
      UniProtID: (r.UniProtID ?? '').trim(),
    }))
    .filter((f) => f.uniqID);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// --- protein → STRING ---------------------------------------------------------
async function fetchProteinInteractions(feature, byLocus) {
  const id = `${STRING_SPECIES}.${feature.locus_tag}`;
  let res;
  try { res = await get(STRING_PARTNERS(id), { json: true }); } catch { return null; }
  if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return null;
  let rows;
  try { rows = await res.json(); } catch { return null; }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const partners = rows.map((r) => {
    const locus = String(r.stringId_B ?? '').replace(`${STRING_SPECIES}.`, '');
    const ch = {
      experimental: +r.escore || 0, database: +r.dscore || 0, coexpression: +r.ascore || 0,
      textmining: +r.tscore || 0, neighborhood: +r.nscore || 0, fusion: +r.fscore || 0, cooccurrence: +r.pscore || 0,
    };
    return {
      name: r.preferredName_B ?? locus,
      uniqID: byLocus.get(locus)?.uniqID ?? null,
      score: +r.score || 0,
      physical: ch.experimental > 0 || ch.database > 0,
      channels: ch,
    };
  }).sort((a, b) => b.score - a.score);
  return { source: 'STRING v12.0 — functional association (physical + predicted)', kind: 'association', partners };
}

// --- protein / RNA → IntAct (REST JSON) ---------------------------------------
// Parse an IntAct REST id string, e.g. "P0A9A6 (uniprotkb)" or "URS0000ABCD12_511145
// (rnacentral)", into { kind, id } (URS normalised: taxid suffix stripped, upper-cased).
const restId = (s) => {
  const m = /^(\S+)\s*\(([^)]+)\)/.exec(s ?? '');
  if (!m) return null;
  const db = m[2].toLowerCase();
  if (db.includes('uniprot')) return { kind: 'uniprot', id: m[1] };
  if (db.includes('rnacentral')) return { kind: 'rnacentral', id: m[1].replace(/_\d+$/, '').toUpperCase() };
  return { kind: db, id: m[1] };
};

// Fetch a feature's IntAct partners. `self` = { id, queryEnc }: id is our molecule's IntAct
// identifier (UniProt acc / URS), queryEnc the URL-encoded lookup. Partners (proteins by UniProt
// acc, RNAs by URS) are resolved back to our features via byUniProt / byUrs.
async function fetchIntact(self, byUniProt, byUrs) {
  if (!self) return [];
  const byPartner = new Map(); // partner id → { name, uniqID, methods:Set, count }
  for (let page = 0; page < INTACT_MAX_PAGES; page++) {
    let res;
    try { res = await get(INTACT_REST(self.queryEnc, page, INTACT_PAGE), { json: true }); } catch { break; }
    if (!res.ok) break;
    let data;
    try { data = await res.json(); } catch { break; }
    const content = Array.isArray(data?.content) ? data.content : [];
    if (content.length === 0) break;
    for (const it of content) {
      const A = restId(it.idA), B = restId(it.idB);
      if (!A || !B) continue;
      // Partner side = the one that isn't us. Skip self-interactions.
      let side, name, taxId;
      if (A.id === self.id && B.id !== self.id) { side = B; name = it.moleculeB; taxId = it.taxIdB; }
      else if (B.id === self.id && A.id !== self.id) { side = A; name = it.moleculeA; taxId = it.taxIdA; }
      else continue;
      if (taxId != null && !SELF_TAXIDS.has(String(taxId))) continue; // own-species partners only
      const hit = side.kind === 'uniprot' ? byUniProt.get(side.id) : side.kind === 'rnacentral' ? byUrs.get(side.id) : null;
      const e = byPartner.get(side.id) ?? { name: hit?.gene || name || side.id, uniqID: hit?.uniqID ?? null, methods: new Set(), count: 0 };
      e.count++;
      if (it.detectionMethod) e.methods.add(it.detectionMethod);
      byPartner.set(side.id, e);
    }
    const totalPages = data.totalPages ?? data.facetQueryResult?.totalPages;
    if ((totalPages && page + 1 >= totalPages) || content.length < INTACT_PAGE) break;
  }

  return [...byPartner.values()]
    .map((e) => ({ name: e.name, uniqID: e.uniqID, db: 'IntAct', physical: true, evidence: e.count, method: [...e.methods][0] ?? null }))
    .sort((x, y) => y.evidence - x.evidence)
    .slice(0, INTACT_LIMIT);
}

async function main() {
  const args = process.argv.slice(2);
  const taxid = args[0] || '83333';
  const genesArg = args.includes('--genes') ? args[args.indexOf('--genes') + 1].split(',').map((s) => s.trim()) : null;

  // Per-organism STRING species (general source, per-org id). Self/own-species taxids for the
  // IntAct partner filter: the org taxid + STRING species + the species-level taxid.
  const manifest = loadOrganismManifest(taxid);
  STRING_SPECIES = String(manifest.stringSpecies ?? '');
  if (!STRING_SPECIES) {
    console.error(`[interactions] no "stringSpecies" in scripts/organisms/<taxid>_*/organism.json for taxid ${taxid} — add it (STRING species id) and re-run.`);
    process.exit(1);
  }
  SELF_TAXIDS = new Set([taxid, manifest.stringSpecies, manifest.speciesTaxid].filter(Boolean).map(String));

  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'interactions');
  mkdirSync(outDir, { recursive: true });

  const features = allFeatures(folder);
  const byLocus = new Map(features.filter((f) => f.locus_tag).map((f) => [f.locus_tag, f]));
  const byUniProt = new Map(features.filter((f) => f.UniProtID).map((f) => [f.UniProtID, f]));

  // RNA features resolve to an RNAcentral URS (rna/index.json) — both the IntAct query key for
  // RNA entries and the lookup for RNA partners of any molecule.
  const rnaIndex = (() => { try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, 'rna', 'index.json'), 'utf8')); } catch { return {}; } })();
  const ursOf = new Map(Object.entries(rnaIndex).map(([uniqID, v]) => [uniqID, (v.urs ?? '').toUpperCase()]).filter(([, u]) => u));
  const byUrs = new Map();
  for (const f of features) { const u = ursOf.get(f.uniqID); if (u && !byUrs.has(u)) byUrs.set(u, f); }

  // A feature's IntAct identity: protein → UniProt acc, RNA → RNAcentral URS (wildcard for the
  // taxid suffix). null when we have no usable identifier (no IntAct lookup possible).
  const identityOf = (f) => {
    if (f.type === 'CDS') return f.UniProtID ? { id: f.UniProtID, queryEnc: encodeURIComponent(f.UniProtID) } : null;
    const u = ursOf.get(f.uniqID);
    return u ? { id: u, queryEnc: encodeURIComponent(u) } : null;
  };

  // Proteins (STRING + IntAct) and RNA (IntAct only) — both molecular interactions.
  let work = features.filter((f) => f.type === 'CDS' || /rna/i.test(f.type));
  if (genesArg) work = work.filter((f) => genesArg.includes(f.gene));

  console.log(`[interactions] ${folder}: ${work.length} feature(s)${genesArg ? ' (panel)' : ''}, concurrency ${CONCURRENCY}`);
  const index = existsSync(resolve(outDir, 'index.json')) ? JSON.parse(readFileSync(resolve(outDir, 'index.json'), 'utf8')) : {};
  let done = 0, empty = 0;

  await pool(work, CONCURRENCY, async (f) => {
    const outFile = resolve(outDir, `${f.uniqID}.json`);
    // Load any existing doc; skip entirely once it already carries IntAct.
    let doc = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null;
    if (doc?.partners?.some((p) => p.db === 'IntAct') && !genesArg) return;

    // STRING only for genuinely-new proteins (no re-hit when merging IntAct into an existing doc).
    if (!doc && f.type === 'CDS') {
      const result = await fetchProteinInteractions(f, byLocus);
      if (result) doc = { uniqID: f.uniqID, gene: f.gene, molecularType: 'protein', ...result };
    }
    const intact = await fetchIntact(identityOf(f), byUniProt, byUrs);

    if (!doc && intact.length === 0) { empty++; return; }
    if (!doc) doc = { uniqID: f.uniqID, gene: f.gene, molecularType: f.type === 'CDS' ? 'protein' : f.type, source: 'IntAct — experimental physical', kind: 'association', partners: [] };
    // Replace any prior IntAct partners (panel re-runs) then append the fresh set.
    doc.partners = (doc.partners ?? []).filter((p) => p.db !== 'IntAct').concat(intact);

    writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
    const stringCount = doc.partners.filter((p) => p.db !== 'IntAct').length;
    index[f.uniqID] = { gene: f.gene, type: doc.molecularType, kind: doc.kind, count: doc.partners.length };
    done++;
    console.log(`  ${f.gene || f.uniqID} (${doc.molecularType}): ${stringCount} STRING + ${intact.length} IntAct`);
  });

  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`[interactions] done: ${done} feature(s) with data; ${empty} none.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
