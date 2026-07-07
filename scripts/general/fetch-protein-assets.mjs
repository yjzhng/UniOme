#!/usr/bin/env node
// One-time, build-time fetch of protein visualization assets (TED domains + CATH
// names + InterPro representative domains + CDD motifs + MobiDB-lite disorder +
// UniProt variants & PTMs + AlphaFold structures) into resources/. Local-first: this
// runs once; UniOme then serves everything from disk and never queries at view time.
//
// Usage:
//   node scripts/fetch-protein-assets.mjs <taxid>                  # ALL CDS proteins
//   node scripts/fetch-protein-assets.mjs <taxid> <acc> [<acc>...] # specific accessions
//   node scripts/fetch-protein-assets.mjs                          # dnaA test (83333 P03004)
//
// Resumable: existing domains/structures are skipped, so it's safe to re-run/interrupt.

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const CONCURRENCY = 15; // InterPro + EBI tolerate this comfortably

// MobiDB (mobidb.org) is a smaller, non-EBI host — cap its concurrency separately so
// the higher overall pool doesn't hammer it.
const MOBIDB_CONCURRENCY = 6;
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < max && queue.length) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    }
  };
  return (fn) => new Promise((resolve, reject) => (queue.push({ fn, resolve, reject }), pump()));
}
const mobidbLimiter = makeLimiter(MOBIDB_CONCURRENCY);


const TED_SUMMARY = (acc) => `https://ted.cathdb.info/api/v1/uniprot/summary/${acc}`;
const AF_PREDICTION = (acc) => `https://alphafold.ebi.ac.uk/api/prediction/${acc}`;
const INTERPRO_ALL = (acc) =>
  `https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/${acc}/?page_size=200`;
// Residue-level annotations (per entry): CDD's curated conserved-residue motifs.
const INTERPRO_RESIDUES = (acc) =>
  `https://www.ebi.ac.uk/interpro/api/protein/uniprot/${acc}/?residues`;
// CDD domain matches (the model envelopes), for context behind the motifs.
const CDD_ENTRY = (acc) =>
  `https://www.ebi.ac.uk/interpro/api/entry/cdd/protein/uniprot/${acc}/?page_size=200`;
const MOBIDB = (acc) => `https://mobidb.org/api/download?acc=${acc}&format=json`;
// Full UniProt entry (rest.uniprot.org) — unlike the EBI /features endpoint it carries
// the alternativeSequence (original→variant) and descriptions for VAR_SEQ/variants.
const UNIPROT_ENTRY = (acc) =>
  `https://rest.uniprot.org/uniprotkb/${acc}.json?fields=sequence,ft_variant,ft_mutagen,ft_var_seq,ft_mod_res,ft_carbohyd,ft_lipid,ft_disulfid,ft_crosslnk`;
// rest.uniprot.org type name → our short codes.
const UNIPROT_VARIANT_TYPE = {
  'Natural variant': 'VARIANT',
  Mutagenesis: 'MUTAGEN',
  'Alternative sequence': 'VAR_SEQ',
};
const UNIPROT_PTM_TYPE = {
  'Modified residue': 'MOD_RES',
  Glycosylation: 'CARBOHYD',
  Lipidation: 'LIPID',
  'Disulfide bond': 'DISULFID',
  'Cross-link': 'CROSSLNK',
};
// Released REST API (clean JSON) is the default source; the website's "latest"
// superfamily page carries newer live names the released API still returns null for.
const CATH_SFAM_API = (id) => `https://www.cathdb.info/version/v4_4_0/api/rest/superfamily/${id}`;
const CATH_SFAM_PAGE = (id) => `https://www.cathdb.info/version/latest/superfamily/${id}`;
// Shared CATH code → name cache (build-time only; names are baked into each domain
// JSON, so the app never reads this). Accumulates across organism fetches so common
// superfamilies are looked up once.
const CATH_NAMES_FILE = resolve(RESOURCES, '_shared', 'cath-names.json');

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'");
}

// Some EBI endpoints 403 requests without a conventional User-Agent (Node's default).
const UA = 'Mozilla/5.0 (UniOme protein-assets fetcher; research/local-first)';
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

// Domain-like InterPro entry types (families span the whole chain and belong to a
// separate "representative families" concept, so they're excluded from the domain view).
const INTERPRO_DOMAIN_TYPES = new Set(['domain', 'homologous_superfamily', 'repeat']);

// InterPro's own representative-domain selection: across all member databases it flags
// the non-redundant set of domain locations (`representative: true`) shown on the
// protein page. We take those, preferring the integrated InterPro entry's accession +
// name; an unnamed CATH-Gene3D superfamily falls back to its CATH name.
async function fetchInterproDomains(acc, cathCache) {
  const res = await get(INTERPRO_ALL(acc));
  if (res.status === 204) return { acc, length: null, source: 'InterPro', domains: [] };
  if (!res.ok) throw new Error(`InterPro ${acc}: HTTP ${res.status}`);
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  // Integrated InterPro entry names, to label member-DB matches.
  const iprName = {};
  for (const r of results) {
    const m = r.metadata;
    if (m?.source_database === 'interpro' && m.accession) iprName[m.accession] = m.name ?? null;
  }
  const domains = [];
  let maxRes = 0;
  for (const r of results) {
    const m = r.metadata || {};
    if (!INTERPRO_DOMAIN_TYPES.has(m.type)) continue;
    const ipr = m.integrated || null;
    for (const loc of r.proteins?.[0]?.entry_protein_locations ?? []) {
      if (!loc.representative) continue;
      const segments = (loc.fragments ?? [])
        .map((f) => [Number(f.start), Number(f.end)])
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (!segments.length) continue;
      for (const [, e] of segments) maxRes = Math.max(maxRes, e);
      let name = m.name || (ipr ? iprName[ipr] : null) || null;
      // CATH-Gene3D superfamilies often have no member name; resolve from CATH.
      if (!name && m.source_database === 'cathgene3d') {
        name = await getCathName(String(m.accession).replace(/^G3DSA:/, ''), cathCache);
      }
      domains.push({
        id: ipr || m.accession,
        db: ipr ? 'InterPro' : m.source_database,
        name: name ?? null,
        segments,
      });
    }
  }
  domains.sort((a, b) => a.segments[0][0] - b.segments[0][0]);
  return { acc, length: maxRes || null, source: 'InterPro', domains };
}

// Merge a list of [start,end] residue fragments into sorted, contiguous ranges.
function mergeRanges(frags) {
  const sorted = frags
    .map((f) => [Number(f.start), Number(f.end)])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// CDD conserved-residue motifs: InterPro's residue-level annotations expose CDD's
// curated sites (Walker motifs, binding sites, …) within each model — the actual
// conserved residues, not just the domain envelope. Keep CDD-source entries.
async function fetchCddMotifs(acc) {
  const res = await get(INTERPRO_RESIDUES(acc));
  if (res.status === 204 || res.status === 404) {
    return { acc, length: null, source: 'CDD', models: [], motifs: [] };
  }
  if (!res.ok) throw new Error(`CDD residues ${acc}: HTTP ${res.status}`);
  const json = await res.json();
  const motifs = [];
  let maxRes = 0;
  for (const entry of Object.values(json || {})) {
    if (entry?.source_database !== 'cdd') continue;
    for (const loc of entry.locations ?? []) {
      const segments = mergeRanges(loc.fragments ?? []);
      if (!segments.length) continue;
      for (const [, e] of segments) maxRes = Math.max(maxRes, e);
      motifs.push({
        entry: entry.accession,
        entryName: entry.name ?? null,
        description: loc.description ?? 'conserved site',
        segments,
      });
    }
  }
  motifs.sort((a, b) => a.segments[0][0] - b.segments[0][0]);

  // Domain match envelopes (context behind the motifs).
  const models = [];
  try {
    const er = await get(CDD_ENTRY(acc));
    if (er.ok) {
      const ej = await er.json();
      for (const r of Array.isArray(ej?.results) ? ej.results : []) {
        const entry = r.metadata?.accession;
        if (!entry) continue;
        for (const loc of r.proteins?.[0]?.entry_protein_locations ?? []) {
          const segments = (loc.fragments ?? [])
            .map((f) => [Number(f.start), Number(f.end)])
            .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
          if (!segments.length) continue;
          for (const [, e] of segments) maxRes = Math.max(maxRes, e);
          models.push({ entry, name: r.metadata?.name ?? null, segments });
        }
      }
    }
  } catch {
    /* envelopes are optional context */
  }
  models.sort((a, b) => a.segments[0][0] - b.segments[0][0]);
  return { acc, length: maxRes || null, source: 'CDD', models, motifs };
}

// Intrinsically disordered regions — MobiDB-lite consensus. MobiDB returns many
// predictors; `prediction-disorder-mobidb_lite` is the consensus InterPro displays.
async function fetchDisorder(acc) {
  const res = await get(MOBIDB(acc));
  if (res.status === 404) return { acc, length: null, source: 'MobiDB-lite', regions: [] };
  if (!res.ok) throw new Error(`MobiDB ${acc}: HTTP ${res.status}`);
  const json = await res.json();
  const lite = json?.['prediction-disorder-mobidb_lite'];
  const regions = Array.isArray(lite?.regions)
    ? lite.regions
        .map((r) => [Number(r[0]), Number(r[1])])
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];
  const length = Number(json?.length) || regions.reduce((m, [, e]) => Math.max(m, e), 0) || null;
  return { acc, length, source: 'MobiDB-lite', regions };
}

// UniProt sequence features → variants (natural + mutagenesis + isoform alt-seq) and
// PTMs (modified residues, glyco/lipid, cross-links, disulfides). One request feeds
// both tracks. Uses rest.uniprot.org for the full alternativeSequence + descriptions.
async function fetchUniprotFeatures(acc) {
  const empty = {
    variants: { acc, length: null, source: 'UniProt', variants: [] },
    modifications: { acc, length: null, source: 'UniProt', modifications: [] },
  };
  const res = await get(UNIPROT_ENTRY(acc));
  if (res.status === 404) return empty;
  if (!res.ok) throw new Error(`UniProt entry ${acc}: HTTP ${res.status}`);
  const d = await res.json();
  const seq = d.sequence?.value ?? '';
  const length = seq.length || null;
  const variants = [];
  const modifications = [];
  for (const f of Array.isArray(d.features) ? d.features : []) {
    const begin = Number(f.location?.start?.value);
    const end = Number(f.location?.end?.value) || begin;
    if (!Number.isFinite(begin)) continue;
    const description = f.description || null;
    if (UNIPROT_VARIANT_TYPE[f.type]) {
      const alt = f.alternativeSequence;
      const variation = alt?.alternativeSequences?.length ? alt.alternativeSequences.join(',') : null;
      // Original residue(s): from the feature, else (for substitutions) the sequence.
      // A feature with no variation is a deletion ("Missing") — leave original null.
      const original = alt?.originalSequence ?? (variation && seq ? seq.slice(begin - 1, end) : null);
      variants.push({ type: UNIPROT_VARIANT_TYPE[f.type], begin, end, original: original || null, variation, description });
    } else if (UNIPROT_PTM_TYPE[f.type]) {
      modifications.push({ type: UNIPROT_PTM_TYPE[f.type], begin, end, description });
    }
  }
  return {
    variants: { acc, length, source: 'UniProt', variants },
    modifications: { acc, length, source: 'UniProt', modifications },
  };
}

// Download the AlphaFold model into structures/<acc>.bcif (BinaryCIF — ~2.3x smaller
// than text cif, lossless, Mol*-native). Query the prediction API first because the
// file version moves (currently v6). Large + gitignored. Skips if already present.
async function fetchAlphaFoldStructure(acc, structDir) {
  const out = resolve(structDir, `${acc}.bcif`);
  if (existsSync(out)) return; // resume: already downloaded
  const meta = await get(AF_PREDICTION(acc));
  if (!meta.ok) throw new Error(`AlphaFold prediction ${acc}: HTTP ${meta.status}`);
  const arr = await meta.json();
  const bcifUrl = Array.isArray(arr) && arr[0]?.bcifUrl;
  if (!bcifUrl) throw new Error(`AlphaFold ${acc}: no bcifUrl (no model?)`);
  const res = await get(bcifUrl);
  if (!res.ok) throw new Error(`AlphaFold bcif ${acc}: HTTP ${res.status}`);
  mkdirSync(structDir, { recursive: true });
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
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
  const domDir = resolve(outDir, 'domains');
  const interproDir = resolve(outDir, 'interpro');
  const cddDir = resolve(outDir, 'cdd');
  const disorderDir = resolve(outDir, 'disorder');
  const variantsDir = resolve(outDir, 'variants');
  const modificationsDir = resolve(outDir, 'modifications');
  const structDir = resolve(outDir, 'structures');
  mkdirSync(domDir, { recursive: true });
  mkdirSync(interproDir, { recursive: true });
  mkdirSync(cddDir, { recursive: true });
  mkdirSync(disorderDir, { recursive: true });
  mkdirSync(variantsDir, { recursive: true });
  mkdirSync(modificationsDir, { recursive: true });
  mkdirSync(resolve(RESOURCES, '_shared'), { recursive: true });
  const cathCache = loadCathCache();

  const list = accs ?? cdsAccessions(folder);
  console.log(`[fetch] ${folder}: ${list.length} protein(s), concurrency ${CONCURRENCY}`);

  let done = 0;
  await pool(list, CONCURRENCY, async (acc) => {
    const domOut = resolve(domDir, `${acc}.json`);
    if (!existsSync(domOut)) {
      try {
        const data = await fetchTedDomains(acc);
        for (const d of data.domains) d.cathName = await getCathName(d.cath, cathCache);
        writeFileSync(domOut, JSON.stringify(data, null, 2) + '\n');
      } catch (err) {
        console.error(`[fetch] ${acc}: domains FAILED — ${err.message}`);
      }
    }
    const interproOut = resolve(interproDir, `${acc}.json`);
    if (!existsSync(interproOut)) {
      try {
        writeFileSync(interproOut, JSON.stringify(await fetchInterproDomains(acc, cathCache), null, 2) + '\n');
      } catch (err) {
        console.error(`[fetch] ${acc}: interpro FAILED — ${err.message}`);
      }
    }
    const cddOut = resolve(cddDir, `${acc}.json`);
    if (!existsSync(cddOut)) {
      try {
        writeFileSync(cddOut, JSON.stringify(await fetchCddMotifs(acc), null, 2) + '\n');
      } catch (err) {
        console.error(`[fetch] ${acc}: cdd FAILED — ${err.message}`);
      }
    }
    const disorderOut = resolve(disorderDir, `${acc}.json`);
    if (!existsSync(disorderOut)) {
      try {
        const dis = await mobidbLimiter(() => fetchDisorder(acc));
        writeFileSync(disorderOut, JSON.stringify(dis, null, 2) + '\n');
      } catch (err) {
        console.error(`[fetch] ${acc}: disorder FAILED — ${err.message}`);
      }
    }
    const variantsOut = resolve(variantsDir, `${acc}.json`);
    const modificationsOut = resolve(modificationsDir, `${acc}.json`);
    if (!existsSync(variantsOut) || !existsSync(modificationsOut)) {
      try {
        const uf = await fetchUniprotFeatures(acc);
        writeFileSync(variantsOut, JSON.stringify(uf.variants, null, 2) + '\n');
        writeFileSync(modificationsOut, JSON.stringify(uf.modifications, null, 2) + '\n');
      } catch (err) {
        console.error(`[fetch] ${acc}: uniprot features FAILED — ${err.message}`);
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
