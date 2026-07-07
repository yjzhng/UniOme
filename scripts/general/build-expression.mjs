#!/usr/bin/env node
// One-time, build-time fetch of EXPRESSION LEVEL for M. tuberculosis into resources/. Local-first.
//   • protein abundance → PaxDb integrated whole-organism dataset (ppm, keyed by <species>.<Rv>)
//   • transcript level  → iModulonDB modulome expression matrix (mean log-TPM per gene, by Rv id)
// Both map to our features by locus_tag (Rv number) and rank into a 0–100 percentile. Source ids come
// from the organism manifest (paxdbSpecies, imodulonOrg, imodulonDataset). Same shape/logic as the
// E. coli builder — H37Rv Rv ids join directly (no strain crosswalk).
// Writes resources/<org>/expression.json: { uniqID: { protein?: {value,pct}, transcript?: {value,pct} } }
//
// Usage: node scripts/organisms/83332_Mtb/build-expression.mjs [taxid=83332]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, findDb } from '../lib/org.mjs';
import { loadOrganismManifest } from '../lib/manifest.mjs';

const UA = 'Mozilla/5.0 (UniOme expression fetcher; research/local-first)';
const PAXDB = (rel, species) => `https://pax-db.org/downloads/${rel}/datasets/${species}/${species}-WHOLE_ORGANISM-integrated.txt`;
const IMODULON_GENE = (org, ds, locus) => `https://imodulondb.org/api/genes/${org}/${ds}/${encodeURIComponent(locus)}/expression`;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}
const get = (url, json = false) => fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' } });

// Fetch the PaxDb integrated whole-organism file, preferring the pinned 5.0 release and falling back to
// `latest` (some species are only in latest, e.g. S. aureus 93061). Returns the text, or '' if neither.
async function fetchPaxdb(species) {
  for (const rel of ['5.0', 'latest']) {
    try { const r = await get(PAXDB(rel, species)); if (r.ok) return await r.text(); } catch { /* try next */ }
  }
  return '';
}

// value-map (key → number) → { key → { value, pct } } where pct is the percentile rank (0–100).
function withPercentile(valueByKey) {
  const sorted = [...valueByKey.values()].sort((a, b) => a - b);
  const total = sorted.length;
  const pctOf = (v) => {
    let lo = 0, hi = total;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return total > 1 ? Math.round((lo / (total - 1)) * 100) : 100;
  };
  const out = new Map();
  for (const [k, v] of valueByKey) out.set(k, { value: v, pct: pctOf(v) });
  return out;
}

async function main() {
  const taxid = process.argv[2] || '83332';
  const folder = orgFolder(taxid);
  const m = loadOrganismManifest(taxid);
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;
  // locus_tag → uniqID, plus an underscore-stripped alias: PaxDb keys B. subtilis as BSU35360 while our
  // RefSeq loci are BSU_35360 (iModulonDB, conversely, keeps the underscore) — the alias bridges both.
  const uniqByLocus = new Map();
  for (const r of rows) {
    const lt = (r.locus_tag ?? '').trim(), uniqID = (r.uniqID ?? '').trim();
    if (!lt || !uniqID) continue;
    uniqByLocus.set(lt, uniqID);
    const alias = lt.replace(/_/g, '');
    if (alias !== lt && !uniqByLocus.has(alias)) uniqByLocus.set(alias, uniqID);
  }

  // --- protein abundance (PaxDb) -------------------------------------------------
  let proteinByUniq = new Map();
  if (m.paxdbSpecies) {
    try {
      const txt = await fetchPaxdb(m.paxdbSpecies);
      const ppmByUniq = new Map();
      for (const line of txt.split('\n')) {
        if (!line || line.startsWith('#')) continue;
        // The integrated file is 2-col (extId, abundance) in the 5.0 release and 3-col (gene_name, extId,
        // abundance) in latest — locate the `<taxid>.<locus>` id and take abundance as the last column.
        const cols = line.split('\t');
        const extId = cols.find((c) => /^\d+\./.test(c)) ?? '';
        const locus = extId.split('.').slice(1).join('.'); // "83332.Rv0001" → "Rv0001"
        const ppm = parseFloat(cols[cols.length - 1]);
        const uniq = uniqByLocus.get(locus);
        if (locus && uniq && Number.isFinite(ppm)) ppmByUniq.set(uniq, ppm);
      }
      proteinByUniq = withPercentile(ppmByUniq);
      console.log(`[expression] PaxDb (${m.paxdbSpecies}): ${proteinByUniq.size} proteins`);
    } catch (e) { console.warn('[expression] PaxDb fetch failed:', e.message); }
  }

  // --- transcript level (iModulonDB modulome; per-gene mean log-TPM, resumable cache) ---------
  let txByUniq = new Map();
  if (m.imodulonOrg && m.imodulonDataset) {
    const cacheDir = resolve(RESOURCES, folder, '_assets'); mkdirSync(cacheDir, { recursive: true });
    const cacheFile = resolve(cacheDir, 'imodulon_means.json');
    const means = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}; // locus → mean | null
    const todo = [...uniqByLocus.keys()].filter((l) => !(l in means));
    console.log(`[expression] iModulonDB ${m.imodulonOrg}/${m.imodulonDataset}: ${todo.length} genes to fetch (${Object.keys(means).length} cached)`);
    let done = 0;
    await pool(todo, 8, async (locus) => {
      try {
        const r = await get(IMODULON_GENE(m.imodulonOrg, m.imodulonDataset, locus), true);
        if (!r.ok) { means[locus] = null; return; }
        const d = await r.json();
        const vals = Object.values(d.expression ?? {}).map(Number).filter(Number.isFinite);
        means[locus] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      } catch { /* leave uncached to retry on a later run */ }
      if (++done % 500 === 0) { writeFileSync(cacheFile, JSON.stringify(means)); console.log(`  ${done}/${todo.length}`); }
    });
    writeFileSync(cacheFile, JSON.stringify(means));
    const meanByUniq = new Map();
    for (const [locus, uniq] of uniqByLocus) { const v = means[locus]; if (typeof v === 'number') meanByUniq.set(uniq, v); }
    txByUniq = withPercentile(meanByUniq);
    console.log(`[expression] iModulonDB modulome: ${txByUniq.size} transcripts`);
  }

  const out = {};
  for (const [uniq, p] of proteinByUniq) (out[uniq] ??= {}).protein = { value: Math.round(p.value * 1000) / 1000, pct: p.pct };
  for (const [uniq, t] of txByUniq) (out[uniq] ??= {}).transcript = { value: +t.value.toFixed(2), pct: t.pct };

  writeFileSync(resolve(RESOURCES, folder, 'expression.json'), JSON.stringify(out) + '\n');
  console.log(`[expression] ${Object.keys(out).length} features → ${folder}/expression.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
