#!/usr/bin/env node
// One-time, build-time fetch of EXPRESSION LEVEL into resources/. Local-first.
//   • protein abundance → PaxDb integrated whole-organism dataset (ppm, keyed by <taxid>.<b-number>)
//   • transcript level  → iModulonDB "modulome" expression matrix (mean log-TPM per gene, by b-number)
// Both are mapped to our features by locus_tag (b-number) and ranked into a 0–100 percentile.
// Writes resources/<org>/expression.json: { uniqID: { protein?: {value,pct}, transcript?: {value,pct} } }
//
// Usage: node scripts/build-expression.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

// E. coli sources (PaxDb species 511145; iModulonDB e_coli/modulome). Extend per organism later.
const PAXDB = 'https://pax-db.org/downloads/5.0/datasets/511145/511145-WHOLE_ORGANISM-integrated.txt';
// Per-gene expression (the full matrix endpoint is ~289 MB and the server caps the transfer, so we
// fetch each gene's per-sample vector and average it). Resumable via an _assets cache.
const IMODULON_GENE = (locus) => `https://imodulondb.org/api/genes/e_coli/modulome/${encodeURIComponent(locus)}/expression`;
const UA = 'Mozilla/5.0 (UniOme expression fetcher; research/local-first)';

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}
const get = (url, json = false) => fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' } });

// value-map (key → number) → { key → { value, pct } } where pct is the percentile rank (0–100).
function withPercentile(valueByKey) {
  const sorted = [...valueByKey.values()].sort((a, b) => a - b);
  const total = sorted.length;
  const pctOf = (v) => {
    // fraction of entries strictly below v (binary search lower bound)
    let lo = 0, hi = total;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return total > 1 ? Math.round((lo / (total - 1)) * 100) : 100;
  };
  const out = new Map();
  for (const [k, v] of valueByKey) out.set(k, { value: v, pct: pctOf(v) });
  return out;
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const uniqByLocus = new Map(rows.filter((r) => (r.locus_tag ?? '').trim()).map((r) => [(r.locus_tag).trim(), (r.uniqID ?? '').trim()]));

  // --- protein abundance (PaxDb) -------------------------------------------------
  let proteinByUniq = new Map();
  try {
    const txt = await (await get(PAXDB)).text();
    const ppmByLocus = new Map();
    for (const line of txt.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [extId, abundance] = line.split('\t');
      const locus = (extId ?? '').split('.').slice(1).join('.'); // "511145.b0002" → "b0002"
      const ppm = parseFloat(abundance);
      const uniq = uniqByLocus.get(locus);
      if (uniq && Number.isFinite(ppm)) ppmByLocus.set(uniq, ppm);
    }
    proteinByUniq = withPercentile(ppmByLocus);
    console.log(`[expression] PaxDb: ${proteinByUniq.size} proteins`);
  } catch (e) { console.warn('[expression] PaxDb fetch failed:', e.message); }

  // --- transcript level (iModulonDB modulome; per-gene mean log-TPM, resumable cache) ---------
  let txByUniq = new Map();
  {
    const cacheDir = resolve(RESOURCES, folder, '_assets'); mkdirSync(cacheDir, { recursive: true });
    const cacheFile = resolve(cacheDir, 'imodulon_means.json');
    const means = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}; // locus → mean | null
    const todo = [...uniqByLocus.keys()].filter((l) => !(l in means));
    console.log(`[expression] iModulonDB: ${todo.length} genes to fetch (${Object.keys(means).length} cached)`);
    let done = 0;
    await pool(todo, 8, async (locus) => {
      try {
        const r = await get(IMODULON_GENE(locus), true);
        if (!r.ok) { means[locus] = null; return; }
        const d = await r.json();
        const vals = Object.values(d.expression ?? {}).map(Number).filter(Number.isFinite);
        means[locus] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      } catch { /* leave uncached to retry on a later run */ }
      if (++done % 500 === 0) { writeFileSync(cacheFile, JSON.stringify(means)); console.log(`  ${done}/${todo.length}`); }
    });
    writeFileSync(cacheFile, JSON.stringify(means));
    const meanByUniq = new Map();
    for (const [locus, uniq] of uniqByLocus) { const m = means[locus]; if (typeof m === 'number') meanByUniq.set(uniq, m); }
    txByUniq = withPercentile(meanByUniq);
    console.log(`[expression] iModulonDB modulome: ${txByUniq.size} transcripts`);
  }

  const out = {};
  // Keep PaxDb ppm as a float (don't round to integer): rounding collapsed sub-integer abundances
  // toward 0 and quantized the low end, distorting the log-scale distribution.
  for (const [uniq, p] of proteinByUniq) (out[uniq] ??= {}).protein = { value: Math.round(p.value * 1000) / 1000, pct: p.pct };
  for (const [uniq, t] of txByUniq) (out[uniq] ??= {}).transcript = { value: +t.value.toFixed(2), pct: t.pct };

  writeFileSync(resolve(RESOURCES, folder, 'expression.json'), JSON.stringify(out) + '\n');
  console.log(`[expression] ${Object.keys(out).length} features → ${folder}/expression.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
