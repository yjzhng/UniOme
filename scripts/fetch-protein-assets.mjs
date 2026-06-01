#!/usr/bin/env node
// One-time, build-time fetch of protein visualization assets (TED domains + CATH
// names + AlphaFold structures) into resources/. Local-first: this runs once; uniOme
// then serves everything from disk and never queries these services at view time.
//
// Usage:
//   node scripts/fetch-protein-assets.mjs <taxid>                  # ALL CDS proteins
//   node scripts/fetch-protein-assets.mjs <taxid> <acc> [<acc>...] # specific accessions
//   node scripts/fetch-protein-assets.mjs                          # dnaA test (83333 P03004)
//
// Resumable: existing domains/structures are skipped, so it's safe to re-run/interrupt.

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const CONCURRENCY = 3;

const here = dirname(fileURLToPath(import.meta.url));
const RESOURCES = resolve(here, '../resources');

const TED_SUMMARY = (acc) => `https://ted.cathdb.info/api/v1/uniprot/summary/${acc}`;
const AF_PREDICTION = (acc) => `https://alphafold.ebi.ac.uk/api/prediction/${acc}`;
// Released REST API (clean JSON) is the default source; the website's "latest"
// superfamily page carries newer live names the released API still returns null for.
const CATH_SFAM_API = (id) => `https://www.cathdb.info/version/v4_4_0/api/rest/superfamily/${id}`;
const CATH_SFAM_PAGE = (id) => `https://www.cathdb.info/version/latest/superfamily/${id}`;
// Shared, organism-independent CATH code → name cache so we look up each code once.
const CATH_NAMES_FILE = resolve(RESOURCES, 'cath-names.json');

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'");
}

// Some EBI endpoints 403 requests without a conventional User-Agent (Node's default).
const UA = 'Mozilla/5.0 (uniOme protein-assets fetcher; research/local-first)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Fetch with backoff on rate-limit / transient errors (TED 429s under concurrency).
async function get(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if ((res.status === 429 || res.status === 503) && attempt < 6) {
    const ra = Number(res.headers.get('retry-after'));
    const wait =
      Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30000, 500 * 2 ** attempt) + Math.random() * 500;
    await sleep(wait);
    return get(url, attempt + 1);
  }
  return res;
}

// Map a taxid to its resources/<folder> (same `^(\d+)_` convention as the API).
function orgFolder(taxid) {
  const match = readdirSync(RESOURCES, { withFileTypes: true }).find(
    (e) => e.isDirectory() && new RegExp(`^${taxid}_`).test(e.name)
  );
  if (!match) throw new Error(`no resources folder for taxid ${taxid}`);
  return match.name;
}

// "4-77" -> [[4,77]];  "5-120_140-200" -> [[5,120],[140,200]]
function parseChopping(chopping) {
  return chopping
    .split('_')
    .map((seg) => seg.split('-').map((n) => Number(n)))
    .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function loadCathCache() {
  try {
    return JSON.parse(readFileSync(CATH_NAMES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Released REST API → classification_name (null for recently-(re)named superfamilies).
async function cathNameFromApi(code) {
  try {
    const res = await get(CATH_SFAM_API(code));
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data?.classification_name ?? null;
  } catch {
    return null;
  }
}

// Fallback: scrape the live superfamily page's <h2> for the current name.
async function cathNameFromWeb(code) {
  try {
    const res = await get(CATH_SFAM_PAGE(code));
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<h1>CATH Superfamily [^<]+<\/h1>\s*<h2>([^<]+)/);
    const name = m ? decodeEntities(m[1]).trim() : '';
    return name.length ? name : null;
  } catch {
    return null;
  }
}

// CATH superfamily name for a code: API first, falling back to the live page.
// Memoized in `cache` (mutated). null when the superfamily is genuinely unnamed.
async function getCathName(code, cache) {
  if (!code) return null;
  if (code in cache) return cache[code];
  const name = (await cathNameFromApi(code)) ?? (await cathNameFromWeb(code));
  cache[code] = name ?? null;
  return cache[code];
}

async function fetchTedDomains(acc) {
  const res = await get(TED_SUMMARY(acc));
  if (!res.ok) throw new Error(`TED ${acc}: HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  // Domain length (max residue across all segments) feeds the track scale.
  let maxRes = 0;
  const domains = rows.map((r) => {
    const segments = parseChopping(String(r.chopping ?? ''));
    for (const [, e] of segments) maxRes = Math.max(maxRes, e);
    return {
      id: String(r.ted_id ?? '').split('_').pop() || r.ted_id, // "…_TED01" -> "TED01"
      segments,
      cath: r.cath_label ?? null,
      plddt: typeof r.plddt === 'number' ? Math.round(r.plddt * 10) / 10 : null,
    };
  });
  return { acc, length: maxRes || null, source: 'TED', domains };
}

// Download the AlphaFold model into structures/<acc>.cif. We query the prediction
// API first because the file version moves (currently v6; the old hardcoded v4 404s).
// Large + gitignored. Skips if already present.
async function fetchAlphaFoldStructure(acc, structDir) {
  const out = resolve(structDir, `${acc}.cif`);
  if (existsSync(out)) return; // resume: already downloaded
  const meta = await get(AF_PREDICTION(acc));
  if (!meta.ok) throw new Error(`AlphaFold prediction ${acc}: HTTP ${meta.status}`);
  const arr = await meta.json();
  const cifUrl = Array.isArray(arr) && arr[0]?.cifUrl;
  if (!cifUrl) throw new Error(`AlphaFold ${acc}: no cifUrl (no model?)`);
  const cif = await get(cifUrl);
  if (!cif.ok) throw new Error(`AlphaFold cif ${acc}: HTTP ${cif.status}`);
  mkdirSync(structDir, { recursive: true });
  writeFileSync(out, await cif.text());
}

// Distinct UniProt accessions of CDS features in an organism's *_DB.csv.
function cdsAccessions(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  if (!dbFile) throw new Error(`no *_DB.csv in ${folder}`);
  const text = readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8');
  const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  const accs = new Set();
  for (const r of rows) {
    if ((r.type ?? '').trim() === 'CDS') {
      const u = (r.UniProtID ?? '').trim();
      if (u) accs.add(u);
    }
  }
  return [...accs];
}

// Run fn over items with a fixed number of concurrent workers.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    })
  );
}

async function main() {
  const args = process.argv.slice(2);
  let taxid;
  let accs; // null = whole organism
  if (args.length === 0) {
    taxid = '83333';
    accs = ['P03004'];
  } else if (args.length === 1) {
    taxid = args[0];
    accs = null;
  } else {
    taxid = args[0];
    accs = args.slice(1);
  }

  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'proteins');
  const structDir = resolve(outDir, 'structures');
  mkdirSync(outDir, { recursive: true });
  const cathCache = loadCathCache();

  const list = accs ?? cdsAccessions(folder);
  console.log(`[fetch] ${folder}: ${list.length} protein(s), concurrency ${CONCURRENCY}`);

  let done = 0;
  await pool(list, CONCURRENCY, async (acc) => {
    const domOut = resolve(outDir, `${acc}.domains.json`);
    if (!existsSync(domOut)) {
      try {
        const data = await fetchTedDomains(acc);
        for (const d of data.domains) d.cathName = await getCathName(d.cath, cathCache);
        writeFileSync(domOut, JSON.stringify(data, null, 2) + '\n');
      } catch (err) {
        console.error(`[fetch] ${acc}: domains FAILED — ${err.message}`);
      }
    }
    try {
      await fetchAlphaFoldStructure(acc, structDir);
    } catch (err) {
      console.error(`[fetch] ${acc}: structure FAILED — ${err.message}`);
    }
    if (++done % 50 === 0 || done === list.length) {
      console.log(`[fetch] progress ${done}/${list.length}`);
      writeFileSync(CATH_NAMES_FILE, JSON.stringify(cathCache, null, 2) + '\n');
    }
  });

  writeFileSync(CATH_NAMES_FILE, JSON.stringify(cathCache, null, 2) + '\n');
  console.log(`[fetch] done: ${done}/${list.length}`);
}

main();
