#!/usr/bin/env node
// One-time, build-time fetch of gene ESSENTIALITY into resources/. Local-first.
// Source: EcoCyc knockout-growth observations via the BioCyc web services (no auth).
//   1. b-number (locus_tag) → gene frame WITH knockout data in one call:
//      xmlquery [x:x<-ecoli^^genes,x^accession-1="bNNNN"]&detail=full
//      → <knockout-growth-observations>: per-obs <growth-status> (NONE/NORMAL) + media frame
//   2. media frame → <common-name>: classify rich (LB/Luria/enriched) vs minimal (M9/MOPS), cached
//   3. derive: essential = NONE on a rich medium; conditional = grows on rich but NONE on minimal
//      (auxotroph); else non-essential.
// Only CDS are fetched (rRNA/tRNA have no knockout data). Resumable via an _assets cache.
//
// BioCyc throttles bursts by returning empty 200 bodies — so every response is validated as real
// ptools-xml and retried with backoff; an empty/error reply is NEVER cached as "no data".
// Be polite: low concurrency. A full run is slow (~30–60 min) but resumable + writes partial output.
// Writes resources/<org>/essentiality/ecocyc.json: { uniqID: { call, noGrowth, total } }
// (the primary source; CRISPRi fallback lives beside it as essentiality/crispri.json — see
// scripts/build-essentiality-crispri.mjs. The API prefers EcoCyc, then falls back to CRISPRi.)
//
// Usage: node scripts/build-essentiality.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const WS = 'https://websvc.biocyc.org';
const UA = 'Mozilla/5.0 (UniOme essentiality fetcher; research/local-first)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// Fetch a BioCyc XML doc, validating it's a real ptools-xml payload (BioCyc returns empty 200s
// when throttling). Retries with exponential backoff; throws if every attempt fails so the caller
// leaves the gene uncached (retried on a later run) rather than recording a false "no data".
async function fetchXml(url, tries = 5) {
  let last;
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      if (r.ok) {
        const txt = await r.text();
        if (txt && txt.includes('<ptools-xml')) return txt;
        last = new Error('empty/throttled body');
      } else last = new Error(`HTTP ${r.status}`);
    } catch (e) { last = e; }
    await sleep(1000 * 2 ** t); // 1s, 2s, 4s, 8s, 16s
  }
  throw last;
}

// Parse the knockout block into ordered (status, mediaFrame) pairs, or null if absent.
function parseKnockout(xml) {
  const block = xml.match(/<knockout-growth-observations>([\s\S]*?)<\/knockout-growth-observations>/i);
  if (!block) return null;
  const statuses = [...block[1].matchAll(/<growth-status>\s*([^<]+?)\s*<\/growth-status>/gi)].map((m) => m[1].toUpperCase());
  const medias = [...block[1].matchAll(/<growth-media[^>]*\bframeid=['"]([^'"]+)['"]/gi)].map((m) => m[1]);
  const n = Math.min(statuses.length, medias.length);
  return n ? { statuses: statuses.slice(0, n), medias: medias.slice(0, n) } : null;
}

// Compact medium label, e.g. "M9 medium with 0.4% glucose" → "M9/glucose", "Luria-Bertani broth" → "LB".
function shortMedia(name) {
  const base = /mops/i.test(name) ? 'MOPS' : /\bm9\b/i.test(name) ? 'M9' : /lb|luria/i.test(name) ? 'LB' : name.split(' ')[0];
  const carbon = name.match(/with\s+[\d.]+%\s*([A-Za-z]+)/i)?.[1];
  if (carbon) return `${base}/${carbon.toLowerCase()}`;
  const qual = name.match(/\b(lennox|enriched)\b/i)?.[1];
  return qual ? `${base} ${qual.toLowerCase()}` : base;
}

// Classify a growth medium (rich / minimal / other) AND its short label, by common name; cached.
async function mediumInfo(mix, cache) {
  if (mix in cache) return cache[mix];
  const name = (await fetchXml(`${WS}/getxml?ECOLI:${mix}`)).match(/<common-name[^>]*>([^<]*)<\/common-name>/i)?.[1] ?? '';
  const kind = /\b(lb|luria|enrich)/i.test(name) ? 'rich' : /\b(m9|mops|minimal)/i.test(name) ? 'minimal' : 'other';
  cache[mix] = { kind, short: shortMedia(name) };
  return cache[mix];
}

async function computeEssentiality(bnum, mediaCache) {
  const q = `[x:x<-ecoli^^genes,x^accession-1="${bnum}"]`;
  const xml = await fetchXml(`${WS}/xmlquery?${encodeURIComponent(q)}&detail=full`);
  if (!+(xml.match(/<num_results>\s*(\d+)\s*<\/num_results>/)?.[1] ?? '0')) return null; // gene not found
  const parsed = parseKnockout(xml);
  if (!parsed) return null; // gene exists but has no knockout-growth data
  let noGrowth = 0, essential = false, growsRich = false, noneMinimal = false;
  const noGrowthMinimal = new Set(); // short labels of minimal media where the knockout doesn't grow
  for (let i = 0; i < parsed.statuses.length; i++) {
    const none = parsed.statuses[i] === 'NONE';
    const { kind, short } = await mediumInfo(parsed.medias[i], mediaCache);
    if (none) noGrowth++;
    if (none && kind === 'rich') essential = true;
    if (!none && kind === 'rich') growsRich = true;
    if (none && kind === 'minimal') { noneMinimal = true; noGrowthMinimal.add(short); }
  }
  // EcoCyc's conditional = grows on rich but not minimal = auxotroph = rescued by nutrients ⇒
  // "conditional (starvation)" (matching the CRISPRi split; EcoCyc can't see fast-growth essentials).
  const call = essential ? 'essential' : growsRich && noneMinimal ? 'conditional-starvation' : 'non-essential';
  return { call, noGrowth, total: parsed.statuses.length, media: [...noGrowthMinimal] };
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  // CDS only (EcoCyc has no knockout data for rRNA/tRNA/ncRNA).
  const cds = rows.filter((r) => (r.type ?? '').trim() === 'CDS' && (r.locus_tag ?? '').trim() && (r.uniqID ?? '').trim());
  const uniqByLocus = new Map(cds.map((r) => [r.locus_tag.trim(), r.uniqID.trim()]));

  const cacheDir = resolve(RESOURCES, folder, '_assets'); mkdirSync(cacheDir, { recursive: true });
  const resFile = resolve(cacheDir, 'ecocyc_essentiality.json'); // locus → result | null (no data)
  const mediaFile = resolve(cacheDir, 'ecocyc_media.json'); // MIX → rich|minimal|other
  const results = existsSync(resFile) ? JSON.parse(readFileSync(resFile, 'utf8')) : {};
  const mediaCache = existsSync(mediaFile) ? JSON.parse(readFileSync(mediaFile, 'utf8')) : {};
  const outDir = resolve(RESOURCES, folder, 'essentiality'); mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'ecocyc.json');

  const flush = () => {
    writeFileSync(resFile, JSON.stringify(results));
    writeFileSync(mediaFile, JSON.stringify(mediaCache));
    const out = {};
    for (const [locus, uniq] of uniqByLocus) { const r = results[locus]; if (r) out[uniq] = r; }
    writeFileSync(outFile, JSON.stringify(out) + '\n');
  };

  const todo = [...uniqByLocus.keys()].filter((l) => !(l in results));
  console.log(`[essentiality] ${todo.length} genes to fetch (${Object.keys(results).length} cached)`);
  let done = 0;
  await pool(todo, 3, async (locus) => {
    try { results[locus] = await computeEssentiality(locus, mediaCache); }
    catch { /* leave uncached → retried on a later run */ }
    if (++done % 100 === 0) { flush(); console.log(`  ${done}/${todo.length}`); }
  });
  flush();
  const out = JSON.parse(readFileSync(outFile, 'utf8'));
  const calls = Object.values(out).reduce((m, r) => ((m[r.call] = (m[r.call] ?? 0) + 1), m), {});
  console.log(`[essentiality] ${Object.keys(out).length} CDS → ${folder}/essentiality/ecocyc.json`, calls);
}

main().catch((e) => { console.error(e); process.exit(1); });
