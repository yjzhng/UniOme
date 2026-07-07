#!/usr/bin/env node
// Builds the per-gene REGULATORY MAP for B. subtilis subsp. subtilis str. 168 (taxid 224308):
// the positional regulatory architecture of each gene — promoter(s), transcription-factor binding
// sites (with activator/repressor effect) and terminator(s) — anchored to the gene they regulate,
// in NC_000964.3 chromosome coordinates. Mirrors the E. coli build-regulatory-map.mjs OUTPUT
// contract exactly:
//   resources/<org>/regulation/regulatory-map.json:
//     { uniqID: { features: [{ kind, name, start, end, strand, effect?, sigma? }],
//                 context: [{ uniqID, gene, start, end, strand, operon }] } }
//   where `features` are the gene's own promoter(s)/TFBS/terminator(s) in chromosome coords and
//   `context` is the gene's neighbourhood — its operon co-members plus the immediately flanking
//   gene on each side — for spatial context on the map. Following the API contract, a per-gene
//   record is written ONLY when the gene has at least one positional feature (an all-empty-features
//   map is treated as "no map" by the API, so we never emit one).
//
// SOURCE — POSITIONAL DATA: DBTBS (Database of Transcriptional regulation in Bacillus subtilis,
// https://dbtbs.hgc.jp/), the classic curated source of EXPERIMENTALLY-MAPPED promoters (with their
// sigma factor), TF binding sites (with regulation mode) and Rho-independent terminators, each with
// an ABSOLUTE genome position and the cis-element sequence. DBTBS positions are on the B. subtilis
// 168 reference (AL009126 == NC_000964.3): verified by exact sequence-anchoring — every cis-element
// matches the reference genome (fwd or rev-comp) at its stated absolute position, which also yields
// the feature strand. We read the per-operon pages COG/prom/<operon>.html (1160 of them; listed in
// promtable.html), each of which carries the operon's gene list (with genome positions), its
// promoter/TFBS table and its terminator table.
//   SubtiWiki v5 (used for operons/regulons elsewhere) carries NO positional regulatory coordinates
//   — its regulation model is purely topological — so DBTBS is the positional source here. Operon
//   co-membership for `context` comes from the SubtiWiki operons already cached for this organism;
//   we also fall back to DBTBS operon gene-lists.
//
// We do NOT fabricate positions: a feature is emitted only with DBTBS's real absolute position. If
// DBTBS is unreachable, the builder writes an empty map {} and reports it.
//
// Usage: node scripts/organisms/224308_Bs/build-regulatory-map.mjs [taxid=224308]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, findDb } from '../../lib/org.mjs';

const DBTBS = 'https://dbtbs.hgc.jp'; // Database of Transcriptional regulation in B. subtilis
const SW_OPERONS = 'subtiwiki_operons.json'; // already cached by build-regulation.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache any downloaded source under <org>/_assets/regulation/dbtbs/ (build-time, resumable).
async function fetchCached(url, cacheFile, { json = false, optional = false } = {}) {
  if (existsSync(cacheFile)) {
    const t = readFileSync(cacheFile, 'utf8');
    return json ? JSON.parse(t) : t;
  }
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) { if (optional) return null; throw new Error('HTTP 404'); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      writeFileSync(cacheFile, t);
      return json ? JSON.parse(t) : t;
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(15000, 500 * 2 ** attempt) + Math.random() * 400);
    }
  }
  if (optional) return null;
  throw new Error(`failed to fetch ${url}: ${lastErr?.message}`);
}

// GenBank coord → {start,end,strand} (start = lowest position regardless of join/complement).
function parseCoordRange(coord) {
  const nums = (String(coord).match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums), strand: /complement/.test(coord) ? '-' : '+' };
}

// ── HTML helpers (DBTBS pages are simple static tables) ──────────────────────────────────────────
const stripTags = (s) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
function tableRows(html) {
  return [...html.split(/<tr\b/i).slice(1)].map((blk) => {
    const cells = [...blk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
    return cells.map(stripTags);
  });
}

// ── Reference genome (for strand-anchoring each feature) ─────────────────────────────────────────
function loadGenome(folder) {
  const f = resolve(RESOURCES, folder, '_assets', 'conservation', 'ref.fna');
  if (!existsSync(f)) return null;
  const lines = readFileSync(f, 'utf8').split('\n');
  return lines.filter((l) => l && !l.startsWith('>')).join('').toUpperCase();
}
const COMP = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
const rc = (s) => [...s.toUpperCase()].reverse().map((c) => COMP[c] ?? c).join('');

function dbIndex(taxid) {
  const dbFile = findDb(taxid);
  const rows = Papa.parse(readFileSync(dbFile, 'utf8'), { header: true, skipEmptyLines: true }).data;
  const byName = new Map(), byUniq = new Map();
  let genomeLen = 0;
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim(); if (!uniqID) continue;
    if (!genomeLen) genomeLen = Number(r.chrom_len) || 0;
    const gn = (r.gene ?? '').trim();
    if (gn && !byName.has(gn.toLowerCase())) byName.set(gn.toLowerCase(), { uniqID, gene: gn });
    const c = parseCoordRange(r.coord);
    if (c && !byUniq.has(uniqID)) byUniq.set(uniqID, { uniqID, gene: gn, start: c.start, end: c.end, strand: c.strand });
  }
  const ordered = [...byUniq.values()].sort((a, b) => a.start - b.start);
  const indexOf = new Map(ordered.map((g, i) => [g.uniqID, i]));
  return { byName, byUniq, ordered, indexOf, genomeLen };
}

// Operon co-membership for context, from SubtiWiki's cached operons (uniqID → Set(co-members)).
function loadSwOperons(assetDir, resolveName) {
  const f = resolve(assetDir, SW_OPERONS);
  const operonOf = new Map();
  if (!existsSync(f)) return operonOf;
  const operons = JSON.parse(readFileSync(f, 'utf8'))?.data ?? [];
  for (const op of operons) {
    const members = new Set();
    for (const g of op.genes ?? []) { const ours = resolveName((g?.name ?? '').trim()); if (ours) members.add(ours.uniqID); }
    for (const u of members) {
      if (!operonOf.has(u)) operonOf.set(u, new Set());
      for (const v of members) if (v !== u) operonOf.get(u).add(v);
    }
  }
  return operonOf;
}

// DBTBS Regulation column → effect. "Promoter" marks a promoter row (sigma in the factor column).
const REG_TO_FN = { positive: 'activator', negative: 'repressor', 'positive/negative': 'dual' };

async function main() {
  const taxid = process.argv[2] || '224308';
  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'regulation');
  const assetDir = resolve(RESOURCES, folder, '_assets', 'regulation');
  const dbtbsDir = resolve(assetDir, 'dbtbs');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dbtbsDir, { recursive: true });

  const db = dbIndex(taxid);
  const { byName, byUniq, ordered, indexOf } = db;
  const genome = loadGenome(folder);
  if (!genome) console.warn('[regmap] WARN: no ref.fna — strand anchored from operon direction only');

  // Resolve a DBTBS gene reference (symbol or synonym) to our { uniqID, gene }. Synonyms are filled
  // from the operon pages themselves as we parse them.
  const synToName = new Map();
  const resolveName = (name) => {
    const n = (name ?? '').trim(); if (!n) return null;
    return byName.get(n.toLowerCase()) ?? (synToName.has(n.toLowerCase()) ? byName.get(synToName.get(n.toLowerCase())) : null) ?? null;
  };

  // 1) The operon page list (promtable.html → COG/prom/<operon>.html).
  console.log('[regmap] DBTBS promoter table (promtable.html)…');
  const promTable = await fetchCached(`${DBTBS}/promtable.html`, resolve(dbtbsDir, 'promtable.html'));
  const operonPages = [...new Set([...promTable.matchAll(/COG\/prom\/([^"']+?)\.html/gi)].map((m) => m[1]))];
  console.log(`  ${operonPages.length} operon pages`);

  // strand of a feature from its cis-element sequence vs the reference at its absolute position.
  const strandOf = (start, end, seq, operonStrand) => {
    if (genome && seq) {
      const sub = genome.slice(start - 1, end);
      const s = seq.replace(/[^ACGTacgt]/g, '').toUpperCase();
      if (s && sub === s) return '+';
      if (s && rc(sub) === s) return '-';
    }
    return operonStrand ?? '+';
  };

  const perGene = new Map(); // uniqID → Map(dedupKey → feature)
  const addFeature = (uniqIDs, feat) => {
    for (const u of uniqIDs) {
      if (!perGene.has(u)) perGene.set(u, new Map());
      perGene.get(u).set(`${feat.kind}:${feat.start}:${feat.end}:${feat.name}`, feat);
    }
  };

  let pages = 0, promoters = 0, tfbs = 0, terminators = 0, unresolved = 0;
  for (const op of operonPages) {
    const html = await fetchCached(`${DBTBS}/COG/prom/${op}.html`, resolve(dbtbsDir, `prom_${op.replace(/[^\w.-]/g, '_')}.html`), { optional: true });
    if (!html) continue;
    pages++;
    const rows = tableRows(html);

    // a) operon genes: rows of [gene, synonym, direction, start..end, ...]. Collect their uniqIDs
    //    (the features anchor to every gene of the operon) + register synonyms.
    const opGenes = []; // { gene, uniqID, start, end, strand }
    let operonStrand = null;
    for (const c of rows) {
      if (c.length < 4) continue;
      const posM = (c[3] ?? '').match(/^(\d+)\.\.(\d+)$/);
      const dir = c[2];
      if (!posM || !/^[+-]$/.test(dir)) continue;
      const gene = c[0], syn = c[1];
      if (gene && syn) synToName.set(syn.toLowerCase(), gene.toLowerCase());
      const ours = resolveName(gene) ?? resolveName(syn);
      operonStrand = dir;
      if (ours) opGenes.push({ ...ours, start: +posM[1], end: +posM[2], strand: dir });
    }
    const opUniqIDs = [...new Set(opGenes.map((g) => g.uniqID))];
    if (!opUniqIDs.length) { unresolved++; continue; }

    // b) promoter / TFBS rows: [factor, regulation, location, start..end, cis-seq, ...].
    for (const c of rows) {
      if (c.length < 5) continue;
      const posM = (c[3] ?? '').match(/^(\d+)\.\.(\d+)$/);
      if (!posM) continue;
      const factor = (c[0] ?? '').trim();
      const reg = (c[1] ?? '').trim();
      if (!factor || !reg) continue;
      const start = +posM[1], end = +posM[2];
      if (start > end) continue; // origin-wrapping element (e.g. 4215593..10) — not representable as a single [start,end] block
      const seq = c[4] ?? '';
      const strand = strandOf(start, end, seq, operonStrand);

      if (/^promoter$/i.test(reg)) {
        // factor = the sigma factor recognising this promoter (e.g. SigA, SigK, SigL).
        addFeature(opUniqIDs, { kind: 'promoter', name: factor, start, end, strand, effect: null, sigma: [factor] });
        promoters++;
      } else if (REG_TO_FN[reg.toLowerCase()] !== undefined || /^nd$/i.test(reg)) {
        // factor = the TF; reg = Positive/Negative/Positive-Negative (or ND = effect unknown).
        const effect = REG_TO_FN[reg.toLowerCase()] ?? null;
        addFeature(opUniqIDs, { kind: 'tf_binding_site', name: factor, start, end, strand, effect });
        tfbs++;
      }
    }

    // c) terminator rows: [term-seq, start..end, position-from-stop, free-energy, downstream-of].
    for (const c of rows) {
      if (c.length < 5) continue;
      const posM = (c[1] ?? '').match(/^(\d+)\.\.(\d+)$/);
      if (!posM) continue;
      const downstreamOf = (c[4] ?? '').trim();
      // Terminator rows: a cis-sequence in col0 (may carry >>>/<<< arrow markers + spaces), a
      // "Downstream of" gene in col4, and a numeric free energy in col3 — the latter two are the
      // reliable discriminators (excludes promoter/TFBS rows, whose col3 is an absolute position).
      const seq = (c[0] ?? '').replace(/[^ACGTacgt]/g, '');
      if (!seq || !downstreamOf) continue;
      if (!/^-?\d+(\.\d+)?$/.test((c[3] ?? '').trim())) continue; // free-energy sanity
      const start = +posM[1], end = +posM[2];
      if (start > end) continue; // origin-wrapping element — not representable as a single [start,end] block
      const strand = strandOf(start, end, seq, operonStrand);
      const target = resolveName(downstreamOf);
      const anchor = target ? [target.uniqID] : opUniqIDs;
      addFeature(anchor, { kind: 'terminator', name: `terminator (${downstreamOf})`, start, end, strand, effect: null });
      terminators++;
    }
  }
  console.log(`  parsed ${pages} pages → ${promoters} promoters, ${tfbs} TFBS, ${terminators} terminators (${unresolved} pages with no resolvable gene)`);

  // 2) context: operon co-members (SubtiWiki) + immediate flanking gene on each side.
  const operonOf = loadSwOperons(assetDir, resolveName);
  const contextFor = (uniqID) => {
    const ctx = new Map();
    for (const u of operonOf.get(uniqID) ?? []) { const g = byUniq.get(u); if (g) ctx.set(u, { ...g, operon: true }); }
    const i = indexOf.get(uniqID);
    if (i != null) for (const j of [i - 1, i + 1]) {
      const g = ordered[j];
      if (g && g.uniqID !== uniqID && !ctx.has(g.uniqID)) ctx.set(g.uniqID, { ...g, operon: false });
    }
    return [...ctx.values()].sort((a, b) => a.start - b.start);
  };

  // 3) write a record ONLY for genes with ≥1 positional feature (empty-features map == "no map").
  const out = {};
  for (const [uniqID, m] of perGene) {
    if (!m.size || !byUniq.has(uniqID)) continue;
    out[uniqID] = { features: [...m.values()].sort((a, b) => a.start - b.start), context: contextFor(uniqID) };
  }
  const file = resolve(outDir, 'regulatory-map.json');
  writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]])), null, 0) + '\n');

  const tally = {}; let withEffect = 0, feats = 0, ctx = 0;
  for (const e of Object.values(out)) {
    ctx += e.context.length;
    for (const f of e.features) { tally[f.kind] = (tally[f.kind] ?? 0) + 1; feats++; if (f.effect) withEffect++; }
  }
  console.log(`[regmap] wrote ${file}`);
  console.log(`[regmap] ${Object.keys(out).length} genes, ${feats} positional features (${withEffect} with effect), ${ctx} context genes`);
  console.log('[regmap] by kind:', JSON.stringify(tally));
  if (!feats) console.log('[regmap] NOTE: no positional features placed — wrote empty map {} (no positions fabricated).');
}

main().catch((e) => { console.error(e); process.exit(1); });
