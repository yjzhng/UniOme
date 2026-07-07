#!/usr/bin/env node
// One-time, build-time fetch of REGULATION into resources/<org>/regulation/ for S. aureus
// NCTC 8325 (taxid 93061). Mirrors the per-gene record shape of the E. coli builder
// (scripts/organisms/83333_Ec/fetch-regulation.mjs) but uses different sources, because
// RegulonDB/iModulonDB are E. coli-only.
//
// SOURCES
//   1. RegPrecise 3.2 (regprecise.lbl.gov) — the only curated, machine-readable transcriptional
//      regulatory network for S. aureus. Its REST web-services API (the NAR-2012 /Services/rest
//      endpoints) is dead in the current Cloudflare/Tomcat deployment (all 404), but the JSP
//      pages + the per-regulon ExportServlet (tab-delimited) still work, so we scrape those.
//      The ONLY S. aureus genome in RegPrecise is N315 (genome_id=26), keyed on SA#### loci.
//      For each regulon we read:
//        - regulon.jsp?regulon_id=<id>  → regulator name (page title), regulator type
//          (Transcription factor vs RNA regulatory element — we KEEP only TFs, since the
//          contract's regulatorType enum is TF|sRNA and riboswitches/leaders are cis-RNA
//          elements that don't fit), regulation mode (activator|repressor|dual), TF locus tag.
//        - ExportServlet?type=gene&regulonId=<id> → regulated genes as
//          "<vimssId>\t<N315 locus>\t<gene name>", with blank lines separating operons.
//   2. AureoWiki (aureowiki.med.uni-greifswald.de) orthologue matrix — the canonical
//      cross-strain locus crosswalk. We POST to the AureoDownload extension
//      (extensions/AureoDownload/download.php) selecting just N315 + NCTC8325, which returns the
//      full ~6500-row matrix as TSV (columns: pan ID, N315, NCTC8325). NOTE: the endpoint
//      enforces a "download context" check via the Referer header, and the public http URL
//      301-redirects to https (dropping the Referer); we therefore POST to the https endpoint
//      with an https Referer. We map RegPrecise's N315 loci onto our SAOUHSC_ loci through this.
//      (Gene-symbol mapping alone only resolves ~45%, because N315 and NCTC 8325 use divergent
//      gene-symbol/locus conventions; the orthologue matrix is the reliable crosswalk.)
//
// MAPPING to our uniqID
//   N315 locus --(AureoWiki matrix)--> NCTC8325 locus (SAOUHSC_) --(core *_DB.csv)--> uniqID.
//   Fallbacks when the matrix lacks the row: gene symbol → uniqID. uniqID=null if unresolved.
//
// NOT PRODUCED / EMPTY (no S. aureus source):
//   - sigmulons[] : RegPrecise doesn't model sigma regulons for S. aureus → always [].
//   - modulons[]  : iModulonDB staph_precise108 is USA300-keyed; skipped per the task → [].
//   Operons[] are derived from the blank-line-separated operon groups in the RegPrecise gene
//   exports (the operon(s) a gene co-occurs in within a regulon), which is the only operon
//   signal RegPrecise exposes.
//
// Usage: node scripts/organisms/93061_Sa/build-regulation.mjs [taxid]   (default 93061)

import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const RP = 'https://regprecise.lbl.gov';
const RP_GENOME_ID = 26; // Staphylococcus aureus subsp. aureus N315 — the only S. aureus genome
const AUREOWIKI_HOST = 'https://aureowiki.med.uni-greifswald.de';
const AUREOWIKI_ORTHO_PAGE = `${AUREOWIKI_HOST}/download_orthologue_table`;
const AUREOWIKI_DOWNLOAD = `${AUREOWIKI_HOST}/extensions/AureoDownload/download.php`;
const UA = 'Mozilla/5.0 (UniOme build-regulation)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RegPrecise regulation-mode string → our function enum.
function mapFunction(mode) {
  const m = (mode ?? '').trim().toLowerCase();
  if (m === 'activator') return 'activator';
  if (m === 'repressor') return 'repressor';
  if (m === 'dual') return 'dual';
  return null;
}

// fetch with retry; returns text or null. (RegPrecise/AureoWiki TLS is fine over node fetch.)
// opts.body+opts.headers → POST; opts.cache → on-disk cache under _assets/.
async function getText(url, { cache, body, headers } = {}) {
  if (cache && existsSync(cache)) return readFileSync(cache, 'utf8');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'User-Agent': UA, Accept: '*/*', ...(headers ?? {}) },
        body,
        redirect: 'follow',
      });
      if (r.ok) {
        const t = await r.text();
        if (cache) writeFileSync(cache, t);
        return t;
      }
    } catch { /* retry */ }
    await sleep(Math.min(20000, 600 * 2 ** attempt) + Math.random() * 400);
  }
  return null;
}

function allFeatures(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder, 'core')).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, 'core', dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  return rows
    .map((r) => ({ uniqID: (r.uniqID ?? '').trim(), gene: (r.gene ?? '').trim(), locus_tag: (r.locus_tag ?? '').trim() }))
    .filter((f) => f.uniqID && f.locus_tag);
}

// Parse the AureoWiki orthologue matrix TSV → Map(N315 locus → NCTC8325 locus).
// Header row: "pan ID\tN315\tNCTC8325"; one ortholog group per row (blank cells = no ortholog).
function parseOrthologueTsv(tsv) {
  const map = new Map();
  const lines = tsv.split(/\r?\n/).filter((l) => l.length);
  const header = lines.shift()?.split('\t').map((s) => s.trim()) ?? [];
  const iN315 = header.indexOf('N315');
  const iNCTC = header.indexOf('NCTC8325');
  if (iN315 < 0 || iNCTC < 0) throw new Error(`matrix columns missing: N315=${iN315} NCTC8325=${iNCTC} (header=${header})`);
  for (const line of lines) {
    const c = line.split('\t');
    const n315 = (c[iN315] ?? '').trim();
    const nctc = (c[iNCTC] ?? '').trim();
    if (n315 && nctc) map.set(n315, nctc);
  }
  return map;
}

async function main() {
  const taxid = process.argv[2] || '93061';
  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'regulation');
  const assetDir = resolve(RESOURCES, folder, '_assets');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(assetDir, { recursive: true });

  const features = allFeatures(folder);
  const byLocus = new Map(features.map((f) => [f.locus_tag, f]));
  const byGene = new Map(features.filter((f) => f.gene).map((f) => [f.gene.toLowerCase(), f]));
  console.log(`[regulation] ${features.length} features (${byLocus.size} loci, ${byGene.size} gene symbols)`);

  // --- 1. AureoWiki orthologue matrix: N315 locus → NCTC8325 (SAOUHSC_) locus ---
  // POST to the AureoDownload extension for the full TSV (the embedded HTML preview is truncated
  // to ~30 rows). The endpoint validates a "download context" via Referer, so we set it.
  console.log('[regulation] AureoWiki orthologue matrix (N315 → NCTC8325)…');
  const orthoBody = new URLSearchParams();
  orthoBody.append('orthologMatrixStrainSelection[]', 'N315');
  orthoBody.append('orthologMatrixStrainSelection[]', 'NCTC8325');
  orthoBody.append('download_token_hidden_field', '');
  orthoBody.append('button', 'Download as Text (.tsv)');
  const orthoTsv = await getText(AUREOWIKI_DOWNLOAD, {
    cache: resolve(assetDir, 'aureowiki_orthologue_N315_NCTC8325.tsv'),
    body: orthoBody.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: AUREOWIKI_ORTHO_PAGE },
  });
  if (!orthoTsv || /Please call in Download context/i.test(orthoTsv)) throw new Error('AureoWiki orthologue matrix unreachable / download-context rejected');
  const n315ToNctc = parseOrthologueTsv(orthoTsv);
  console.log(`  ${n315ToNctc.size} N315→NCTC8325 ortholog pairs`);

  // resolve an N315 locus (+ gene-symbol fallback) → feature {uniqID, gene, locus_tag} | null
  const resolveN315 = (n315Locus, geneName) => {
    const nctc = n315ToNctc.get(n315Locus);
    if (nctc) {
      const f = byLocus.get(nctc);
      if (f) return f;
    }
    if (geneName) {
      const f = byGene.get(geneName.toLowerCase());
      if (f) return f;
    }
    return null;
  };

  // --- 2. RegPrecise N315 genome page → list of regulons (id + regulator name) ---
  console.log('[regulation] RegPrecise N315 genome page…');
  const genomeHtml = await getText(`${RP}/genome.jsp?genome_id=${RP_GENOME_ID}`, { cache: resolve(assetDir, `regprecise_genome_${RP_GENOME_ID}.html`) });
  if (!genomeHtml) throw new Error('RegPrecise genome page unreachable');
  const regulonRefs = [];
  const seenReg = new Set();
  for (const m of genomeHtml.matchAll(/regulon\.jsp\?regulon_id=(\d+)"[^>]*>([^<]+)</gi)) {
    const id = m[1];
    if (seenReg.has(id)) continue;
    seenReg.add(id);
    regulonRefs.push({ id, name: m[2].trim() });
  }
  console.log(`  ${regulonRefs.length} regulons listed`);

  // --- 3. Per-regulon: properties (type/mode/title/TF locus) + regulated genes export ---
  const getProp = (html, label) => {
    const m = new RegExp(label + '\\s*</td>\\s*<td>(?:<a[^>]*>)?([^<]*)', 'i').exec(html);
    return m ? m[1].trim() : null;
  };

  const forward = new Map();      // regulator uniqID/key → [{name,uniqID,function}]
  const reverse = new Map();      // target locus → [{name,uniqID,function,regulatorType,link}]
  const geneOperons = new Map();  // target locus → [operon entry]
  const regulonMembers = {};      // regulator display name → [{name,uniqID}]

  let kept = 0, skippedRNA = 0;
  for (const ref of regulonRefs) {
    const regHtml = await getText(`${RP}/regulon.jsp?regulon_id=${ref.id}`, { cache: resolve(assetDir, `regprecise_regulon_${ref.id}.html`) });
    if (!regHtml) { console.warn(`  ! regulon ${ref.id} (${ref.name}) page failed`); continue; }
    const regType = getProp(regHtml, 'Regulator type:') ?? '';
    // KEEP only protein TFs (contract enum is TF|sRNA; RNA regulatory elements are cis riboswitches/leaders)
    if (!/transcription factor/i.test(regType)) { skippedRNA++; continue; }
    const regName = (/Regulon of <span class="titleItem">([^<]*)/.exec(regHtml)?.[1] ?? ref.name).trim();
    const fn = mapFunction(getProp(regHtml, 'Regulation mode:'));
    const tfLocusN315 = getProp(regHtml, 'TF locus tag:');
    const regLink = `${RP}/regulon.jsp?regulon_id=${ref.id}`;
    const regFeat = tfLocusN315 ? resolveN315(tfLocusN315, regName) : (byGene.get(regName.toLowerCase()) ?? null);
    const regUniq = regFeat?.uniqID ?? null;

    const tsv = await getText(`${RP}/ExportServlet?type=gene&regulonId=${ref.id}`, { cache: resolve(assetDir, `regprecise_genes_${ref.id}.tsv`) });
    if (tsv == null) { console.warn(`  ! regulon ${ref.id} (${regName}) gene export failed`); continue; }

    kept++;
    const fSeen = new Set();
    const rmSeen = new Set();
    let operon = []; // current operon group (blank line resets)
    const operonGroups = [];
    for (const line of tsv.split(/\r?\n/)) {
      if (!line.trim()) { if (operon.length) operonGroups.push(operon); operon = []; continue; }
      const [, n315, gname] = line.split('\t');
      if (!n315) continue;
      const tgt = resolveN315(n315.trim(), (gname ?? '').trim());
      operon.push({ n315: n315.trim(), gname: (gname ?? '').trim(), feat: tgt });
    }
    if (operon.length) operonGroups.push(operon);

    for (const group of operonGroups) {
      // operon entry (shared by all members of this group)
      const members = group.map((g) => ({ name: g.feat?.gene || g.gname || g.n315, uniqID: g.feat?.uniqID ?? null }));
      const operonName = members.map((m) => m.name).filter(Boolean).join('-') || null;
      const operonEntry = operonName ? { name: operonName, link: regLink, members } : null;

      for (const g of group) {
        const tgt = g.feat;
        const tName = tgt?.gene || g.gname || g.n315;
        const tUniq = tgt?.uniqID ?? null;
        const tLocus = tgt?.locus_tag ?? null;
        if (!tLocus) continue; // can't attach to one of our features → not written

        // reverse edge (this gene is regulatedBy regName)
        if (!reverse.has(tLocus)) reverse.set(tLocus, []);
        const rk = `${regName}|${fn}`;
        if (!reverse.get(tLocus).some((e) => `${e.name}|${e.function}` === rk)) {
          reverse.get(tLocus).push({ name: regName, uniqID: regUniq, function: fn, regulatorType: 'TF', link: regLink });
        }
        // forward edge keyed on regulator locus (only if regulator resolved)
        if (regFeat) {
          const fk = regFeat.locus_tag;
          if (!forward.has(fk)) forward.set(fk, []);
          const fkey = `${tName}|${fn}`;
          if (!fSeen.has(fk + '::' + fkey)) {
            fSeen.add(fk + '::' + fkey);
            if (!forward.get(fk).some((e) => `${e.name}|${e.function}` === fkey)) {
              forward.get(fk).push({ name: tName, uniqID: tUniq, function: fn });
            }
          }
        }
        // operon membership for this gene
        if (operonEntry && operonEntry.members.length > 1) {
          if (!geneOperons.has(tLocus)) geneOperons.set(tLocus, []);
          if (!geneOperons.get(tLocus).some((o) => o.name === operonEntry.name)) geneOperons.get(tLocus).push(operonEntry);
        }
        // regulon → members index
        if (!rmSeen.has(tName)) { rmSeen.add(tName); (regulonMembers[regName] ??= []).push({ name: tName, uniqID: tUniq }); }
      }
    }
  }
  console.log(`  kept ${kept} TF regulons, skipped ${skippedRNA} RNA regulatory elements`);

  // --- 4. Write per-gene records + indexes ---
  const index = {};
  let count = 0;
  for (const f of features) {
    const regulatedBy = reverse.get(f.locus_tag) ?? [];
    const regulates = forward.get(f.locus_tag) ?? [];
    const operonsOf = geneOperons.get(f.locus_tag) ?? [];
    const sigmulonsOf = []; // no S. aureus sigmulon source
    const modulonsOf = [];  // no usable (gene-symbol) S. aureus modulon source
    if (!regulatedBy.length && !regulates.length && !operonsOf.length) continue;
    const doc = {
      uniqID: f.uniqID,
      gene: f.gene || f.locus_tag,
      source: 'RegPrecise (N315) + AureoWiki orthologs',
      regulatedBy,
      regulates,
      operons: operonsOf,
      sigmulons: sigmulonsOf,
      modulons: modulonsOf,
    };
    writeFileSync(resolve(outDir, `${f.uniqID}.json`), JSON.stringify(doc, null, 2) + '\n');
    index[f.uniqID] = {
      gene: doc.gene,
      regulatedBy: regulatedBy.length,
      regulates: regulates.length,
      operons: operonsOf.length,
      sigmulons: 0,
      modulons: 0,
    };
    count++;
  }
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'regulon_members.json'), JSON.stringify(regulonMembers, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'modulon_members.json'), JSON.stringify({}, null, 2) + '\n');
  console.log(`[regulation] ${count} features written; ${Object.keys(regulonMembers).length} regulon member-sets; 0 modulon member-sets.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
