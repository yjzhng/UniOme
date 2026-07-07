#!/usr/bin/env node
// One-time, build-time fetch of REGULATION into resources/<org>/regulation/. Distinct from
// interactions (molecular: physical/predicted-physical). One unified per-gene record:
//   regulatedBy[] — regulators acting on this gene (TF/sRNA/effector + activator/repressor).
//                   This IS the "regulon membership" (regulon = inferred from the regulators).
//   regulates[]   — genes this gene regulates (non-empty only for regulators).
//   operons[]     — operon(s) the gene is in + co-member genes (RegulonDB getAllOperon).
//   sigmulons[]   — sigma factor(s) transcribing it (RegulonDB getAllSigmulon).
//   modulons[]    — iModulon(s) it belongs to (iModulonDB/precise1k).
// Plus -on→member indexes (regulon_members.json, modulon_members.json) for the Relationships
// "shared -on" views.
//
// Usage: node scripts/fetch-regulation.mjs <taxid>
//
// RegulonDB serves an incomplete TLS cert chain → node:https with rejectUnauthorized:false
// (undici not importable here; build-time, public data).

import { readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import https from 'node:https';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const GQL = 'https://regulondb.ccg.unam.mx/graphql';
const PAGE = 500; // ~293 regulons; one page (server pagination of page>0 is flaky)
const OPERON_LIMIT = 5000; // ~2605 operons
// iModulonDB "k12 modulome" IcaData (the imodulondb.org/e_coli/modulome dataset). pymodulon
// JSON: M (iModulon→gene weights) + per-iModulon thresholds + imodulon_table metadata.
const MODULOME = 'https://raw.githubusercontent.com/SBRG/precise1k/master/data/k12_modulome/k12_modulome.json.gz';
// Source-DB entry-page links for each -on (organism-specific for modulons: e_coli/modulome).
const REGULONDB_WEB = 'https://regulondb.ccg.unam.mx';
const IMODULONDB_IM = 'https://imodulondb.org/e_coli/modulome/imodulon';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripSigma = (n) => (n ?? '').replace(/^RNA polymerase sigma factor\s+/i, '').trim();

function gqlOnce(query) {
  return new Promise((res) => {
    const u = new URL(GQL);
    const body = JSON.stringify({ query });
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: 'POST', rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (r) => { let c = ''; r.on('data', (d) => (c += d)); r.on('end', () => { try { res(JSON.parse(c)?.data ?? null); } catch { res(null); } }); }
    );
    req.on('error', () => res(null));
    req.write(body); req.end();
  });
}
async function gql(query, attempt = 0) {
  const d = await gqlOnce(query);
  if (d == null && attempt < 6) { await sleep(Math.min(30000, 500 * 2 ** attempt) + Math.random() * 500); return gql(query, attempt + 1); }
  return d;
}
function allFeatures(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  return rows.map((r) => ({ uniqID: (r.uniqID ?? '').trim(), gene: (r.gene ?? '').trim(), locus_tag: (r.locus_tag ?? '').trim() })).filter((f) => f.uniqID && f.gene);
}

// getAllRegulon regulator names are full strings; the gene symbol is the last token; sRNAs
// carry the "small regulatory RNA" marker. Effectors (ppGpp) / complexes (IHF) won't resolve.
function normalizeRegulator(raw) {
  const s = (raw ?? '').trim();
  // sRNA: keep the FULL name after the marker (e.g. "Spot 42", "RyhB") — last-token alone
  // would mangle multi-word sRNA names ("Spot 42" → "42"). TF: the symbol is the last token.
  const sRNA = /small regulatory RNA\s+(.+)$/i.exec(s);
  if (sRNA) return { name: sRNA[1].trim(), type: 'sRNA' };
  return { name: s.split(/\s+/).pop() ?? '', type: 'TF' };
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'regulation');
  mkdirSync(outDir, { recursive: true });

  const features = allFeatures(folder);
  const byGene = new Map(features.map((f) => [f.gene.toLowerCase(), f]));
  const byLocus = new Map(features.map((f) => [f.locus_tag, f]).filter(([k]) => k));
  const resolveGene = (name) => ({ name, uniqID: byGene.get(name.toLowerCase())?.uniqID ?? null });

  // 1. Regulatory network (getAllRegulon) → forward / reverse edges + regulon→members index.
  console.log('[regulation] network (getAllRegulon)…');
  const regulons = [];
  for (let page = 0; ; page++) {
    const d = await gql(`{ getAllRegulon(limit:${PAGE},page:${page}){ data { _id regulator{ name } regulatoryInteractions{ function regulatedGenes{ name } } } } }`);
    const batch = d?.getAllRegulon?.data ?? [];
    regulons.push(...batch);
    if (batch.length < PAGE) break;
  }
  const forward = new Map(); // regulator gene-key → [{name,uniqID,function}]
  const reverse = new Map(); // target gene-key → [{name,uniqID,function,regulatorType}]
  const regulonMembers = {}; // regulator display name → [{name,uniqID}]
  const addEdge = (map, key, val, seen) => {
    if (!map.has(key)) map.set(key, []);
    const k = `${val.name}|${val.function}`;
    const s = seen.get(key) ?? seen.set(key, new Set()).get(key);
    if (s.has(k)) return;
    s.add(k);
    map.get(key).push(val);
  };
  const fSeen = new Map(), rSeen = new Map(), rmSeen = new Map();
  for (const reg of regulons) {
    const r = normalizeRegulator(reg.regulator?.name ?? '');
    if (!r.name) continue;
    const regKey = r.name.toLowerCase();
    const regUniq = byGene.get(regKey)?.uniqID ?? null;
    const regLink = reg._id ? `${REGULONDB_WEB}/regulon/${reg._id}` : null;
    for (const ri of reg.regulatoryInteractions ?? []) {
      const fn = ri.function ?? null;
      for (const g of ri.regulatedGenes ?? []) {
        const tName = g?.name; if (!tName) continue;
        const tUniq = byGene.get(tName.toLowerCase())?.uniqID ?? null;
        addEdge(forward, regKey, { name: tName, uniqID: tUniq, function: fn }, fSeen);
        addEdge(reverse, tName.toLowerCase(), { name: r.name, uniqID: regUniq, function: fn, regulatorType: r.type, link: regLink }, rSeen);
        const ms = rmSeen.get(r.name) ?? rmSeen.set(r.name, new Set()).get(r.name);
        if (!ms.has(tName)) { ms.add(tName); (regulonMembers[r.name] ??= []).push({ name: tName, uniqID: tUniq }); }
      }
    }
  }
  console.log(`  ${regulons.length} regulons`);

  // 2. Operons (getAllOperon) → operon + co-members per gene.
  console.log('[regulation] operons (getAllOperon)…');
  const operons = (await gql(`{ getAllOperon(limit:${OPERON_LIMIT},page:0){ data { operon{ _id name } transcriptionUnits{ genes{ name } } } } }`))?.getAllOperon?.data ?? [];
  const geneOperons = new Map();
  for (const op of operons) {
    const name = op.operon?.name; if (!name) continue;
    const members = [...new Set((op.transcriptionUnits ?? []).flatMap((tu) => (tu.genes ?? []).map((g) => g.name)).filter(Boolean))];
    const entry = { name, link: op.operon?._id ? `${REGULONDB_WEB}/operon/${op.operon._id}` : null, members: members.map(resolveGene) };
    for (const m of members) {
      const key = m.toLowerCase();
      if (!geneOperons.has(key)) geneOperons.set(key, []);
      geneOperons.get(key).push(entry);
    }
  }
  console.log(`  ${operons.length} operons`);

  // 3. Sigmulons (getAllSigmulon) → sigma factor(s) per gene.
  console.log('[regulation] sigmulons (getAllSigmulon)…');
  const sigmulons = (await gql(`{ getAllSigmulon(limit:50,page:0){ data { _id sigmaFactor{ name } transcribedPromoters{ transcribedGenes{ name } } } } }`))?.getAllSigmulon?.data ?? [];
  const geneSigmulons = new Map();
  for (const sm of sigmulons) {
    const name = stripSigma(sm.sigmaFactor?.name); if (!name) continue;
    const sig = { name, uniqID: byGene.get(name.toLowerCase())?.uniqID ?? null, link: sm._id ? `${REGULONDB_WEB}/sigmulon/${sm._id}` : null };
    const genes = new Set((sm.transcribedPromoters ?? []).flatMap((p) => (p.transcribedGenes ?? []).map((g) => g.name)).filter(Boolean));
    for (const g of genes) {
      const key = g.toLowerCase();
      if (!geneSigmulons.has(key)) geneSigmulons.set(key, []);
      geneSigmulons.get(key).push(sig);
    }
  }
  console.log(`  ${sigmulons.length} sigmulons`);

  // 4. Modulons (k12 modulome IcaData) → genes with |M weight| >= the iModulon's threshold
  //    (pymodulon binarization — matches imodulondb.org). Genes are b-numbers.
  console.log('[regulation] iModulons (k12 modulome)…');
  // pymodulon's JSON contains bare NaN literals (invalid JSON) → NaN → null before parsing.
  const text = gunzipSync(Buffer.from(await (await fetch(MODULOME)).arrayBuffer())).toString('utf8').replace(/\bNaN\b/g, 'null');
  const ica = JSON.parse(text);
  const M = typeof ica.M === 'string' ? JSON.parse(ica.M) : ica.M; // {iModulon: {b-number: weight}}
  const TH = ica.thresholds ?? {};
  const imt = typeof ica.imodulon_table === 'string' ? JSON.parse(ica.imodulon_table) : ica.imodulon_table;
  const imReg = imt?.regulator ?? {}, imFn = imt?.function ?? {};
  // imodulon_table row order = iModulonDB's URL index (verified: Leu/Val/Ile = 187).
  const imOrder = Object.keys(imt?.[Object.keys(imt ?? {})[0]] ?? {});
  const imIndex = new Map(imOrder.map((n, i) => [n, i]));
  const imLink = (im) => (imIndex.has(im) ? `${IMODULONDB_IM}/${imIndex.get(im)}` : null);
  const geneModulons = new Map();
  const modulonMembers = {};
  for (const im of Object.keys(TH)) {
    const thr = Math.abs(Number(TH[im]));
    const regulator = imReg[im] ?? null, fn = imFn[im] ?? null, link = imLink(im);
    const members = [];
    for (const [b, w] of Object.entries(M[im] ?? {})) {
      if (Math.abs(Number(w)) < thr) continue;
      if (!geneModulons.has(b)) geneModulons.set(b, []);
      geneModulons.get(b).push({ name: im, regulator, function: fn, link });
      const ft = byLocus.get(b);
      members.push({ name: ft?.gene ?? b, uniqID: ft?.uniqID ?? null });
    }
    modulonMembers[im] = { regulator, function: fn, members };
  }
  console.log(`  ${Object.keys(TH).length} iModulons`);

  // 5. Write the unified per-gene regulation record.
  const index = {};
  let count = 0;
  for (const f of features) {
    const key = f.gene.toLowerCase();
    const regulatedBy = reverse.get(key) ?? [];
    const regulates = forward.get(key) ?? [];
    const operonsOf = geneOperons.get(key) ?? [];
    const sigmulonsOf = geneSigmulons.get(key) ?? [];
    const modulonsOf = geneModulons.get(f.locus_tag) ?? [];
    if (!regulatedBy.length && !regulates.length && !operonsOf.length && !sigmulonsOf.length && !modulonsOf.length) continue;
    const doc = { uniqID: f.uniqID, gene: f.gene, source: 'RegulonDB + iModulonDB', regulatedBy, regulates, operons: operonsOf, sigmulons: sigmulonsOf, modulons: modulonsOf };
    writeFileSync(resolve(outDir, `${f.uniqID}.json`), JSON.stringify(doc, null, 2) + '\n');
    index[f.uniqID] = { gene: f.gene, regulatedBy: regulatedBy.length, regulates: regulates.length, operons: operonsOf.length, sigmulons: sigmulonsOf.length, modulons: modulonsOf.length };
    count++;
  }
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'regulon_members.json'), JSON.stringify(regulonMembers, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'modulon_members.json'), JSON.stringify(modulonMembers, null, 2) + '\n');
  console.log(`[regulation] ${count} features; ${Object.keys(regulonMembers).length} regulon + ${Object.keys(modulonMembers).length} modulon member-sets.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
