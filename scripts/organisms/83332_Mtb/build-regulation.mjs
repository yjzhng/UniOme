#!/usr/bin/env node
// Build-time fetch of REGULATION for M. tuberculosis H37Rv (taxid 83332) into
// resources/<org>/regulation/. Mirrors the E. coli output contract exactly
// (scripts/organisms/83333_Ec/fetch-regulation.mjs):
//   regulatedBy[] — regulators acting on this gene (TF/sRNA + activator/repressor|null).
//                   This IS the "regulon membership".
//   regulates[]   — genes this gene regulates (non-empty only for regulators).
//   operons[]     — operon(s) the gene is in + co-member genes.
//   sigmulons[]   — sigma factor(s) transcribing it.
//   modulons[]    — iModulon(s) it belongs to.
// Plus -on -> member indexes (regulon_members.json, modulon_members.json).
//
// Usage: node scripts/organisms/83332_Mtb/build-regulation.mjs [taxid]   (default 83332)
//
// SOURCES (all Rv-keyed, machine-readable, downloaded once into <org>/_assets/):
//   * TRN (TF/sigma -> target) and modulons (iModulonDB M. tuberculosis "modulome"):
//     github.com/Reosu/modulome_mtb (the published M. tuberculosis modulome / iModulonDB build,
//     which bundles the MTB Network Portal-derived ChIP-seq + over-expression TRN).
//       annotation/gene_files/trn.csv        cols: regulator, regulator_id (Rv), evidence, gene_id (Rv target)
//       modulome/data_files/M.csv            iModulon gene-weight matrix (rows = Rv, cols = iModulon index k)
//       modulome/data_files/M_thresholds.csv per-iModulon |weight| membership threshold (row = k)
//       modulome/data_files/iM_table.csv     iModulon metadata: k, Name, Regulator, Function
//   * Operons: BioCyc operon annotations bundled in the same repo:
//       data/external/biocyc_operon_annotations.csv  cols: All-Genes, "Genes in same transcription unit", Accession-1 (Rv)
//
// NOTE: the TRN is ChIP-seq / predicted-binding based and carries NO activation/repression
// direction -> function is null for every regulatedBy/regulates edge. Sigma-factor regulators
// in the TRN are split out into sigmulons[] (kept ALSO in regulatedBy as regulatorType TF, like
// RegulonDB treats sigma promoters separately). RegPrecise + MTB Network Portal REST endpoints
// were probed and are dead (RegPrecise /Services/rest/* -> 404; mtbnetworkportal.org unreachable),
// so this single curated bundle is the source.

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const REPO_RAW = 'https://raw.githubusercontent.com/Reosu/modulome_mtb/master/data';
const SRC = {
  trn: `${REPO_RAW}/iModulonDB/organisms/m_tuberculosis/annotation/gene_files/trn.csv`,
  M: `${REPO_RAW}/iModulonDB/organisms/m_tuberculosis/modulome/data_files/M.csv`,
  thresholds: `${REPO_RAW}/iModulonDB/organisms/m_tuberculosis/modulome/data_files/M_thresholds.csv`,
  imTable: `${REPO_RAW}/iModulonDB/organisms/m_tuberculosis/modulome/data_files/iM_table.csv`,
  operons: `${REPO_RAW}/external/biocyc_operon_annotations.csv`,
};
// Source-DB entry-page links.
const IMODULONDB = 'https://imodulondb.org/iModulon.html?organism=m_tuberculosis&dataset=modulome';
const MNP = 'https://mtbnetworkportal.org';

// 12 housekeeping/ECF sigma factors of H37Rv (regulator_id in trn.csv). Edges driven by a sigma
// factor are surfaced as sigmulons[]; the gene-symbol set keeps them out of the TF regulon index.
const SIGMA_RV = new Set([
  'Rv2703', // sigA
  'Rv2710', // sigB
  'Rv2069', // sigC
  'Rv3414c', // sigD
  'Rv1221', // sigE
  'Rv3286c', // sigF
  'Rv0182c', // sigG
  'Rv3223c', // sigH
  'Rv1189', // sigI
  'Rv3328c', // sigJ
  'Rv0445c', // sigK
  'Rv0735', // sigL
  'Rv3911', // sigM
]);

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> HTTP ${r.status}`);
  return await r.text();
}
async function cached(dir, name, url) {
  const path = resolve(dir, name);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  console.log(`  download ${name}`);
  const text = await download(url);
  writeFileSync(path, text);
  return text;
}
const parse = (text) => Papa.parse(text, { header: true, skipEmptyLines: true }).data;

function allFeatures(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f))
    || readdirSync(resolve(RESOURCES, folder, 'core')).find((f) => /_DB\.csv$/i.test(f));
  const dir = existsSync(resolve(RESOURCES, folder, 'core', dbFile)) ? resolve(RESOURCES, folder, 'core') : resolve(RESOURCES, folder);
  const rows = Papa.parse(readFileSync(resolve(dir, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  return rows.map((r) => ({ uniqID: (r.uniqID ?? '').trim(), gene: (r.gene ?? '').trim(), locus_tag: (r.locus_tag ?? '').trim() }))
    .filter((f) => f.uniqID);
}

async function main() {
  const taxid = process.argv[2] || '83332';
  const folder = orgFolder(taxid);
  const assetsDir = resolve(RESOURCES, folder, '_assets');
  const outDir = resolve(RESOURCES, folder, 'regulation');
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const features = allFeatures(folder);
  const byLocus = new Map(features.filter((f) => f.locus_tag).map((f) => [f.locus_tag, f]));
  const byGene = new Map(features.filter((f) => f.gene).map((f) => [f.gene.toLowerCase(), f]));
  // Resolve a regulator/member token (an Rv locus OR a gene symbol) to {name, uniqID}.
  // Display name preference: the gene symbol from our DB when the token is an Rv we know; else the raw token.
  const resolveTok = (rawName, rawRv) => {
    const rv = (rawRv ?? '').trim();
    const nm = (rawName ?? '').trim();
    let ft = rv && byLocus.get(rv);
    if (!ft && nm) ft = byLocus.get(nm) || byGene.get(nm.toLowerCase());
    const name = (ft?.gene && ft.gene !== '') ? ft.gene : (nm || rv);
    return { name: name || rv || nm, uniqID: ft?.uniqID ?? null, locus: rv || (ft?.locus_tag ?? null) };
  };

  // ---- 1. TRN: regulator -> target edges (+ split sigma factors into sigmulons) ----------
  console.log('[regulation] TRN (trn.csv)…');
  const trn = parse(await cached(assetsDir, 'trn.csv', SRC.trn));
  const forward = new Map(); // regulator locus(or name) key -> [{name,uniqID,function}]
  const reverse = new Map(); // target locus key -> [{name,uniqID,function,regulatorType,link}]
  const regulonMembers = {}; // regulator display name -> [{name,uniqID}]
  const geneSigmulons = new Map(); // target locus key -> [{name,uniqID,link}]
  const fSeen = new Map(), rSeen = new Map(), rmSeen = new Map(), sSeen = new Map();
  const addEdge = (map, key, val, seen, dedupKey) => {
    if (!map.has(key)) map.set(key, []);
    const s = seen.get(key) ?? seen.set(key, new Set()).get(key);
    if (s.has(dedupKey)) return;
    s.add(dedupKey);
    map.get(key).push(val);
  };
  for (const row of trn) {
    const regRv = (row.regulator_id ?? '').trim();
    const reg = resolveTok(row.regulator, regRv);
    const tgt = resolveTok(null, (row.gene_id ?? '').trim());
    if (!reg.name || !tgt.locus) continue;
    const tgtKey = tgt.locus;
    const isSigma = regRv && SIGMA_RV.has(regRv);

    if (isSigma) {
      const sig = { name: reg.name, uniqID: reg.uniqID, link: `${IMODULONDB}` };
      addEdge(geneSigmulons, tgtKey, sig, sSeen, reg.name);
    }
    // forward/reverse regulon edges (TF + sigma both kept as regulatorType TF, like RegulonDB's
    // getAllRegulon which also returns sigma regulons; function null - TRN has no direction).
    const regKey = reg.locus || reg.name.toLowerCase();
    const regLink = regRv ? `${MNP}` : null;
    addEdge(forward, regKey, { name: tgt.name, uniqID: tgt.uniqID, function: null }, fSeen, tgtKey);
    addEdge(reverse, tgtKey, { name: reg.name, uniqID: reg.uniqID, function: null, regulatorType: 'TF', link: regLink }, rSeen, reg.name);
    const ms = rmSeen.get(reg.name) ?? rmSeen.set(reg.name, new Set()).get(reg.name);
    if (!ms.has(tgtKey)) { ms.add(tgtKey); (regulonMembers[reg.name] ??= []).push({ name: tgt.name, uniqID: tgt.uniqID }); }
  }
  console.log(`  ${trn.length} edges; ${Object.keys(regulonMembers).length} regulators; ${SIGMA_RV.size} possible sigmas`);

  // ---- 2. Operons (BioCyc TUs) ----------------------------------------------------------
  console.log('[regulation] operons (biocyc_operon_annotations.csv)…');
  const opRows = parse(await cached(assetsDir, 'biocyc_operon_annotations.csv', SRC.operons));
  const geneOperons = new Map(); // locus key -> [operon entry]
  const tuSeen = new Map(); // TU string -> entry (so co-members share one object)
  for (const row of opRows) {
    const rv = (row['Accession-1'] ?? '').trim();
    const tu = (row['Genes in same transcription unit'] ?? '').trim();
    if (!rv || !tu) continue;
    let entry = tuSeen.get(tu);
    if (!entry) {
      const memberToks = tu.split('//').map((t) => t.trim()).filter(Boolean);
      const members = memberToks.map((t) => {
        const r = resolveTok(t, /^Rv[0-9]/.test(t) ? t : null);
        return { name: r.name, uniqID: r.uniqID };
      });
      // operon name = its member gene symbols concatenated (RegulonDB-style: thrLABC); single-gene TUs => that gene.
      const name = members.map((m) => m.name).join(members.length > 1 ? '-' : '');
      entry = { name, link: `https://biocyc.org/gene?orgid=GCF_000195955&id=${rv}`, members };
      tuSeen.set(tu, entry);
    }
    if (!geneOperons.has(rv)) geneOperons.set(rv, []);
    geneOperons.get(rv).push(entry);
  }
  console.log(`  ${tuSeen.size} transcription units`);

  // ---- 3. Modulons (iModulonDB M. tuberculosis modulome) --------------------------------
  console.log('[regulation] iModulons (M.csv / thresholds / iM_table)…');
  const imTable = parse(await cached(assetsDir, 'iM_table.csv', SRC.imTable)); // k,Name,Regulator,Function,...
  const thRows = parse(await cached(assetsDir, 'M_thresholds.csv', SRC.thresholds)); // index(unnamed),'0'
  const mText = await cached(assetsDir, 'M.csv', SRC.M);
  // M.csv: first row = header (",0,1,2,...,k"); each data row = "Rv####,w0,w1,...".
  const mParsed = Papa.parse(mText, { header: false, skipEmptyLines: true }).data;
  const header = mParsed[0]; // ['', '0','1',...]
  const colIdx = header.slice(1).map((c) => String(c).trim()); // iModulon k values, column order
  const thresholds = {}; // k -> threshold
  for (const r of thRows) {
    const k = String(r[''] ?? Object.values(r)[0]).trim();
    const v = Number(r['0'] ?? Object.values(r)[1]);
    if (k !== '' && Number.isFinite(v)) thresholds[k] = v;
  }
  const imMeta = {}; // k -> {name, regulator, function}
  for (const r of imTable) {
    const k = String(r.k ?? '').trim();
    imMeta[k] = {
      name: (r.Name ?? '').trim() || k,
      regulator: (r.Regulator ?? '').trim() || null,
      function: (r.Function ?? '').trim() || null,
    };
  }
  const imLink = `${IMODULONDB}`;
  const geneModulons = new Map(); // locus key -> [{name,regulator,function,link}]
  const modulonMembers = {}; // modulon name -> {regulator,function,members[]}
  for (const k of colIdx) {
    const meta = imMeta[k] ?? { name: k, regulator: null, function: null };
    modulonMembers[meta.name] = { regulator: meta.regulator, function: meta.function, members: [] };
  }
  for (let i = 1; i < mParsed.length; i++) {
    const row = mParsed[i];
    const rv = String(row[0]).trim();
    if (!rv) continue;
    const ft = byLocus.get(rv);
    const member = { name: ft?.gene || rv, uniqID: ft?.uniqID ?? null };
    for (let c = 0; c < colIdx.length; c++) {
      const k = colIdx[c];
      const thr = thresholds[k];
      if (thr == null) continue;
      const w = Number(row[c + 1]);
      if (!Number.isFinite(w) || Math.abs(w) < Math.abs(thr)) continue;
      const meta = imMeta[k] ?? { name: k, regulator: null, function: null };
      if (!geneModulons.has(rv)) geneModulons.set(rv, []);
      geneModulons.get(rv).push({ name: meta.name, regulator: meta.regulator, function: meta.function, link: imLink });
      modulonMembers[meta.name].members.push(member);
    }
  }
  console.log(`  ${colIdx.length} iModulons`);

  // ---- 4. Write unified per-gene records + indexes --------------------------------------
  const index = {};
  let count = 0;
  for (const f of features) {
    const lk = f.locus_tag;
    const gk = f.gene ? f.gene.toLowerCase() : null;
    const regulatedBy = reverse.get(lk) ?? [];
    const regulates = forward.get(lk) ?? (gk ? forward.get(gk) : null) ?? [];
    const operonsOf = geneOperons.get(lk) ?? [];
    const sigmulonsOf = geneSigmulons.get(lk) ?? [];
    const modulonsOf = geneModulons.get(lk) ?? [];
    if (!regulatedBy.length && !regulates.length && !operonsOf.length && !sigmulonsOf.length && !modulonsOf.length) continue;
    const doc = {
      uniqID: f.uniqID, gene: f.gene, source: 'MTB Network Portal TRN + iModulonDB + BioCyc',
      regulatedBy, regulates, operons: operonsOf, sigmulons: sigmulonsOf, modulons: modulonsOf,
    };
    writeFileSync(resolve(outDir, `${f.uniqID}.json`), JSON.stringify(doc, null, 2) + '\n');
    index[f.uniqID] = {
      gene: f.gene, regulatedBy: regulatedBy.length, regulates: regulates.length,
      operons: operonsOf.length, sigmulons: sigmulonsOf.length, modulons: modulonsOf.length,
    };
    count++;
  }
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'regulon_members.json'), JSON.stringify(regulonMembers, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'modulon_members.json'), JSON.stringify(modulonMembers, null, 2) + '\n');
  console.log(`[regulation] ${count} features; ${Object.keys(regulonMembers).length} regulon + ${Object.keys(modulonMembers).length} modulon member-sets.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
