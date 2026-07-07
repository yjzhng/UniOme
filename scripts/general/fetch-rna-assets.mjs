#!/usr/bin/env node
// One-time, build-time fetch of RNA visualization assets into resources/. Local-first:
// this runs once; UniOme then serves everything from disk and never queries at view time.
//
// For each non-CDS RNA feature (rRNA, tRNA, tmRNA, ncRNA, …) it:
//   1. resolves an RNAcentral URS id + Sequence Ontology classification via EBI Search,
//   2. fetches the 2D (R2DT) secondary structure — dot-bracket + SVG layout,
//   3. discovers an experimental 3D structure (PDBe) via RNAcentral xrefs and downloads
//      its BinaryCIF (sparse — most ncRNAs have none),
//   4. writes an RnaEntry + a uniqID→URS index so the API can resolve a feature.
//
// Usage:
//   node scripts/fetch-rna-assets.mjs <taxid>                  # ALL non-CDS RNA features
//   node scripts/fetch-rna-assets.mjs <taxid> <uniqID> [...]   # specific features
//   node scripts/fetch-rna-assets.mjs                          # ssrA test (83333)
//
// Resumable: features whose entry JSON already exists are skipped, so it's safe to
// re-run / interrupt.

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const CONCURRENCY = 5; // ~8 requests/feature (md5 + up to 3 entry probes + SO + 2D + xrefs); keep gentle


// RNAcentral's genome-annotated E. coli K-12 strain (MG1655) — fallback taxid when our
// own annotation taxid has no species-specific record for an exact sequence.
const MG1655 = '511145';

// Exact-sequence lookup: RNAcentral keys every record on the md5 of the UPPERCASE DNA
// form of the sequence (U->T). The `taxid` filter returns the URS only when a
// species-specific record exists for that taxid — so this both resolves AND verifies
// existence in one call (no assuming URS_taxid exists for a sequence shared across
// organisms). Deterministic 1:1: an exact sequence maps to exactly one URS.
const RNA_BY_MD5 = (md5, taxid) =>
  `https://rnacentral.org/api/v1/rna?md5=${md5}` + (taxid ? `&taxid=${taxid}` : '');
// EBI Search entry-by-id — the SO classification (so_rna_type_name) lives only in the
// search layer, not the REST entry. The entry id is the species-specific URS_taxid, so
// this is a direct 1:1 fetch.
const EBI_ENTRY = (urs, taxid) =>
  `https://www.ebi.ac.uk/ebisearch/ws/rest/rnacentral/entry/${urs}_${taxid}` +
  `?fields=so_rna_type_name,rna_type,description&format=json`;
// RNAcentral REST — sequence/length, 2D layout, cross-references. Needs Accept: json and
// follows trailing-slash redirects (node fetch follows redirects by default).
const RNA_ENTRY = (urs) => `https://rnacentral.org/api/v1/rna/${urs}`;
const RNA_2D = (urs, taxid) => `https://rnacentral.org/api/v1/rna/${urs}/2d/${taxid}/`;
// page_size beyond ~500 tips this endpoint into returning the HTML SPA instead of JSON;
// 500 stays JSON. We scan a single page (no pagination): rRNAs surface their PDBe xrefs
// here, but ubiquitous RNAs (e.g. a tRNA shared across 200k+ genomes) bury PDBe beyond
// page 1 — those just won't auto-resolve a 3D structure (logged, not silently dropped).
const XREF_PAGE = 500;
const RNA_XREFS = (urs) => `https://rnacentral.org/api/v1/rna/${urs}/xrefs?page_size=${XREF_PAGE}`;
// RCSB serves BinaryCIF (Mol*-native, same as the protein panel) by PDB id.
const RCSB_BCIF = (pdbId) => `https://models.rcsb.org/${pdbId.toLowerCase()}.bcif`;
// RNAcentral rfam-hits — the Rfam family + clan + hit region for a sequence (universal,
// keyed by the bare URS). Trailing slash required.
const RFAM_HITS = (urs) => `https://rnacentral.org/api/v1/rna/${urs}/rfam-hits/?format=json`;
// BGSU RNA 3D Hub — FR3D loops (HL/IL/junctions) for a PDB. CSV: "loop_id","unit ids".
const BGSU_LOOPS = (pdb) => `https://rna.bgsu.edu/rna3dhub/loops/download/${pdb}`;

const UA = 'Mozilla/5.0 (UniOme rna-assets fetcher; research/local-first)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with backoff on rate-limit AND thrown network errors ("fetch failed" under load).
// Without retrying network errors, a transient failure returns null and is mistaken for
// "not found" — producing false misses (e.g. a real sequence logged as no-exact-sequence).
async function get(url, { json = false, attempt = 0 } = {}) {
  const headers = { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' };
  const backoff = () => sleep(Math.min(30000, 500 * 2 ** attempt) + Math.random() * 500);
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (attempt < 6) {
      await backoff();
      return get(url, { json, attempt: attempt + 1 });
    }
    throw err;
  }
  if ((res.status === 429 || res.status === 503) && attempt < 6) {
    const ra = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30000, 500 * 2 ** attempt) + Math.random() * 500);
    return get(url, { json, attempt: attempt + 1 });
  }
  return res;
}

// Map a taxid to its resources/<folder> (same `^(\d+)_` convention as the API).

// Non-CDS RNA features (rRNA, tRNA, tmRNA, ncRNA, misc_RNA, …) — the things that fold and
// live in RNAcentral. CDS-derived mRNA is excluded (no R2DT 2D, keeps the info-only view).
function rnaFeatures(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  if (!dbFile) throw new Error(`no *_DB.csv in ${folder}`);
  const text = readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8');
  const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  const out = [];
  for (const r of rows) {
    const type = (r.type ?? '').trim();
    if (!type || type === 'CDS' || !/rna/i.test(type)) continue;
    const uniqID = (r.uniqID ?? '').trim();
    if (!uniqID) continue;
    out.push({
      uniqID,
      type,
      gene: (r.gene ?? '').trim(),
      locus_tag: (r.locus_tag ?? '').trim(),
      product: (r.product ?? '').trim(),
      rna_seq: (r.rna_seq ?? '').trim(),
    });
  }
  return out;
}

// RNAcentral's sequence md5: md5 of the UPPERCASE DNA form (U->T) of the sequence.
function rnacentralMd5(rnaSeq) {
  return createHash('md5').update(rnaSeq.toUpperCase().replace(/U/g, 'T')).digest('hex');
}

// Look up a URS by exact sequence md5, scoped to a taxid. Returns the URS only when a
// species-specific record exists for that taxid (or any organism when taxid is null).
async function md5Lookup(md5, taxid) {
  let res;
  try {
    res = await get(RNA_BY_MD5(md5, taxid), { json: true });
  } catch {
    return null;
  }
  if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return null;
  let j;
  try {
    j = await res.json();
  } catch {
    return null;
  }
  const r = (j.results ?? [])[0];
  return r?.rnacentral_id ?? null;
}

// The species record for a URS+taxid (so_rna_type_name lineage + description + rna_type),
// from EBI Search's entry-by-id endpoint. Returns null when URS_taxid does NOT exist —
// which is how we detect a real species record (the SO data lives only in the search
// layer, not the REST entry). The id must be the full URS_taxid.
async function fetchSpeciesEntry(urs, taxid) {
  try {
    const res = await get(EBI_ENTRY(urs, taxid), { json: true });
    if (!res.ok) return null;
    const j = await res.json();
    const e = (Array.isArray(j?.entries) ? j.entries : [])[0];
    if (!e) return null; // URS_taxid is not a real species record
    const f = e.fields ?? {};
    return {
      lineage: f.so_rna_type_name ?? [],
      rnaType: (f.rna_type ?? [])[0] ?? null,
      description: (f.description ?? [])[0] ?? null,
    };
  } catch {
    return null;
  }
}

// Resolve a feature to a species-specific RNAcentral record by EXACT sequence — no name,
// coordinate, or fuzzy matching. (1) md5 → the unique URS for the sequence. (2) Choose a
// taxid that has a REAL species record by probing entry-by-id and falling through:
// our taxid → MG1655 (511145) → E. coli species (562). CRITICAL: we can't use
// /rna?md5=&taxid= for the existence check — that filter matches by taxonomy LINEAGE, so
// it returns a URS for an ancestor taxid (e.g. 83333) even when no discrete species record
// exists, producing a phantom URS_83333. entry-by-id exists only for genuine records.
// Returns {urs, taxid, md5, method, so} or {miss, md5?, urs?} explaining why.
//   miss 'no-sequence'        — feature has no rna_seq to hash
//   miss 'no-species-record'  — exact sequence is in RNAcentral but not under a known E. coli taxid
//   miss 'no-exact-sequence'  — exact sequence not in RNAcentral at all
const ECOLI_SPECIES = '562';
async function resolveUrs(feature, taxid) {
  if (!feature.rna_seq) return { miss: 'no-sequence' };
  const md5 = rnacentralMd5(feature.rna_seq);
  const urs = await md5Lookup(md5, null); // exact-sequence identity (any organism)
  if (!urs) return { miss: 'no-exact-sequence', md5 };
  for (const t of [...new Set([taxid, MG1655, ECOLI_SPECIES])]) {
    const so = await fetchSpeciesEntry(urs, t);
    if (so) return { urs, taxid: t, md5, method: t === taxid ? 'md5' : `md5@${t}`, so };
  }
  return { miss: 'no-species-record', md5, urs };
}

// RNAcentral sequence length for a URS (authoritative for the molecule).
async function fetchLength(urs) {
  try {
    const res = await get(RNA_ENTRY(urs), { json: true });
    if (!res.ok) return null;
    const j = await res.json();
    return Number(j?.length) || null;
  } catch {
    return null;
  }
}

// 2D (R2DT) layout for a URS in a given species: dot-bracket + template + SVG. Returns
// { meta, svg } or null. The SVG is stored separately (it's large) and served on its own.
async function fetch2d(urs, taxid) {
  const res = await get(RNA_2D(urs, taxid), { json: true });
  if (!res.ok) return null;
  const j = await res.json();
  const data = j?.data;
  if (!data) return null;
  const svg = typeof data.layout === 'string' ? data.layout : null;
  return {
    meta: {
      urs,
      taxid,
      dotBracket: data.secondary_structure ?? null,
      templateId: data.model_id ?? null,
      source: data.source ?? null,
      hasSvg: !!svg,
    },
    svg,
  };
}

// Best experimental 3D structure from RNAcentral xrefs (database === "PDBe"), preferring
// the finest resolution. Returns RnaPdbStructure or null.
async function fetchBestPdb(urs) {
  let res;
  try {
    res = await get(RNA_XREFS(urs), { json: true });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  // Guard against the HTML SPA fallback (very large xref lists) — not JSON, skip quietly.
  if (!/json/i.test(res.headers.get('content-type') ?? '')) return null;
  let j;
  try {
    j = await res.json();
  } catch {
    return null;
  }
  const results = Array.isArray(j?.results) ? j.results : [];
  const candidates = [];
  for (const x of results) {
    if (x.database !== 'PDBe' || x.is_active === false) continue;
    const acc = x.accession ?? {};
    const note = acc.pdb_structured_note ?? {};
    const pdbId = acc.external_id;
    if (!pdbId) continue;
    const resolution = note.resolution ?? null;
    candidates.push({
      pdbId,
      chain: acc.optional_id ?? null,
      title: note.structureTitle ?? null,
      resolution: resolution != null ? String(resolution) : null,
      method: note.experimentalTechnique ?? null,
      _res: Number(resolution),
    });
  }
  if (!candidates.length) {
    // More xref pages exist and we scanned only the first — a PDBe entry could be buried
    // beyond it. Surface that we didn't look exhaustively rather than implying "no 3D".
    if (j?.next) console.warn(`[fetch-rna] ${urs}: no PDBe in first ${XREF_PAGE} of ${j.count} xrefs — 3D not resolved`);
    return null;
  }
  // Finest resolution first; entries without a numeric resolution (e.g. NMR) sort last.
  candidates.sort((a, b) => {
    const ar = Number.isFinite(a._res) ? a._res : Infinity;
    const br = Number.isFinite(b._res) ? b._res : Infinity;
    return ar - br;
  });
  const best = candidates[0];
  delete best._res;
  return best;
}

// Download a PDB BinaryCIF into structures/<urs>.bcif. Skips if already present.
async function fetchStructure(pdbId, urs, structDir) {
  const out = resolve(structDir, `${urs}.bcif`);
  if (existsSync(out)) return true;
  const res = await get(RCSB_BCIF(pdbId));
  if (!res.ok) throw new Error(`RCSB bcif ${pdbId}: HTTP ${res.status}`);
  mkdirSync(structDir, { recursive: true });
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return true;
}

// Merge a sorted list of integers into [start,end] ranges (1-based positions stay as-is).
function toRanges(nums) {
  const out = [];
  for (const x of nums) {
    const last = out[out.length - 1];
    if (last && x === last[1] + 1) last[1] = x;
    else out.push([x, x]);
  }
  return out;
}
const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];

// Decode a dot-bracket string into structural-element features (1-based sequence ranges).
// Each feature has a `family` (stem | loop | junction | pseudoknot | end) used for the
// element name (Stem N / Loop N / Junction N) and colour, and a finer `type` (helix /
// hairpin / internal / bulge / K-way / …). Canonical pairs () build the helix tree;
// pseudoknot brackets ([ { <) become separate features. Loops are classified by how many
// child helices they enclose: 0 = hairpin, 1 = internal/bulge, >=2 = junction (K-way).
function decodeFeatures(db) {
  const n = db.length;
  const pair = new Array(n).fill(-1);
  const openP = [];
  const openPk = { '[': [], '{': [], '<': [] };
  const closePk = { ']': '[', '}': '{', '>': '<' };
  const pkPairs = [];
  for (let i = 0; i < n; i++) {
    const c = db[i];
    if (c === '(') openP.push(i);
    else if (c === ')') { const o = openP.pop(); if (o != null) { pair[o] = i; pair[i] = o; } }
    else if (c in openPk) openPk[c].push(i);
    else if (c in closePk) { const o = openPk[closePk[c]].pop(); if (o != null) pkPairs.push([o, i]); }
  }
  // Helices = maximal nested stacks of canonical pairs.
  const used = new Array(n).fill(false);
  const H = [];
  for (let i = 0; i < n; i++) {
    if (pair[i] > i && !used[i]) {
      let a = i, b = pair[i];
      const s5 = a, e3 = b;
      used[a] = used[b] = true;
      while (a + 1 < b - 1 && pair[a + 1] === b - 1) { a++; b--; used[a] = used[b] = true; }
      H.push({ s5, e5: a, s3: b, e3 });
    }
  }
  const parent = (h) => {
    let best = null;
    for (const g of H) if (g !== h && g.e5 < h.s5 && g.s3 > h.e3 && (!best || g.s3 - g.e5 < best.s3 - best.e5)) best = g;
    return best;
  };
  const kids = new Map(H.map((h) => [h, []]));
  for (const h of H) { const p = parent(h); if (p) kids.get(p).push(h); }

  const features = [];
  const count = {};
  const next = (k) => (count[k] = (count[k] ?? 0) + 1);
  // Stems (helices). length = base pairs.
  H.forEach((h) => {
    const i = next('stem');
    features.push({ key: `stem${i}`, family: 'stem', element: `Stem ${i}`, type: 'helix', length: h.e5 - h.s5 + 1, unit: 'bp', segments: [[h.s5 + 1, h.e5 + 1], [h.s3 + 1, h.e3 + 1]], observed3d: null });
  });
  // Loops enclosed by each helix's inner pair. length = unpaired nucleotides.
  H.forEach((h) => {
    const ks = kids.get(h).slice().sort((x, y) => x.s5 - y.s5);
    const unpaired = [];
    for (let x = h.e5 + 1; x < h.s3; x++) {
      if (pair[x] >= 0) continue;
      if (ks.some((c) => x >= c.s5 && x <= c.e3)) continue;
      unpaired.push(x + 1);
    }
    if (!unpaired.length && ks.length !== 0) return; // coaxial stack, no loop nucleotides
    const segs = toRanges(unpaired);
    const nt = segs.reduce((s, [a, b]) => s + (b - a + 1), 0);
    if (ks.length >= 2) {
      const i = next('junction');
      features.push({ key: `junction${i}`, family: 'junction', element: `Junction ${i}`, type: `${ks.length + 1}-way`, length: nt, unit: 'nt', segments: segs, observed3d: null });
    } else {
      let type = 'hairpin';
      if (ks.length === 1) { const c = ks[0]; type = c.s5 - 1 > h.e5 && h.s3 - 1 > c.e3 ? 'internal' : 'bulge'; }
      const i = next('loop');
      features.push({ key: `loop${i}`, family: 'loop', element: `Loop ${i}`, type, length: nt, unit: 'nt', segments: segs, observed3d: null });
    }
  });
  // Pseudoknot helices (group consecutive pk pairs). length = base pairs.
  const pkUsed = new Set();
  pkPairs.sort((a, b) => a[0] - b[0]);
  const pkMap = new Map(pkPairs.map(([x, y]) => [x, y]));
  for (const [o, c] of pkPairs) {
    if (pkUsed.has(o)) continue;
    let a = o, b = c;
    pkUsed.add(a);
    while (pkMap.get(a + 1) === b - 1) { a++; b--; pkUsed.add(a); }
    const i = next('pseudoknot');
    features.push({ key: `pseudoknot${i}`, family: 'pseudoknot', element: `Pseudoknot ${i}`, type: 'pseudoknot', length: a - o + 1, unit: 'bp', segments: [[o + 1, a + 1], [b + 1, c + 1]], observed3d: null });
  }
  // Unpaired ends/linkers outside every helix. length = nucleotides.
  const outside = [];
  for (let i = 0; i < n; i++) {
    if (pair[i] >= 0) continue;
    if (H.some((h) => i > h.e5 && i < h.s3)) continue;
    outside.push(i + 1);
  }
  let linker = 0;
  toRanges(outside).forEach((seg) => {
    const nt = seg[1] - seg[0] + 1;
    const five = seg[0] === 1, three = seg[1] === n;
    const element = five ? `5′ end` : three ? `3′ end` : `Linker ${++linker}`;
    const key = five ? 'end5' : three ? 'end3' : `linker${linker}`;
    features.push({ key, family: 'end', element, type: 'terminus', length: nt, unit: 'nt', segments: [seg], observed3d: null });
  });
  features.sort((a, b) => a.segments[0][0] - b.segments[0][0]);
  return features;
}

// our_pos (1-based) → template position number, parsed from the R2DT SVG <title>s
// ("<g><title>P (position.label in template: T.X)…"). Sprinzl numbering for tRNA, E. coli
// SSU numbering for 16S — the canonical coordinate systems functional parts are defined in.
function templateMap(svg) {
  const m = new Map();
  const re = /<title>(\d+) \(position\.label in template: (\d+)/g;
  let x;
  while ((x = re.exec(svg))) {
    const our = Number(x[1]);
    if (our >= 1) m.set(our, Number(x[2])); // skip the 5' marker (index 0)
  }
  return m;
}

// Build regions by classifying each nucleotide's template position. `test(t)` selects the
// positions belonging to a region; contiguous runs become segments (so a two-stranded arm
// yields two segments).
function buildRegions(tmap, specs) {
  const out = [];
  for (const spec of specs) {
    const ps = [...tmap.entries()].filter(([, t]) => spec.test(t)).map(([p]) => p).sort((a, b) => a - b);
    if (!ps.length) continue;
    // `contiguous` regions (rRNA domains) collapse to one span min..max, filling template
    // insertion gaps; others (e.g. a two-stranded tRNA arm) keep their separate runs.
    const segments = spec.contiguous ? [[ps[0], ps[ps.length - 1]]] : toRanges(ps);
    const length = segments.reduce((s, [a, b]) => s + (b - a + 1), 0);
    out.push({ key: spec.key, label: spec.label, detail: spec.detail ?? null, length, unit: 'nt', segments });
  }
  return out;
}

// CRW/RiboVision helix → E. coli residue tables, fetched once. resNum = E. coli residue
// (== our template position for rRNA), Helix_Num = bare helix id ("1", "44", "25a", "5S1").
// LSU file has a spurious type-declaration row (resNum non-numeric) — skipped by Number().
const RIBOVISION = (f) => `https://raw.githubusercontent.com/RiboZones/RiboVision/master/Tables/${f}`;
let _helixCache = null;
async function loadHelixTables() {
  if (_helixCache) return _helixCache;
  const out = { ssu: new Map(), lsu23s: new Map(), lsu5s: new Map() };
  const parseInto = (text, pick) => {
    for (const r of Papa.parse(text, { header: true, skipEmptyLines: true }).data) {
      const n = Number(r.resNum);
      const h = (r.Helix_Num || '').trim();
      if (Number.isInteger(n) && h) pick(n, h, (r.ChainID || '').trim());
    }
  };
  try {
    const res = await get(RIBOVISION('EC_SSU_3D.csv'));
    if (res.ok) parseInto(await res.text(), (n, h) => out.ssu.set(n, h));
  } catch (err) {
    console.error(`[fetch-rna] SSU helix table FAILED — ${err.message}`);
  }
  try {
    const res = await get(RIBOVISION('EC_LSU_3D.csv'));
    if (res.ok) parseInto(await res.text(), (n, h, c) => (c === 'B' ? out.lsu5s : out.lsu23s).set(n, h));
  } catch (err) {
    console.error(`[fetch-rna] LSU helix table FAILED — ${err.message}`);
  }
  _helixCache = out;
  return out;
}

// Group our positions into helices via template(=E.coli)→helix lookup; ordered 5'→3'.
function helixRegions(tmap, resToHelix, prefix) {
  if (!resToHelix || !resToHelix.size) return [];
  const byHelix = new Map();
  for (const [ourPos, eRes] of tmap) {
    const hid = resToHelix.get(eRes);
    if (!hid) continue;
    if (!byHelix.has(hid)) byHelix.set(hid, []);
    byHelix.get(hid).push(ourPos);
  }
  return [...byHelix.entries()]
    .map(([hid, ps]) => {
      ps.sort((a, b) => a - b);
      return { key: `helix_${hid}`, label: `${prefix}${hid}`, detail: null, length: ps.length, unit: 'nt', segments: toRanges(ps), _min: ps[0] };
    })
    .sort((a, b) => a._min - b._min)
    .map(({ _min, ...r }) => r);
}

// Functional layers for a family. tRNA → arms (Sprinzl); 16S → domains + helices; 23S/5S
// → helices. Helix numbers come from the RiboVision E. coli tables. Others → none.
async function functionalRegions(rfamAcc, svg, rnaSeq) {
  if (!svg) return { regionLayers: [] };
  const tmap = templateMap(svg);
  if (!tmap.size) return { regionLayers: [] };
  if (rfamAcc === 'RF00005') {
    const acPos = [...tmap.entries()].filter(([, t]) => t >= 34 && t <= 36).map(([p]) => p).sort((a, b) => a - b);
    const anticodon = rnaSeq && acPos.length ? acPos.map((p) => rnaSeq[p - 1]).join('') : null;
    const arms = buildRegions(tmap, [
      { key: 'acceptor', label: 'Acceptor stem', test: (s) => (s >= 1 && s <= 7) || (s >= 66 && s <= 72) },
      { key: 'darm', label: 'D-arm', test: (s) => s >= 10 && s <= 25 },
      { key: 'acarm', label: 'Anticodon arm', test: (s) => s >= 27 && s <= 43 },
      { key: 'anticodon', label: 'Anticodon', detail: anticodon, test: (s) => s >= 34 && s <= 36 },
      { key: 'variable', label: 'Variable loop', test: (s) => s >= 44 && s <= 48 },
      { key: 'tarm', label: 'T-arm', test: (s) => s >= 49 && s <= 65 },
    ]);
    return { regionLayers: [{ label: 'Arms', regions: arms }] };
  }
  if (rfamAcc === 'RF00177') {
    const domains = buildRegions(tmap, [
      { key: 'd5', label: '5′ domain', contiguous: true, test: (t) => t <= 560 },
      { key: 'dc', label: 'Central domain', contiguous: true, test: (t) => t >= 561 && t <= 912 },
      { key: 'd3major', label: '3′ major domain', contiguous: true, test: (t) => t >= 913 && t <= 1396 },
      { key: 'd3minor', label: '3′ minor domain', contiguous: true, test: (t) => t >= 1397 },
    ]);
    const helices = helixRegions(tmap, (await loadHelixTables()).ssu, 'h');
    const layers = [{ label: 'Domains', regions: domains }];
    if (helices.length) layers.push({ label: 'Helices', regions: helices });
    return { regionLayers: layers };
  }
  if (rfamAcc === 'RF02541') {
    const helices = helixRegions(tmap, (await loadHelixTables()).lsu23s, 'H');
    return { regionLayers: helices.length ? [{ label: 'Helices', regions: helices }] : [] };
  }
  if (rfamAcc === 'RF00001') {
    const helices = helixRegions(tmap, (await loadHelixTables()).lsu5s, '');
    return { regionLayers: helices.length ? [{ label: 'Helices', regions: helices }] : [] };
  }
  return { regionLayers: [] };
}

// Rfam family/clan for a URS (universal, keyed by sequence).
async function fetchRfamHits(urs) {
  try {
    const res = await get(RFAM_HITS(urs), { json: true });
    if (!res.ok) return null;
    const r = ((await res.json()).results ?? [])[0];
    if (!r) return null;
    const m = r.rfam_model ?? {};
    return {
      acc: m.rfam_model_id ?? null,
      id: m.short_name ?? null,
      clan: m.rfam_clan?.rfam_clan_id ?? null,
      rnaType: m.rna_type ?? null,
      start: r.sequence_start ?? null, // hit region on the sequence (0-based start)
      end: r.sequence_stop ?? null,
    };
  } catch {
    return null;
  }
}

// FR3D loops (HL/IL/junctions) for a PDB chain from RNA 3D Hub. Returns [{loopId, type,
// ranges}] with ranges in PDB residue number (≈ sequence position for these RNAs).
async function fetch3dHubLoops(pdbId, chain) {
  if (!pdbId || !chain) return [];
  try {
    const res = await get(BGSU_LOOPS(pdbId));
    if (!res.ok || !/text|csv|plain/i.test(res.headers.get('content-type') ?? '')) return [];
    const text = await res.text();
    const loops = [];
    for (const line of text.trim().split('\n')) {
      const m = line.match(/^"([^"]+)","([^"]+)"/);
      if (!m) continue;
      const loopId = m[1];
      const units = m[2].split(',').map((s) => s.split('|'));
      const nums = [...new Set(units.filter((p) => p[2] === chain).map((p) => Number(p[4])).filter(Number.isFinite))].sort((a, b) => a - b);
      if (nums.length) loops.push({ loopId, type: loopId.split('_')[0], ranges: toRanges(nums) });
    }
    return loops;
  } catch {
    return [];
  }
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
  let only; // null = all RNA features; else a Set of uniqIDs
  if (args.length === 0) {
    taxid = '83333';
    only = null; // ssrA test resolved from the org's features below
  } else if (args.length === 1) {
    taxid = args[0];
    only = null;
  } else {
    taxid = args[0];
    only = new Set(args.slice(1));
  }

  const folder = orgFolder(taxid);
  const rnaDir = resolve(RESOURCES, folder, 'rna');
  const entriesDir = resolve(rnaDir, 'entries');
  const twoDDir = resolve(rnaDir, '2d');
  const structDir = resolve(rnaDir, 'structures');
  const featuresDir = resolve(rnaDir, 'features');
  mkdirSync(entriesDir, { recursive: true });
  mkdirSync(twoDDir, { recursive: true });
  mkdirSync(featuresDir, { recursive: true });

  let features = rnaFeatures(folder);
  if (only) features = features.filter((f) => only.has(f.uniqID));
  console.log(`[fetch-rna] ${folder}: ${features.length} RNA feature(s), concurrency ${CONCURRENCY}`);

  // Index map: uniqID → { urs, taxid }. Merged with any existing index so re-runs over a
  // subset don't drop previously-resolved features.
  const indexPath = resolve(rnaDir, 'index.json');
  let index = {};
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    /* first run */
  }

  let done = 0;
  let resolved = 0;
  const tally = { 'no-sequence': 0, 'no-species-record': 0, 'no-exact-sequence': 0 };
  const misses = [];
  await pool(features, CONCURRENCY, async (f) => {
    try {
      // Resume: a written index entry + entry JSON means this feature is finished.
      const known = index[f.uniqID];
      if (known && existsSync(resolve(entriesDir, `${known.urs}.json`))) {
        resolved++;
        return;
      }
      const r = await resolveUrs(f, taxid);
      if (r.miss) {
        tally[r.miss] = (tally[r.miss] ?? 0) + 1;
        misses.push({ uniqID: f.uniqID, label: f.gene || f.locus_tag || f.type, reason: r.miss });
        console.warn(`[fetch-rna] ${f.uniqID} (${f.gene || f.locus_tag || f.type}): ${r.miss}`);
        return;
      }
      const { urs, taxid: ursTaxid, method, so } = r;
      tally[method] = (tally[method] ?? 0) + 1;

      // 2D structure (dot-bracket + SVG).
      const svgPath = resolve(twoDDir, `${urs}.svg`);
      let dotBracket = null;
      let svgText = null;
      try {
        const two = await fetch2d(urs, ursTaxid);
        if (two) {
          dotBracket = two.meta.dotBracket;
          svgText = two.svg;
          writeFileSync(resolve(twoDDir, `${urs}.json`), JSON.stringify(two.meta, null, 2) + '\n');
          if (two.svg) writeFileSync(svgPath, two.svg);
        }
      } catch (err) {
        console.error(`[fetch-rna] ${urs}: 2D FAILED — ${err.message}`);
      }
      // Authoritative: a 2D view exists iff the SVG is on disk (a transient fetch failure
      // this run won't drop a previously-saved layout).
      const has2d = existsSync(svgPath);

      // Optional experimental 3D (PDBe → RCSB bcif).
      let pdb = null;
      try {
        pdb = await fetchBestPdb(urs);
        if (pdb) await fetchStructure(pdb.pdbId, urs, structDir);
      } catch (err) {
        console.error(`[fetch-rna] ${urs}: 3D FAILED — ${err.message}`);
        pdb = null;
      }

      const length = await fetchLength(urs);
      const entry = {
        uniqID: f.uniqID,
        urs,
        taxid: ursTaxid,
        description: so.description,
        length,
        so: { lineage: so.lineage, rnaType: so.rnaType },
        has2d,
        pdb,
      };
      writeFileSync(resolve(entriesDir, `${urs}.json`), JSON.stringify(entry, null, 2) + '\n');

      // Feature track: structural elements decoded from the dot-bracket + Rfam family +
      // "observed in 3D" flags from RNA 3D Hub loops (when an experimental structure exists).
      if (dotBracket) {
        try {
          const feats = decodeFeatures(dotBracket);
          const loops3d = pdb ? await fetch3dHubLoops(pdb.pdbId, pdb.chain) : [];
          // Match a 2D loop/junction to the 3D Hub loop types it could be (HL→hairpin,
          // IL→internal/bulge, J*→K-way junction). Stems/ends aren't loops, so never flagged.
          const types3dFor = (ft) =>
            ft.type === 'hairpin' ? ['HL'] : ft.type === 'internal' || ft.type === 'bulge' ? ['IL'] : ft.type.endsWith('-way') ? ['J3', 'J4', 'J5', 'J6', 'J7'] : null;
          for (const ft of feats) {
            const types = types3dFor(ft);
            if (!types) continue;
            const hit = loops3d.find((l) => types.includes(l.type) && l.ranges.some((r) => ft.segments.some((s) => overlaps(r, s))));
            ft.observed3d = hit ? hit.loopId : null;
          }
          const rfam = await fetchRfamHits(urs);
          const { regionLayers } = await functionalRegions(rfam?.acc, svgText, f.rna_seq);
          const featuresDoc = { urs, taxid: ursTaxid, length, rfam, features: feats, regionLayers };
          writeFileSync(resolve(featuresDir, `${urs}.json`), JSON.stringify(featuresDoc, null, 2) + '\n');
        } catch (err) {
          console.error(`[fetch-rna] ${urs}: features FAILED — ${err.message}`);
        }
      }
      index[f.uniqID] = { urs, taxid: ursTaxid };
      resolved++;
    } catch (err) {
      console.error(`[fetch-rna] ${f.uniqID}: FAILED — ${err.message}`);
    } finally {
      if (++done % 25 === 0 || done === features.length) {
        writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
        console.log(`[fetch-rna] progress ${done}/${features.length} (${resolved} resolved)`);
      }
    }
  });

  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  console.log(`\n[fetch-rna] done: ${resolved}/${features.length} resolved`);
  console.log('[fetch-rna] resolution breakdown:', JSON.stringify(tally));
  if (misses.length) {
    console.log(`[fetch-rna] ${misses.length} unresolved:`);
    for (const m of misses) console.log(`   ${m.uniqID} (${m.label}) — ${m.reason}`);
  }
}

main();
