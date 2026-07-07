#!/usr/bin/env node
// Builds the per-gene REGULATORY MAP for S. aureus NCTC 8325 (taxid 93061): the positional
// regulatory architecture of each gene — its transcription-factor binding site(s) with
// activator/repressor effect — anchored to the gene they regulate, in NCTC 8325 chromosome
// coordinates (NC_007795.1). Mirrors the E. coli builder's OUTPUT contract exactly:
//   resources/<org>/regulation/regulatory-map.json:
//     { uniqID: { features: [{ kind, name, start, end, strand, effect? }],
//                 context: [{ uniqID, gene, start, end, strand, operon }] } }
//   where `context` is the gene's neighbourhood — its operon co-members plus the immediately
//   flanking gene on each side.
//
// Usage: node scripts/organisms/93061_Sa/build-regulatory-map.mjs [taxid]   (default 93061)
//
// POSITIONAL SOURCE & how the coordinates are made REAL on OUR reference:
//   RegPrecise 3.2 (regprecise.lbl.gov) is the only curated machine-readable TRN for S. aureus, but
//   its ONLY S. aureus genome is N315 (a DIFFERENT assembly from our NCTC 8325). RegPrecise's binding
//   sites are given as (Position relative to the regulated operon's first gene, Score, 14–20-bp motif
//   SEQUENCE) on N315 — so the raw "Position" is N315-relative and CANNOT be transferred to
//   NC_007795.1 directly. We therefore do NOT copy N315 positions. Instead we place each site by its
//   MOTIF SEQUENCE: we map the regulated N315 gene onto our NCTC 8325 gene (AureoWiki N315→SAOUHSC_
//   orthologue crosswalk, already cached) and search the motif (both strands) in the NCTC 8325 genome
//   within a window around that gene's start. When the motif occurs exactly once near the right gene
//   (the overwhelming case — the binding site is conserved between the two strains and the relative
//   Position corroborates the placement), that genome hit is a GENUINE NC_007795.1 coordinate. Sites
//   whose motif can't be uniquely placed near the mapped gene are dropped (never approximated).
//   Regulator effect = RegPrecise "Regulation mode" (activator | repressor | dual).
//
//   Inputs reused from build-regulation.mjs's cache under <org>/_assets/:
//     regprecise_genome_26.html, regprecise_regulon_<id>.html (binding sites + mode + TF locus),
//     aureowiki_orthologue_N315_NCTC8325.tsv (N315→SAOUHSC_ crosswalk).
//   Genome FASTA: <org>/_assets/conservation/.../GCF_000013425.1_..._genomic.fna (NCTC 8325).
//   Operons: the blank-line-separated operon groups in the RegPrecise gene exports
//     (regprecise_genes_<id>.tsv) — the only operon signal RegPrecise exposes — → `context`.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const RP = 'https://regprecise.lbl.gov';
const RP_GENOME_ID = 26; // S. aureus N315 — the only RegPrecise S. aureus genome
const REF_CHROM = 'NC_007795.1';
const MIN_MOTIF = 8;       // ignore short tooltip artefacts (real motifs are 14–20 bp)
const ANCHOR_WINDOW = 600; // a motif hit must lie within this many bp of the mapped gene's start

const COMP = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const rc = (s) => s.split('').reverse().map((b) => COMP[b] ?? 'N').join('');

// RegPrecise regulation-mode string → effect enum. "repressor (activator)" / "dual" → dual.
function mapEffect(mode) {
  const m = (mode ?? '').trim().toLowerCase();
  if (!m) return null;
  const act = /activator/.test(m), rep = /repressor/.test(m);
  if (m.includes('dual') || (act && rep)) return 'dual';
  if (act) return 'activator';
  if (rep) return 'repressor';
  return null;
}

function parseCoordRange(coord) {
  const nums = (String(coord).match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums), strand: /complement/.test(coord) ? '-' : '+' };
}

function dbIndex(folder) {
  const coreDir = existsSync(resolve(RESOURCES, folder, 'core')) ? resolve(RESOURCES, folder, 'core') : resolve(RESOURCES, folder);
  const dbFile = readdirSync(coreDir).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(coreDir, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const byLocus = new Map(), byName = new Map(), byUniq = new Map();
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim(); if (!uniqID) continue;
    const lt = (r.locus_tag ?? '').trim(); const gn = (r.gene ?? '').trim();
    const onRef = (r.chrom ?? '').trim() === REF_CHROM;
    if (lt && !byLocus.has(lt)) byLocus.set(lt, { uniqID, gene: gn, locus_tag: lt });
    if (gn && !byName.has(gn.toLowerCase())) byName.set(gn.toLowerCase(), { uniqID, gene: gn, locus_tag: lt });
    const c = parseCoordRange(r.coord);
    if (c && onRef && !byUniq.has(uniqID)) byUniq.set(uniqID, { uniqID, gene: gn, start: c.start, end: c.end, strand: c.strand });
  }
  const ordered = [...byUniq.values()].sort((a, b) => a.start - b.start);
  const indexOf = new Map(ordered.map((g, i) => [g.uniqID, i]));
  return { byLocus, byName, byUniq, ordered, indexOf };
}

// Read the NCTC 8325 chromosome (NC_007795.1) from the cached conservation FASTA.
function loadGenome(folder) {
  const consDir = resolve(RESOURCES, folder, '_assets', 'conservation');
  let fna = null;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = resolve(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.fna$/i.test(e.name) && /GCF_000013425/.test(p)) fna = p;
  } };
  walk(consDir);
  if (!fna) throw new Error('NCTC 8325 genome FASTA (GCF_000013425) not found under _assets/conservation/');
  const text = readFileSync(fna, 'utf8');
  let name = null, buf = [], seqs = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) { if (name) seqs[name] = buf.join(''); name = line.slice(1).split(/\s+/)[0]; buf = []; }
    else buf.push(line.trim());
  }
  if (name) seqs[name] = buf.join('');
  const g = seqs[REF_CHROM];
  if (!g) throw new Error(`${REF_CHROM} not in genome FASTA (have ${Object.keys(seqs)})`);
  return g.toUpperCase();
}

// All exact occurrences (0-based) of `needle` in `hay`.
function findAll(hay, needle) {
  const out = []; let i = hay.indexOf(needle);
  while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + 1); }
  return out;
}

function parseOrthologueTsv(tsv) {
  const map = new Map();
  const lines = tsv.split(/\r?\n/).filter((l) => l.length);
  const header = lines.shift()?.split('\t').map((s) => s.trim()) ?? [];
  const iN = header.indexOf('N315'), iC = header.indexOf('NCTC8325');
  for (const line of lines) {
    const c = line.split('\t');
    const n = (c[iN] ?? '').trim(), nc = (c[iC] ?? '').trim();
    if (n && nc) map.set(n, nc);
  }
  return map;
}

const getProp = (html, label) => {
  const m = new RegExp(label + '\\s*</td>\\s*<td>(?:<a[^>]*>)?([^<]*)', 'i').exec(html);
  return m ? m[1].trim() : null;
};

async function main() {
  const taxid = process.argv[2] || '93061';
  const folder = orgFolder(taxid);
  const assetDir = resolve(RESOURCES, folder, '_assets');
  const { byLocus, byName, byUniq, ordered, indexOf } = dbIndex(folder);
  const genome = loadGenome(folder);
  console.log(`[regmap] ${REF_CHROM} genome ${genome.length.toLocaleString()} bp; ${byUniq.size} genes with coords`);

  // N315 → NCTC8325 (SAOUHSC_) crosswalk (cached by build-regulation.mjs).
  const orthoTsv = readFileSync(resolve(assetDir, 'aureowiki_orthologue_N315_NCTC8325.tsv'), 'utf8');
  const n315ToNctc = parseOrthologueTsv(orthoTsv);
  console.log(`[regmap] ${n315ToNctc.size} N315→NCTC8325 ortholog pairs`);

  // Resolve an N315 locus (+ gene-symbol fallback) → our gene record {uniqID, gene, start, end, strand}.
  const resolveN315 = (n315, gname) => {
    const nctc = n315ToNctc.get(n315);
    const f = (nctc && byLocus.get(nctc)) || (gname && byName.get(gname.toLowerCase())) || null;
    if (!f) return null;
    const g = byUniq.get(f.uniqID);
    return g ? { ...f, ...g } : null; // need coords to anchor
  };

  // Regulons listed on the N315 genome page (cached).
  const genomeHtml = readFileSync(resolve(assetDir, `regprecise_genome_${RP_GENOME_ID}.html`), 'utf8');
  const regulonRefs = [];
  const seen = new Set();
  for (const m of genomeHtml.matchAll(/regulon\.jsp\?regulon_id=(\d+)"[^>]*>([^<]+)</gi)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    regulonRefs.push({ id: m[1], name: m[2].trim() });
  }
  console.log(`[regmap] ${regulonRefs.length} regulons listed`);

  const perGene = new Map(); // uniqID → Map(dedupKey → feature)
  const operonOf = new Map(); // uniqID → Set(co-member uniqID)
  let kept = 0, skipped = 0, sitesTested = 0, sitesPlaced = 0, sitesAmbiguous = 0, sitesNoHit = 0;

  for (const ref of regulonRefs) {
    const regPath = resolve(assetDir, `regprecise_regulon_${ref.id}.html`);
    if (!existsSync(regPath)) { skipped++; continue; }
    const html = readFileSync(regPath, 'utf8');
    if (!/transcription factor/i.test(getProp(html, 'Regulator type:') ?? '')) { skipped++; continue; } // TFs only
    const regName = (/Regulon of <span class="titleItem">([^<]*)/.exec(html)?.[1] ?? ref.name).trim();
    const effect = mapEffect(getProp(html, 'Regulation mode:'));
    const tfLocus = getProp(html, 'TF locus tag:');
    const tfRec = (tfLocus && resolveN315(tfLocus, regName)) || (byName.get(regName.toLowerCase()) ?? null);
    const tfDisplay = tfRec?.gene || regName; // binding-site name = the TF (E. coli convention)
    kept++;

    // Operon groups (blank-line separated) from the gene export → operon co-membership for context.
    const tsvPath = resolve(assetDir, `regprecise_genes_${ref.id}.tsv`);
    if (existsSync(tsvPath)) {
      let group = []; const groups = [];
      for (const line of readFileSync(tsvPath, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) { if (group.length) groups.push(group); group = []; continue; }
        const [, n315, gn] = line.split('\t');
        if (n315) group.push(resolveN315(n315.trim(), (gn ?? '').trim()));
      }
      if (group.length) groups.push(group);
      for (const g of groups) {
        const members = g.filter(Boolean).map((x) => x.uniqID);
        if (members.length < 2) continue;
        for (const u of members) {
          if (!operonOf.has(u)) operonOf.set(u, new Set());
          for (const v of members) if (v !== u) operonOf.get(u).add(v);
        }
      }
    }

    // Binding sites: each operon block = its site(s) (Position/Score/Sequence) followed by its
    // gene(s). Anchor each site's MOTIF in the NCTC 8325 genome near the block's first mapped gene.
    for (const block of html.split('<div class="operon">').slice(1)) {
      const sites = [...block.matchAll(/Position: (-?\d+)<br\/>Score: ([\d.]+)<br\/>Sequence: ([A-Z]+)/g)]
        .map((m) => ({ pos: Number(m[1]), score: Number(m[2]), seq: m[3] }));
      const geneToks = [...block.matchAll(/Locus tag: (\w+)<br\/>Name: ([^<]*)/g)].map((m) => ({ n315: m[1], gname: m[2].trim() }));
      if (!sites.length || !geneToks.length) continue;
      // anchor gene: the first gene of the block that maps to one of our coorded genes
      let anchor = null;
      for (const t of geneToks) { const r = resolveN315(t.n315, t.gname); if (r) { anchor = r; break; } }
      if (!anchor) continue;
      const anchorPos = anchor.strand === '+' ? anchor.start : anchor.end; // gene start (1-based)

      for (const s of sites) {
        if (!s.seq || s.seq.length < MIN_MOTIF) continue; // skip tooltip artefacts
        sitesTested++;
        const hits = [
          ...findAll(genome, s.seq).map((i) => ({ i, strand: '+' })),
          ...findAll(genome, rc(s.seq)).map((i) => ({ i, strand: '-' })),
        ];
        // keep hits within the window of the anchor gene's start (1-based positions)
        const near = hits.filter((h) => Math.abs(h.i + 1 - anchorPos) <= ANCHOR_WINDOW);
        let chosen = null;
        if (near.length === 1) chosen = near[0];
        else if (near.length > 1) {
          // pick the hit closest to the RegPrecise relative position (anchor start + pos), then by anchor.
          const expected = anchorPos + s.pos;
          near.sort((a, b) => Math.abs(a.i + 1 - expected) - Math.abs(b.i + 1 - expected));
          // accept only if the best is clearly the closest (unique within 5 bp) — else ambiguous.
          if (near.length === 1 || Math.abs(near[0].i - near[1].i) > 5) chosen = near[0];
        }
        if (!chosen) { if (hits.length === 0) sitesNoHit++; else sitesAmbiguous++; continue; }
        const start = chosen.i + 1, end = chosen.i + s.seq.length; // 1-based inclusive
        const feat = { kind: 'tf_binding_site', name: tfDisplay, start, end, strand: chosen.strand, effect };
        // attach to every mapped gene in this operon block (the site regulates the whole operon)
        for (const t of geneToks) {
          const r = resolveN315(t.n315, t.gname); if (!r) continue;
          if (!perGene.has(r.uniqID)) perGene.set(r.uniqID, new Map());
          perGene.get(r.uniqID).set(`tf_binding_site:${start}:${end}:${tfDisplay}`, feat);
        }
        sitesPlaced++;
      }
    }
  }
  console.log(`[regmap] ${kept} TF regulons kept, ${skipped} skipped (non-TF / missing)`);
  console.log(`[regmap] sites: ${sitesTested} tested, ${sitesPlaced} placed; ${sitesNoHit} no genome hit, ${sitesAmbiguous} ambiguous near anchor (dropped)`);

  // context: operon co-members + the immediately flanking gene on each side.
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

  const out = {};
  for (const [uniqID, m] of perGene) {
    out[uniqID] = { features: [...m.values()].sort((a, b) => a.start - b.start), context: contextFor(uniqID) };
  }
  const outDir = resolve(RESOURCES, folder, 'regulation');
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, 'regulatory-map.json');
  writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]])), null, 0) + '\n');

  const tally = {}; let withEffect = 0, feats = 0, ctx = 0;
  for (const e of Object.values(out)) {
    ctx += e.context.length;
    for (const f of e.features) { tally[f.kind] = (tally[f.kind] ?? 0) + 1; feats++; if (f.effect) withEffect++; }
  }
  console.log(`[regmap] wrote ${file} — ${Object.keys(out).length} genes, ${feats} features (${withEffect} with effect), ${ctx} context genes`);
  console.log('[regmap] by kind:', JSON.stringify(tally));
}

main().catch((e) => { console.error(e); process.exit(1); });
