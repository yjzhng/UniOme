#!/usr/bin/env node
// One-time, build-time fetch of REGULATION into resources/<org>/regulation/ for B. subtilis
// subsp. subtilis str. 168 (taxid 224308). Mirrors the E. coli fetch-regulation.mjs output
// contract exactly (per-gene record + index/regulon_members/modulon_members indexes), but is
// pinned to B.-subtilis-only sources:
//
//   • TF regulons + sigma factors (sigmulons) + operons → SubtiWiki v5 REST API (the curated,
//     BSU-keyed gold-standard B. subtilis DB). The single endpoint /v5/api/regulon/ returns ALL
//     243 regulons with their regulated genes/operons + regulator_gene + mode (Positive/Negative)
//     + mechanism (TranscriptionFactor / SigmaFactor / RnaSwitch / AntiSenseRna / …). Operons are
//     fetched the same way (embedded in each regulon's operon_regulations, plus the full /operon/
//     list). SubtiWiki operons are unnamed → we synthesize a deterministic name from the member
//     gene symbols.
//   • Modulons → iModulonDB b_subtilis/modulome (SBRG/modulytics). pymodulon outputs split CSVs:
//     M.csv (gene-rows × iModulon-cols weight matrix), M_thresholds.csv (per-iModulon binarization
//     threshold), iM_table.csv (iModulon metadata: name, regulator_readable, category). A gene is a
//     member of an iModulon when |weight| >= that iModulon's threshold (pymodulon binarization,
//     matches imodulondb.org). Gene IDs are BSU_##### — our exact locus format.
//
// SubtiWiki/iModulonDB key genes by symbol (regulons) or BSU_##### (modulome). Our loci are mostly
// BSU_##### but SubtiWiki's few BSU rows come without the underscore — normalize both ways so they
// match (stripUnderscore / our byLocus also indexes the no-underscore form).
//
// Usage: node scripts/organisms/224308_Bs/build-regulation.mjs [taxid=224308]

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const SW = 'https://subtiwiki.uni-goettingen.de/v5/api'; // SubtiWiki v5 REST API
const SW_WEB = 'https://subtiwiki.uni-goettingen.de/v5'; // entry-page links
// iModulonDB b_subtilis/modulome data files (SBRG/modulytics, master branch). M is transposed
// vs the E. coli precise1k JSON: rows=genes (BSU_#####), cols=iModulon index k.
const MODULOME_BASE = 'https://raw.githubusercontent.com/SBRG/modulytics/master/all_data/b_subtilis/modulome/data_files';
const IMODULONDB_IM = 'https://imodulondb.org/b_subtilis/modulome/imodulon'; // entry-page links

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache any downloaded source under <org>/_assets/regulation/ (build-time, resumable).
async function fetchCached(url, cacheFile, { json = true } = {}) {
  if (existsSync(cacheFile)) {
    const t = readFileSync(cacheFile, 'utf8');
    return json ? JSON.parse(t) : t;
  }
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      writeFileSync(cacheFile, t);
      return json ? JSON.parse(t) : t;
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(15000, 500 * 2 ** attempt) + Math.random() * 400);
    }
  }
  throw new Error(`failed to fetch ${url}: ${lastErr?.message}`);
}

function allFeatures(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const dir = existsSync(resolve(RESOURCES, folder, 'core')) ? resolve(RESOURCES, folder, 'core') : resolve(RESOURCES, folder);
  const file = readdirSync(dir).find((f) => /_DB\.csv$/i.test(f)) ?? dbFile;
  const rows = Papa.parse(readFileSync(resolve(dir, file), 'utf8'), { header: true, skipEmptyLines: true }).data;
  return rows
    .map((r) => ({ uniqID: (r.uniqID ?? '').trim(), gene: (r.gene ?? '').trim(), locus_tag: (r.locus_tag ?? '').trim() }))
    .filter((f) => f.uniqID);
}

// SubtiWiki gene names are symbols (ccpA, hutP) or, for unnamed genes, BSU_##### (rarely the
// no-underscore BSU#####). Resolve symbol first, then locus (both underscore forms).
const swToName = (g) => (g?.name ?? '').trim();
const titleSigma = (n) => (n ?? '').replace(/^sig([A-Za-z].*)$/, (_, r) => 'Sig' + r); // sigA → SigA

async function main() {
  const taxid = process.argv[2] || '224308';
  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'regulation');
  const assetDir = resolve(RESOURCES, folder, '_assets', 'regulation');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(assetDir, { recursive: true });

  const features = allFeatures(folder);
  const byGene = new Map();
  for (const f of features) if (f.gene) byGene.set(f.gene.toLowerCase(), f);
  const byLocus = new Map();
  for (const f of features) {
    if (!f.locus_tag) continue;
    byLocus.set(f.locus_tag, f); // BSU_00010
    byLocus.set(f.locus_tag.replace(/_/g, ''), f); // BSU00010 (no underscore, SubtiWiki form)
  }
  // Resolve a SubtiWiki/iModulon gene reference (symbol or locus) to our feature.
  const resolveFeat = (name) => {
    if (!name) return null;
    const n = name.trim();
    return (
      byGene.get(n.toLowerCase()) ??
      byLocus.get(n) ??
      byLocus.get(n.replace(/_/g, '')) ??
      (/^BSU\d/i.test(n) ? byLocus.get(n.replace(/^BSU/i, 'BSU_')) : null) ??
      null
    );
  };
  const resolveGene = (name) => ({ name, uniqID: resolveFeat(name)?.uniqID ?? null });

  // ---------------------------------------------------------------------------------------------
  // 1. SubtiWiki regulons: forward / reverse network edges + sigmulons + regulon→members index.
  // ---------------------------------------------------------------------------------------------
  console.log('[regulation] SubtiWiki regulons (/v5/api/regulon/)…');
  const regResp = await fetchCached(`${SW}/regulon/`, resolve(assetDir, 'subtiwiki_regulons.json'));
  const regulons = regResp?.data ?? [];

  const forward = new Map(); // regulator gene-key → [{name,uniqID,function}]
  const reverse = new Map(); // target gene-key → [{name,uniqID,function,regulatorType,link}]
  const geneSigmulons = new Map(); // target gene-key → [{name,uniqID,link}]
  const regulonMembers = {}; // regulator display name → [{name,uniqID}]
  const fSeen = new Map(), rSeen = new Map(), sSeen = new Map(), rmSeen = new Map();
  const addEdge = (map, key, val, seen, dedupKey) => {
    if (!map.has(key)) map.set(key, []);
    const s = seen.get(key) ?? seen.set(key, new Set()).get(key);
    if (s.has(dedupKey)) return;
    s.add(dedupKey);
    map.get(key).push(val);
  };

  // Positive→activator, Negative→repressor; null mode (sigma transcription, RNA switch) → null.
  const modeToFn = (m) => (m === 'Positive' ? 'activator' : m === 'Negative' ? 'repressor' : null);

  for (const reg of regulons) {
    const regGeneName = swToName(reg.regulator_gene) || (reg.regulator_display_name ?? '').trim();
    if (!regGeneName) continue;
    const regFeat = resolveFeat(regGeneName);
    const regUniq = regFeat?.uniqID ?? null;
    // Display name: a TF/sRNA shows its gene symbol; a riboswitch/motif shows its display name.
    const displayName = swToName(reg.regulator_gene) || regGeneName;
    const regLink = reg.id != null ? `${SW_WEB}/regulation/${reg.id}` : null;

    // Each regulon's edges carry a mechanism → regulator type. Sigma factors are emitted as
    // sigmulons (not regulatedBy edges); everything else is a TF/sRNA regulatory edge.
    const edges = [
      ...(reg.gene_regulations ?? []).map((g) => ({ targets: g.gene ? [g.gene] : [], mode: g.mode, mechanism: g.mechanism })),
      ...(reg.operon_regulations ?? []).map((o) => ({ targets: o.operon?.genes ?? [], mode: o.mode, mechanism: o.mechanism })),
    ];

    for (const e of edges) {
      const isSigma = e.mechanism === 'SigmaFactor';
      // sRNA-class mechanisms (antisense RNA, RNA switch / riboswitch acting in trans, translational,
      // attenuation, termination/antitermination) → regulatorType 'sRNA'; otherwise 'TF'.
      const isSrna = ['AntiSenseRna', 'RnaSwitch', 'Translational', 'Attenuation', 'TerminationAntitermination'].includes(e.mechanism);
      const fn = modeToFn(e.mode);
      for (const g of e.targets) {
        const tName = swToName(g);
        if (!tName) continue;
        const tFeat = resolveFeat(tName);
        const tKey = tName.toLowerCase();
        const tUniq = tFeat?.uniqID ?? null;

        if (isSigma) {
          const sigName = titleSigma(displayName);
          addEdge(geneSigmulons, tKey, { name: sigName, uniqID: regUniq, link: regLink }, sSeen, `${sigName}`);
        } else {
          addEdge(reverse, tKey, { name: displayName, uniqID: regUniq, function: fn, regulatorType: isSrna ? 'sRNA' : 'TF', link: regLink }, rSeen, `${displayName}|${fn}`);
          addEdge(forward, displayName.toLowerCase(), { name: tName, uniqID: tUniq, function: fn }, fSeen, `${tName}|${fn}`);
          const ms = rmSeen.get(displayName) ?? rmSeen.set(displayName, new Set()).get(displayName);
          if (!ms.has(tName)) { ms.add(tName); (regulonMembers[displayName] ??= []).push({ name: tName, uniqID: tUniq }); }
        }
      }
    }
  }
  console.log(`  ${regulons.length} regulons → ${reverse.size} regulated genes, ${forward.size} regulators, ${geneSigmulons.size} sigma-transcribed genes`);

  // ---------------------------------------------------------------------------------------------
  // 2. SubtiWiki operons: operon + co-members per gene. Operons are unnamed → synthesize a name.
  // ---------------------------------------------------------------------------------------------
  console.log('[regulation] SubtiWiki operons (/v5/api/operon/)…');
  const opResp = await fetchCached(`${SW}/operon/`, resolve(assetDir, 'subtiwiki_operons.json'));
  const operons = opResp?.data ?? [];
  const geneOperons = new Map();
  const operonName = (members) => (members.length > 4 ? `${members[0]}…${members[members.length - 1]}` : members.join('-')) || 'operon';
  for (const op of operons) {
    const members = [...new Set((op.genes ?? []).map(swToName).filter(Boolean))];
    if (members.length < 2) continue; // single-gene "operons" carry no co-membership signal
    const name = operonName(members);
    const entry = { name, link: op.id != null ? `${SW_WEB}/operon/${op.id}` : null, members: members.map(resolveGene) };
    for (const m of members) {
      const key = m.toLowerCase();
      if (!geneOperons.has(key)) geneOperons.set(key, []);
      geneOperons.get(key).push(entry);
    }
  }
  console.log(`  ${operons.length} operons (${[...geneOperons.keys()].length} genes in multi-gene operons)`);

  // ---------------------------------------------------------------------------------------------
  // 3. iModulonDB b_subtilis/modulome modulons: genes with |M weight| >= the iModulon's threshold.
  // ---------------------------------------------------------------------------------------------
  console.log('[regulation] iModulonDB b_subtilis/modulome…');
  const geneModulons = new Map(); // locus → [{name,regulator,function,link}]
  const modulonMembers = {};
  try {
    const mCsv = await fetchCached(`${MODULOME_BASE}/M.csv`, resolve(assetDir, 'modulome_M.csv'), { json: false });
    const thrCsv = await fetchCached(`${MODULOME_BASE}/M_thresholds.csv`, resolve(assetDir, 'modulome_thresholds.csv'), { json: false });
    const imCsv = await fetchCached(`${MODULOME_BASE}/iM_table.csv`, resolve(assetDir, 'modulome_iM_table.csv'), { json: false });

    // M.csv: first column = gene (BSU_#####), remaining columns = iModulon index k (0..71).
    const M = Papa.parse(mCsv, { header: true, skipEmptyLines: true });
    const geneCol = M.meta.fields[0]; // '' (unnamed index column)
    const imKeys = M.meta.fields.slice(1); // ['0','1',...]
    // thresholds: rows '<k>,<threshold>' (first col = iModulon index, second = threshold value).
    const thr = {};
    const thrParsed = Papa.parse(thrCsv, { header: true, skipEmptyLines: true });
    const thrKCol = thrParsed.meta.fields[0];
    const thrVCol = thrParsed.meta.fields[1];
    for (const row of thrParsed.data) {
      thr[String(row[thrKCol]).trim()] = Math.abs(Number(row[thrVCol]));
    }
    // iM_table: k,name,regulator_readable,function,category,…
    const imMeta = {};
    for (const row of Papa.parse(imCsv, { header: true, skipEmptyLines: true }).data) {
      const k = String(row.k).trim();
      imMeta[k] = {
        name: (row.name || `iM-${k}`).trim(),
        regulator: (row.regulator_readable || '').trim() || null,
        function: (row.function || '').trim() || (row.category || '').trim() || null,
      };
    }

    // Membership: per iModulon, genes whose |weight| clears the threshold.
    const modByK = {}; // k → {name,regulator,function,members:[]}
    for (const k of imKeys) {
      const meta = imMeta[k] ?? { name: `iM-${k}`, regulator: null, function: null };
      modByK[k] = { ...meta, link: `${IMODULONDB_IM}/${k}`, members: [] };
    }
    for (const row of M.data) {
      const locus = (row[geneCol] ?? '').trim();
      if (!locus) continue;
      const feat = resolveFeat(locus);
      for (const k of imKeys) {
        const w = Number(row[k]);
        const t = thr[k];
        if (!Number.isFinite(w) || !Number.isFinite(t) || Math.abs(w) < t) continue;
        const mod = modByK[k];
        mod.members.push({ name: feat?.gene || locus, uniqID: feat?.uniqID ?? null });
        if (feat) {
          const key = feat.locus_tag;
          if (!geneModulons.has(key)) geneModulons.set(key, []);
          geneModulons.get(key).push({ name: mod.name, regulator: mod.regulator, function: mod.function, link: mod.link });
        }
      }
    }
    for (const k of imKeys) {
      const mod = modByK[k];
      modulonMembers[mod.name] = { regulator: mod.regulator, function: mod.function, members: mod.members };
    }
    console.log(`  ${imKeys.length} iModulons → ${[...geneModulons.keys()].length} genes with modulon membership`);
  } catch (e) {
    console.warn(`  [warn] iModulonDB modulome unavailable, modulons will be []: ${e.message}`);
  }

  // ---------------------------------------------------------------------------------------------
  // 4. Write the unified per-gene regulation record + indexes.
  // ---------------------------------------------------------------------------------------------
  const index = {};
  let count = 0;
  for (const f of features) {
    const gKey = (f.gene || '').toLowerCase();
    const lKey = f.locus_tag;
    const regulatedBy = (gKey && reverse.get(gKey)) || (lKey && reverse.get(lKey.toLowerCase())) || [];
    const regulates = (gKey && forward.get(gKey)) || (lKey && forward.get(lKey.toLowerCase())) || [];
    const operonsOf = (gKey && geneOperons.get(gKey)) || (lKey && geneOperons.get(lKey.toLowerCase())) || [];
    const sigmulonsOf = (gKey && geneSigmulons.get(gKey)) || (lKey && geneSigmulons.get(lKey.toLowerCase())) || [];
    const modulonsOf = geneModulons.get(f.locus_tag) ?? [];
    if (!regulatedBy.length && !regulates.length && !operonsOf.length && !sigmulonsOf.length && !modulonsOf.length) continue;
    const doc = {
      uniqID: f.uniqID,
      gene: f.gene,
      source: 'SubtiWiki + iModulonDB',
      regulatedBy,
      regulates,
      operons: operonsOf,
      sigmulons: sigmulonsOf,
      modulons: modulonsOf,
    };
    writeFileSync(resolve(outDir, `${f.uniqID}.json`), JSON.stringify(doc, null, 2) + '\n');
    index[f.uniqID] = {
      gene: f.gene,
      regulatedBy: regulatedBy.length,
      regulates: regulates.length,
      operons: operonsOf.length,
      sigmulons: sigmulonsOf.length,
      modulons: modulonsOf.length,
    };
    count++;
  }
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'regulon_members.json'), JSON.stringify(regulonMembers, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'modulon_members.json'), JSON.stringify(modulonMembers, null, 2) + '\n');
  console.log(`[regulation] ${count} features; ${Object.keys(regulonMembers).length} regulon + ${Object.keys(modulonMembers).length} modulon member-sets.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
