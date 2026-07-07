#!/usr/bin/env node
// Builds the per-gene REGULATORY MAP for M. tuberculosis H37Rv (taxid 83332): the positional
// regulatory architecture of each gene — its transcription-factor binding site(s) (with
// activator/repressor effect) and promoter(s) — anchored to the gene they regulate, in H37Rv
// chromosome coordinates (NC_000962.3). Mirrors the E. coli builder's OUTPUT contract exactly:
//   resources/<org>/regulation/regulatory-map.json:
//     { uniqID: { features: [{ kind, name, start, end, strand, effect?, sigma? }],
//                 context: [{ uniqID, gene, start, end, strand, operon }] } }
//   where `context` is the gene's neighbourhood — its operon co-members plus the immediately
//   flanking gene on each side.
//
// Usage: node scripts/organisms/83332_Mtb/build-regulatory-map.mjs [taxid]   (default 83332)
//
// POSITIONAL SOURCE (genuine H37Rv coordinates, NOT a different strain/assembly):
//   Minch, Rustad et al. 2015 "The DNA-binding network of M. tuberculosis" Nat Commun 6:5829
//   (doi:10.1038/ncomms6829). The supplementary ChIP-seq peak tables — short reads aligned to the
//   H37Rv reference genome — give the actual binding-site footprints in genome coordinates:
//     * Supplementary Table 1 (ncomms6829-s2.xlsx): ALL p<0.01 ChIP-seq peaks for 156 TFs.
//         cols: Regulator (Rv), Gene (target, closest start codon to peak centre), p-Value, Score,
//               VPM, Peak Start (Fstart), Peak Stop (Rstop), Peak Center (Ccenter), DNAseq.
//       → each peak = one tf_binding_site feature [Peak Start .. Peak Stop] anchored to its target.
//     * Supplementary Table 3 (ncomms6829-s4.xlsx): the high-confidence subset — binding events in
//       the −150..+70 promoter window, with the regulated gene's transcription start site (TSS) and
//       the gene's expression change on TF over-expression (TFOE log2 ratio).
//         cols: Regulator, gene (Rv target), Peak Center, Distance of peak from target, Strand of
//               target, genome.position (the TSS), type of start (Primary/Internal/Antisense TSS or
//               CDS), Expression in TFOE, p.value, Operon, Differential expression in TFOE.
//       → the TFOE sign gives the binding's EFFECT (activation/repression), joined onto the
//         tf_binding_site features by (regulator, target). The Primary.TSS rows additionally seed a
//         `promoter` feature (a 1-bp TSS marker) for the regulated gene.
//   The Minch "Gene" column is keyed mostly on H37Rv Rv#### (a minority of CDC1551 MT#### loci that
//   don't exist in H37Rv are dropped — they can't be placed on our reference).
//
// OPERONS: the BioCyc transcription units already cached for build-regulation.mjs
//   (biocyc_operon_annotations.csv) → operon co-membership for `context`.
//
// Tables are downloaded once (via the PMC open-access package) into <org>/_assets/.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import Papa from 'papaparse';
import XLSXdefault from 'xlsx';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const XLSX = XLSXdefault.default || XLSXdefault;

// PMC open-access package for PMC4301838 (Minch 2015) — bundles ncomms6829-s2/-s4.xlsx.
const PMC_TARBALL = 'ftp://ftp.ncbi.nlm.nih.gov/pub/pmc/deprecated/oa_package/27/e6/PMC4301838.tar.gz';
const BIOCYC_OPERONS = 'https://raw.githubusercontent.com/Reosu/modulome_mtb/master/data/external/biocyc_operon_annotations.csv';

// A binding event counts as activation/repression when the TFOE expression change is at least this
// large in log2 (the Minch differential-expression call uses a comparable cut); else effect=null.
const TFOE_EFFECT_THRESHOLD = 1.0;

// GenBank coord → {start,end,strand} (start = lowest position, regardless of join/complement).
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
    if (lt && !byLocus.has(lt)) byLocus.set(lt, { uniqID, gene: gn, locus_tag: lt });
    if (gn && !byName.has(gn.toLowerCase())) byName.set(gn.toLowerCase(), { uniqID, gene: gn, locus_tag: lt });
    const c = parseCoordRange(r.coord);
    if (c && (r.chrom ?? '').trim() && !byUniq.has(uniqID)) byUniq.set(uniqID, { uniqID, gene: gn, start: c.start, end: c.end, strand: c.strand });
  }
  const ordered = [...byUniq.values()].sort((a, b) => a.start - b.start);
  const indexOf = new Map(ordered.map((g, i) => [g.uniqID, i]));
  return { byLocus, byName, byUniq, ordered, indexOf };
}

// Download the PMC tarball (once) and extract the two Minch supplementary xlsx tables into _assets/.
function ensureMinchTables(assetDir) {
  const peaks = resolve(assetDir, 'minch2015_chipseq_peaks.xlsx');     // Supp Table 1
  const promoter = resolve(assetDir, 'minch2015_promoter_binding.xlsx'); // Supp Table 3
  if (existsSync(peaks) && existsSync(promoter)) return { peaks, promoter };
  const tgz = resolve(assetDir, 'PMC4301838.tar.gz');
  if (!existsSync(tgz)) {
    console.log('[regmap] downloading Minch 2015 supplementary (PMC open-access package)…');
    execFileSync('curl', ['-sL', '-o', tgz, PMC_TARBALL], { stdio: 'inherit' });
  }
  console.log('[regmap] extracting ncomms6829-s2.xlsx + -s4.xlsx…');
  execFileSync('tar', ['xzf', tgz, '-C', assetDir, '--strip-components=1',
    'PMC4301838/ncomms6829-s2.xlsx', 'PMC4301838/ncomms6829-s4.xlsx'], { stdio: 'inherit' });
  // tar --strip-components writes the basenames into assetDir; rename to our cache names.
  execFileSync('mv', [resolve(assetDir, 'ncomms6829-s2.xlsx'), peaks]);
  execFileSync('mv', [resolve(assetDir, 'ncomms6829-s4.xlsx'), promoter]);
  return { peaks, promoter };
}

// xlsx first sheet → array of objects keyed by the header row (row 1; row 0 is the title banner).
function readSheet(path) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const header = rows[1].map((h) => String(h).trim());
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] == null || r[0] === '') continue;
    // Trailing "Heading/Descriptor" legend columns sit past the data columns — ignore them by
    // only reading the named header span.
    const o = {};
    for (let c = 0; c < header.length; c++) o[header[c]] = r[c];
    out.push(o);
  }
  return out;
}

async function main() {
  const taxid = process.argv[2] || '83332';
  const folder = orgFolder(taxid);
  const assetDir = resolve(RESOURCES, folder, '_assets');
  mkdirSync(assetDir, { recursive: true });
  const { byLocus, byName, byUniq, ordered, indexOf } = dbIndex(folder);

  const { peaks: peaksPath, promoter: promoterPath } = ensureMinchTables(assetDir);

  // Resolve an Rv locus (Minch token) → our { uniqID, gene }. (CDC1551 MT#### loci aren't in H37Rv.)
  const resolveLocus = (tok) => {
    const t = (tok ?? '').trim();
    if (!t) return null;
    return byLocus.get(t) || byName.get(t.toLowerCase()) || null;
  };
  // Display name for a regulator Rv: prefer the gene symbol, fall back to the Rv id.
  const tfName = (rv) => { const o = resolveLocus(rv); return o?.gene || (rv ?? '').trim(); };

  // 1) EFFECT join: (regulatorRv, targetRv) → 'activator'|'repressor'|null, from Table 3's TFOE
  //    log2 expression change of the target on regulator over-expression. Also collect Primary.TSS
  //    positions per target gene (→ promoter features).
  console.log('[regmap] Minch Supplementary Table 3 (promoter-window binding + TFOE effect)…');
  const table3 = readSheet(promoterPath);
  const effect = new Map();          // `${regRv}|${targetUniqID}` → effect
  const tssByTarget = new Map();     // targetUniqID → Map(pos → Set(regulator gene names))
  let t3resolved = 0;
  for (const row of table3) {
    const regRv = String(row['Regulator'] ?? '').trim();
    const tgt = resolveLocus(String(row['gene'] ?? '').trim());
    if (!regRv || !tgt) continue;
    t3resolved++;
    const tfoe = Number(row['Expression in TFOE']);
    if (Number.isFinite(tfoe) && Math.abs(tfoe) >= TFOE_EFFECT_THRESHOLD) {
      const eff = tfoe > 0 ? 'activator' : 'repressor';
      const k = `${regRv}|${tgt.uniqID}`;
      const prev = effect.get(k);
      // If the same TF→gene shows both directions across peaks, mark 'dual'.
      if (prev == null) effect.set(k, eff);
      else if (prev !== eff) effect.set(k, 'dual');
    }
    const startType = String(row['type of start'] ?? '').trim();
    const pos = Number(row['genome.position']);
    if (startType === 'Primary.TSS' && Number.isFinite(pos)) {
      if (!tssByTarget.has(tgt.uniqID)) tssByTarget.set(tgt.uniqID, new Map());
      const m = tssByTarget.get(tgt.uniqID);
      if (!m.has(pos)) m.set(pos, new Set());
      m.get(pos).add(String(row['Strand of target'] ?? '+').trim());
    }
  }
  console.log(`  ${table3.length} promoter-window events, ${t3resolved} with an H37Rv target; ${effect.size} TF→gene effects, ${tssByTarget.size} genes with a Primary TSS`);

  // 2) POSITIONAL binding sites (Supplementary Table 1) → one tf_binding_site per ChIP-seq peak,
  //    anchored to the peak's target gene (closest start codon). Coordinates are H37Rv genome
  //    positions (Peak Start..Peak Stop). Effect joined from step 1.
  console.log('[regmap] Minch Supplementary Table 1 (all ChIP-seq peaks)…');
  const table1 = readSheet(peaksPath);
  const perGene = new Map(); // uniqID → Map(dedupKey → feature)
  let placed = 0, droppedNoTarget = 0;
  for (const row of table1) {
    const regRv = String(row['Regulator'] ?? '').trim();
    const tgt = resolveLocus(String(row['Gene'] ?? '').trim());
    if (!regRv) continue;
    if (!tgt) { droppedNoTarget++; continue; } // CDC1551-only target → can't place on our reference
    const s = Number(row['Peak Start (Fstart)']);
    const e = Number(row['Peak Stop (Rstop)']);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const start = Math.min(s, e), end = Math.max(s, e);
    if (start < 1) continue;
    const name = tfName(regRv);
    // ChIP-seq peaks are not stranded; orient the binding site to the regulated gene's strand.
    const strand = byUniq.get(tgt.uniqID)?.strand ?? '+';
    const eff = effect.get(`${regRv}|${tgt.uniqID}`) ?? null;
    const feat = { kind: 'tf_binding_site', name, start, end, strand, effect: eff };
    if (!perGene.has(tgt.uniqID)) perGene.set(tgt.uniqID, new Map());
    perGene.get(tgt.uniqID).set(`tf_binding_site:${start}:${end}:${name}`, feat);
    placed++;
  }
  console.log(`  ${table1.length} peaks; ${placed} placed, ${droppedNoTarget} dropped (CDC1551-only target)`);

  // 2b) promoters: a 1-bp TSS marker per Primary.TSS, named after the regulated gene's promoter.
  let promoters = 0;
  for (const [uniqID, posMap] of tssByTarget) {
    const g = byUniq.get(uniqID);
    const gName = g?.gene || uniqID;
    for (const [pos, strands] of posMap) {
      const strand = strands.has('-') && !strands.has('+') ? '-' : (g?.strand ?? '+');
      const feat = { kind: 'promoter', name: `${gName}p`, start: pos, end: pos, strand, effect: null };
      if (!perGene.has(uniqID)) perGene.set(uniqID, new Map());
      perGene.get(uniqID).set(`promoter:${pos}:${pos}:${feat.name}`, feat);
      promoters++;
    }
  }
  console.log(`  ${promoters} promoter (TSS) markers`);

  // 3) OPERONS (BioCyc transcription units) → operon co-membership for `context`.
  console.log('[regmap] operons (biocyc_operon_annotations.csv)…');
  const opPath = resolve(assetDir, 'biocyc_operon_annotations.csv');
  if (!existsSync(opPath)) execFileSync('curl', ['-sL', '-o', opPath, BIOCYC_OPERONS], { stdio: 'inherit' });
  const opRows = Papa.parse(readFileSync(opPath, 'utf8'), { header: true, skipEmptyLines: true }).data;
  const operonOf = new Map(); // uniqID → Set(co-member uniqID)
  const tuSeen = new Map();
  for (const row of opRows) {
    const tu = (row['Genes in same transcription unit'] ?? '').trim();
    if (!tu || tuSeen.has(tu)) continue;
    tuSeen.set(tu, true);
    const members = new Set();
    for (const tok of tu.split('//').map((t) => t.trim()).filter(Boolean)) {
      const o = resolveLocus(tok);
      if (o) members.add(o.uniqID);
    }
    for (const u of members) {
      if (!operonOf.has(u)) operonOf.set(u, new Set());
      for (const v of members) if (v !== u) operonOf.get(u).add(v);
    }
  }
  console.log(`  ${tuSeen.size} transcription units`);

  // The gene's neighbourhood: operon co-members + the immediately flanking gene on each side.
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

  // 4) Assemble + write.
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
