#!/usr/bin/env node
// Builds the per-gene REGULATORY MAP: the positional regulatory architecture of each gene —
// its promoter(s), transcription-factor binding sites (with activator/repressor effect) and
// terminator(s) — anchored to the gene they regulate (RegulonDB getGeneticElementsFromInterval
// → relatedGenes), resolved to our uniqIDs. The TF→gene effect is joined from getAllRegulon
// (the positional query carries no effect). This is the functional, gene-anchored complement to
// the positional resources/<org>/genome table.
//   resources/<org>/regulation/regulatory-map.json:
//     { uniqID: { features: [{ kind, name, start, end, strand, effect? }],
//                 context: [{ uniqID, gene, start, end, strand, operon }] } }
//   where `context` is the gene's neighbourhood — its operon co-members plus the immediately
//   flanking gene on each side — for spatial context on the map.
//
// Usage: node scripts/build-regulatory-map.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import https from 'node:https';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const GQL = 'https://regulondb.ccg.unam.mx/graphql';
const CHUNK = 250_000;
const PAGE = 1000;
const KINDS = new Set(['promoter', 'terminator', 'tf_binding_site', 'translational_tf_binding_site']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function gqlOnce(query) {
  return new Promise((res) => {
    const u = new URL(GQL);
    const body = JSON.stringify({ query });
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (r) => { let c = ''; r.on('data', (d) => (c += d)); r.on('end', () => { try { res(JSON.parse(c)?.data ?? null); } catch { res(null); } }); }
    );
    req.on('error', () => res(null));
    req.write(body); req.end();
  });
}
async function gql(query, attempt = 0) {
  const d = await gqlOnce(query);
  if (d == null && attempt < 6) { await sleep(Math.min(20000, 500 * 2 ** attempt) + Math.random() * 500); return gql(query, attempt + 1); }
  return d;
}
// TF symbol = last token of the RegulonDB regulator name (matches the TFBS labelName).
const tfSymbol = (raw) => (raw ?? '').trim().split(/\s+/).pop() ?? '';

// GenBank coord → {start,end,strand} (start = lowest position, regardless of join/complement).
function parseCoordRange(coord) {
  const nums = (String(coord).match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums), strand: /complement/.test(coord) ? '-' : '+' };
}

function dbIndex(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const byLocus = new Map(), byName = new Map(), byUniq = new Map();
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim(); if (!uniqID) continue;
    const lt = (r.locus_tag ?? '').trim(); const gn = (r.gene ?? '').trim();
    if (lt && !byLocus.has(lt)) byLocus.set(lt, { uniqID, gene: gn });
    if (gn && !byName.has(gn.toLowerCase())) byName.set(gn.toLowerCase(), { uniqID, gene: gn });
    const c = parseCoordRange(r.coord);
    if (c && !byUniq.has(uniqID)) byUniq.set(uniqID, { uniqID, gene: gn, start: c.start, end: c.end, strand: c.strand });
  }
  // Genes ordered along the chromosome (those with coords) → for flanking-gene lookup.
  const ordered = [...byUniq.values()].sort((a, b) => a.start - b.start);
  const indexOf = new Map(ordered.map((g, i) => [g.uniqID, i]));
  return { byLocus, byName, byUniq, ordered, indexOf };
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const { byLocus, byName, byUniq, ordered, indexOf } = dbIndex(folder);

  // 1) RegulonDB gene id → our { uniqID, gene } (via b-number, else gene name). NOTE: RegulonDB's
  // `page` arg is a no-op (page>0 returns nothing) — a single large `limit` returns everything.
  console.log('[regmap] genes (getAllGenes)…');
  const rdbToOurs = new Map(); // rdb geneId → { uniqID, gene }
  const genes = (await gql(`{ getAllGenes(limit:20000,page:0){ data { _id gene { name bnumber } } } }`))?.getAllGenes?.data ?? [];
  for (const g of genes) {
    const bnum = g.gene?.bnumber?.trim();
    const name = g.gene?.name?.trim();
    const ours = (bnum && byLocus.get(bnum)) || (name && byName.get(name.toLowerCase())) || null;
    if (ours) rdbToOurs.set(g._id, ours);
  }
  console.log(`  resolved ${rdbToOurs.size}/${genes.length} RegulonDB genes to uniqIDs`);

  // 2) effect map: (TF symbol, our uniqID) → 'activator' | 'repressor' | 'dual'.
  console.log('[regmap] regulatory effects (getAllRegulon)…');
  const effect = new Map();
  const regulons = (await gql(`{ getAllRegulon(limit:5000,page:0){ data { regulator{ name } regulatoryInteractions{ function regulatedGenes{ _id } } } } }`))?.getAllRegulon?.data ?? [];
  for (const reg of regulons) {
    const tf = tfSymbol(reg.regulator?.name).toLowerCase();
    for (const ri of reg.regulatoryInteractions ?? []) {
      const fn = ri.function ?? null;
      for (const g of ri.regulatedGenes ?? []) {
        const ours = rdbToOurs.get(g._id); if (!ours) continue;
        const k = `${tf}|${ours.uniqID}`;
        if (!effect.has(k)) effect.set(k, fn);
      }
    }
  }
  console.log(`  ${effect.size} TF→gene effects`);

  // 2a) promoter → σ factor(s): a promoter is recognised by a specific sigma factor (its −10/−35
  // box). RegulonDB's sigmulon carries sigmaFactor → transcribedPromoters; key by promoter name so
  // it joins onto the positional promoter features (labelName) below.
  console.log('[regmap] sigmulons (getAllSigmulon)…');
  const stripSigma = (n) => (n ?? '').replace(/^RNA polymerase sigma factor\s+/i, '').trim();
  const promoterSigma = new Map(); // promoterName.toLowerCase() → Set(sigma)
  const sigmulons = (await gql(`{ getAllSigmulon(limit:200,page:0){ data { sigmaFactor{ name } transcribedPromoters{ name } } } }`))?.getAllSigmulon?.data ?? [];
  for (const sm of sigmulons) {
    const sig = stripSigma(sm.sigmaFactor?.name); if (!sig) continue;
    for (const p of sm.transcribedPromoters ?? []) {
      const pn = (p.name ?? '').trim().toLowerCase(); if (!pn) continue;
      if (!promoterSigma.has(pn)) promoterSigma.set(pn, new Set());
      promoterSigma.get(pn).add(sig);
    }
  }
  console.log(`  ${promoterSigma.size} promoters with a σ factor`);

  // 2b) operon co-membership: uniqID → Set(co-member uniqIDs).
  console.log('[regmap] operons (getAllOperon)…');
  const operonOf = new Map();
  const operons = (await gql(`{ getAllOperon(limit:5000,page:0){ data { transcriptionUnits{ genes{ name } } } } }`))?.getAllOperon?.data ?? [];
  for (const op of operons) {
    const members = new Set();
    for (const tu of op.transcriptionUnits ?? []) for (const g of tu.genes ?? []) {
      const ours = byName.get((g.name ?? '').trim().toLowerCase());
      if (ours) members.add(ours.uniqID);
    }
    for (const u of members) {
      if (!operonOf.has(u)) operonOf.set(u, new Set());
      for (const v of members) if (v !== u) operonOf.get(u).add(v);
    }
  }
  console.log(`  ${operons.length} operons`);

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

  // 3) positional elements over the genome → attach to each related gene.
  console.log('[regmap] genetic elements (getGeneticElementsFromInterval)…');
  const genomeLen = Number(Papa.parse(readFileSync(resolve(RESOURCES, folder, readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f))), 'utf8'), { header: true, skipEmptyLines: true }).data[0].chrom_len);
  const perGene = new Map(); // uniqID → Map(dedupKey → feature)
  for (let lo = 1; lo <= genomeLen; lo += CHUNK) {
    const hi = Math.min(genomeLen, lo + CHUNK - 1);
    const d = await gql(`{ getGeneticElementsFromInterval(leftEndPosition:${lo}, rightEndPosition:${hi}){ objectType labelName leftEndPosition rightEndPosition strand relatedGenes { _id } } }`);
    for (const e of d?.getGeneticElementsFromInterval ?? []) {
      if (!KINDS.has(e.objectType)) continue;
      const l = Number(e.leftEndPosition), r = Number(e.rightEndPosition);
      if (!Number.isFinite(l) || !Number.isFinite(r)) continue;
      const start = Math.min(l, r), end = Math.max(l, r);
      if (start < 1) continue; // no mapped position (regulatory interaction without a binding site)
      const strand = e.strand === 'reverse' ? '-' : '+';
      const name = (e.labelName ?? '').trim();
      for (const g of e.relatedGenes ?? []) {
        const ours = rdbToOurs.get(g._id); if (!ours) continue;
        const eff = e.objectType === 'tf_binding_site' || e.objectType === 'translational_tf_binding_site' ? effect.get(`${name.toLowerCase()}|${ours.uniqID}`) ?? null : null;
        const sigma = e.objectType === 'promoter' ? [...(promoterSigma.get(name.toLowerCase()) ?? [])] : [];
        const feat = { kind: e.objectType, name, start, end, strand, effect: eff, ...(sigma.length ? { sigma } : {}) };
        if (!perGene.has(ours.uniqID)) perGene.set(ours.uniqID, new Map());
        perGene.get(ours.uniqID).set(`${e.objectType}:${start}:${end}:${name}`, feat);
      }
    }
    process.stdout.write(`\r[regmap] ${Math.min(hi, genomeLen).toLocaleString()}/${genomeLen.toLocaleString()} bp · ${perGene.size} genes`);
  }
  process.stdout.write('\n');

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
