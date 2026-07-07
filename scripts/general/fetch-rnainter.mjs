#!/usr/bin/env node
// One-time, build-time ingest of RNAInter molecular interactions into resources/. Local-first.
//
// RNAInter (http://www.rnainter.org) covers the RNA-centric interactions IntAct/STRING miss for
// E. coli — sRNA↔mRNA targets and RNA↔protein (e.g. ryhB–acnA, 6S–RNA polymerase). Its REST API
// is unstable, so we use the bulk downloads and stream-filter to our strain in flight (the full
// files are multi-GB; the E. coli subset is a few hundred rows):
//   RNA–RNA      Download_data_RR.tar.gz  (sRNA↔mRNA, tRNA↔mRNA, …)
//   RNA–Protein  Download_data_RP.tar.gz  (RNA↔protein)
// Columns (TSV): RNAInterID, Sym1, Cat1, Sp1, Sym2, Cat2, Sp2, RawID1, RawID2, score, strong,
// weak, predict. Interactors map to our features by NCBI GeneID (RawID = "NCBI:<gid>") then by
// gene symbol. Each resolved pair is merged into interactions/<uniqID>.json as db:'RNAInter'
// partners (alongside any STRING/IntAct), and a file is created for RNA features that had none.
//
// The filtered subsets are cached under resources/<org>/_assets/rnainter/ so re-runs skip the
// (large) download. Usage: node scripts/fetch-rnainter.mjs <taxid>

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const RNAINTER = {
  RR: 'http://www.rnainter.org/raidMedia/download/Download_data_RR.tar.gz',
  RP: 'http://www.rnainter.org/raidMedia/download/Download_data_RP.tar.gz',
};
const STRAIN = 'K-12 substr. MG1655'; // RNAInter's label for our organism
const LIMIT = 60; // top-N RNAInter partners per feature (by evidence then score)

// Stream the bulk archive, decompress, and keep only our strain's rows → cacheFile (skip if cached).
function ensureSubset(url, cacheFile) {
  if (existsSync(cacheFile)) return;
  console.log(`  downloading + filtering ${url.split('/').pop()} …`);
  execSync(`curl -sS -L --max-time 1800 ${JSON.stringify(url)} | tar -xzO | grep ${JSON.stringify(STRAIN)} > ${JSON.stringify(cacheFile)}`,
    { shell: '/bin/bash', stdio: ['ignore', 'ignore', 'inherit'] });
}

const cleanSym = (s) => (s ?? '').replace(/\(.*$/, '').trim(); // "16SrRNA(…)" → "16SrRNA"
const gidOf = (raw) => { const m = /NCBI:(\d+)/.exec(raw ?? ''); return m ? m[1] : null; };
const methodsOf = (strong, weak) => [strong, weak].flatMap((c) => (c ?? '').split('//')).map((m) => m.trim()).filter((m) => m && m !== 'N/A');

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'interactions');
  mkdirSync(outDir, { recursive: true });
  const cacheDir = resolve(RESOURCES, folder, '_assets', 'rnainter');
  mkdirSync(cacheDir, { recursive: true });

  // Feature lookups: by NCBI GeneID (preferred) and by gene symbol (fallback).
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const byGID = new Map(), bySym = new Map(), byUniq = new Map();
  for (const r of rows) {
    const f = { uniqID: (r.uniqID ?? '').trim(), gene: (r.gene ?? '').trim(), type: (r.type ?? '').trim() };
    if (!f.uniqID) continue;
    byUniq.set(f.uniqID, f);
    const gid = (r.GeneID ?? '').trim(); if (gid) byGID.set(gid, f);
    if (f.gene) bySym.set(f.gene.toLowerCase(), f);
  }
  const resolveSide = (sym, raw) => byGID.get(gidOf(raw)) ?? bySym.get(cleanSym(sym).toLowerCase()) ?? null;

  // Accumulate per our-feature → partner pair → { name, uniqID, methods, score, count, onRna }.
  // `selfIsRna` records whether this feature was the RNA participant in the row (vs its protein).
  const acc = new Map(); // uniqID → Map(partnerKey → entry)
  const addEdge = (self, partnerName, partnerFeat, methods, score, selfIsRna) => {
    const m = acc.get(self.uniqID) ?? acc.set(self.uniqID, new Map()).get(self.uniqID);
    const key = partnerFeat?.uniqID ?? `~${partnerName.toLowerCase()}`;
    const e = m.get(key) ?? { name: partnerFeat?.gene || partnerName, uniqID: partnerFeat?.uniqID ?? null, methods: new Set(), score: 0, count: 0, onRna: false };
    e.count++;
    e.score = Math.max(e.score, score);
    e.onRna = e.onRna || selfIsRna;
    for (const mm of methods) e.methods.add(mm);
    m.set(key, e);
  };
  const isRnaCat = (cat) => (cat ?? '').trim().toLowerCase() !== 'protein';

  let edges = 0;
  for (const [kind, url] of Object.entries(RNAINTER)) {
    const cache = resolve(cacheDir, `${kind}_mg1655.tsv`);
    ensureSubset(url, cache);
    const text = readFileSync(cache, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const c = line.split('\t');
      const [, sym1, cat1, , sym2, cat2, , raw1, raw2, scoreStr, strong, weak] = c;
      const f1 = resolveSide(sym1, raw1), f2 = resolveSide(sym2, raw2);
      if (!f1 && !f2) continue; // neither side is ours
      const score = +scoreStr || 0;
      const methods = methodsOf(strong, weak);
      const n1 = f1?.gene || cleanSym(sym1), n2 = f2?.gene || cleanSym(sym2);
      // self participates AS RNA when its own side's category is an RNA type (not 'protein').
      if (f1) { addEdge(f1, n2, f2, methods, score, isRnaCat(cat1)); edges++; }
      if (f2 && f2.uniqID !== f1?.uniqID) { addEdge(f2, n1, f1, methods, score, isRnaCat(cat2)); edges++; }
    }
  }

  // Merge RNAInter partners into each feature's interactions file (create one if absent).
  const index = existsSync(resolve(outDir, 'index.json')) ? JSON.parse(readFileSync(resolve(outDir, 'index.json'), 'utf8')) : {};
  let written = 0;
  for (const [uniqID, partnersMap] of acc) {
    const feat = byUniq.get(uniqID);
    const partners = [...partnersMap.values()]
      .map((e) => ({ name: e.name, uniqID: e.uniqID, db: 'RNAInter', physical: e.methods.size > 0, onRna: e.onRna, score: e.score, method: [...e.methods][0] ?? null, evidence: e.count }))
      .sort((a, b) => b.evidence - a.evidence || b.score - a.score)
      .slice(0, LIMIT);

    const outFile = resolve(outDir, `${uniqID}.json`);
    let doc = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null;
    if (!doc) doc = { uniqID, gene: feat?.gene ?? '', molecularType: feat?.type === 'CDS' ? 'protein' : (feat?.type ?? 'rna'), source: 'RNAInter', kind: 'association', partners: [] };
    doc.partners = (doc.partners ?? []).filter((p) => p.db !== 'RNAInter').concat(partners);
    writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
    index[uniqID] = { gene: doc.gene, type: doc.molecularType, kind: doc.kind, count: doc.partners.length };
    written++;
  }
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`[rnainter] ${folder}: ${edges} resolved edges → ${written} feature file(s) updated with RNAInter partners.`);
}

main();
