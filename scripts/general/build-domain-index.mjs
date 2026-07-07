#!/usr/bin/env node
// Build the protein-feature → member-genes indexes from already-fetched assets, for the
// Relationships "shared domains / motif" views (genes sharing a domain or CDD motif). No
// network: reads resources/<org>/proteins/{interpro,domains,cdd}/<acc>.json, maps UniProt
// acc → feature via the DB, writes (under resources/<org>/proteins/):
//   InterPro  domain_members.json  { IPRid: { id, name, link, members:[{name,uniqID}] } }
//             gene_domains.json     { uniqID: [{ id, colorIndex }] }
//   TED/CATH  ted_members.json      { cath:  { id, name, link, members } }
//             gene_ted.json         { uniqID: [{ cath, colorIndex }] }
//   CDD motif motif_members.json    { key:   { id, name, link, members } }  key = entry|description
//             gene_motifs.json      { uniqID: [{ key, colorIndex }] }
// colorIndex reproduces the per-gene palette index of the protein viewer's feature table, so
// the Relationships row can show a matching colour square. It mirrors each viewer source's
// ordering: InterPro = position in the interpro asset; TED = TED-id-sorted (see proteins.ts);
// CDD = the motif's model, indexed by first appearance among the motifs.
//
// Usage: node scripts/build-domain-index.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const INTERPRO = (id) => `https://www.ebi.ac.uk/interpro/entry/InterPro/${id}/`;
const CATHDB = (sf) => `https://www.cathdb.info/version/latest/superfamily/${sf}`;
const CDD = (entry) => `https://www.ncbi.nlm.nih.gov/Structure/cdd/${entry}`;

// TED ids sort numerically (TED01, TED02, …) — match loadProteinDomains' ordering so the
// computed colorIndex lines up with the viewer's TED feature table.
const tedNum = (d) => { const m = /(\d+)/.exec(d.id ?? ''); return m ? Number(m[1]) : Infinity; };

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  // UniProt accession → features (usually one).
  const byAcc = new Map();
  for (const r of rows) {
    const acc = (r.UniProtID ?? '').trim();
    const uniqID = (r.uniqID ?? '').trim();
    if (!acc || !uniqID) continue;
    (byAcc.get(acc) ?? byAcc.set(acc, []).get(acc)).push({ uniqID, gene: (r.gene ?? '').trim() || uniqID });
  }

  const proteinsDir = resolve(RESOURCES, folder, 'proteins');
  const read = (sub, acc) => { try { return JSON.parse(readFileSync(resolve(proteinsDir, sub, `${acc}.json`), 'utf8')); } catch { return null; } };

  const interproDir = resolve(proteinsDir, 'interpro');
  if (!existsSync(interproDir)) throw new Error(`no interpro assets in ${folder}`);

  const domainMembers = {}; // IPRid → {id,name,link,members}
  const geneDomains = {}; // uniqID → [{id,colorIndex}]
  const tedMembers = {}; // cath → {id,name,link,members}
  const geneTed = {}; // uniqID → [{cath,colorIndex}]
  const motifMembers = {}; // key → {id,name,link,members}
  const geneMotifs = {}; // uniqID → [{key,colorIndex}]
  const memberSeen = new Map(); // groupId → Set(uniqID) (dedupe members across proteins)

  // Add a member gene to a group's member list (once per group).
  const addMember = (members, groupId, f) => {
    const ms = memberSeen.get(groupId) ?? memberSeen.set(groupId, new Set()).get(groupId);
    if (!ms.has(f.uniqID)) { ms.add(f.uniqID); members.push({ name: f.gene, uniqID: f.uniqID }); }
  };

  for (const acc of new Set([...readdirSync(interproDir).map((f) => f.replace(/\.json$/, ''))])) {
    const feats = byAcc.get(acc);
    if (!feats) continue;

    // --- InterPro: colorIndex = position in the interpro asset's domains[] (viewer order).
    const ip = read('interpro', acc);
    if (ip?.domains?.length) {
      const seen = new Set();
      ip.domains.forEach((d, i) => {
        const id = d.id;
        if (!id || !/^IPR\d+$/.test(id)) return;
        const entry = (domainMembers[id] ??= { id, name: d.name ?? id, link: INTERPRO(id), members: [] });
        for (const f of feats) addMember(entry.members, id, f);
        if (seen.has(id)) return; // one row per gene+domain (first occurrence keeps its colour)
        seen.add(id);
        for (const f of feats) (geneDomains[f.uniqID] ??= []).push({ id, colorIndex: i });
      });
    }

    // --- TED: group by CATH superfamily; colorIndex = position in TED-id-sorted list.
    const ted = read('domains', acc);
    if (ted?.domains?.length) {
      const sorted = [...ted.domains].sort((a, b) => tedNum(a) - tedNum(b));
      const seen = new Set();
      sorted.forEach((d, i) => {
        const sf = (d.cath ?? '').trim();
        if (!sf || sf === '-') return;
        const entry = (tedMembers[sf] ??= { id: sf, name: d.cathName || sf, link: CATHDB(sf), members: [] });
        for (const f of feats) addMember(entry.members, `ted:${sf}`, f);
        if (seen.has(sf)) return;
        seen.add(sf);
        for (const f of feats) (geneTed[f.uniqID] ??= []).push({ cath: sf, colorIndex: i });
      });
    }

    // --- CDD motifs: group by entry|description; colorIndex = model first-appearance index.
    const cdd = read('cdd', acc);
    if (cdd?.motifs?.length) {
      const modelIdx = new Map();
      const idxOf = (e) => { if (!modelIdx.has(e)) modelIdx.set(e, modelIdx.size); return modelIdx.get(e); };
      const seen = new Set();
      for (const m of cdd.motifs) {
        const key = `${m.entry}|${m.description}`;
        const ci = idxOf(m.entry);
        const entry = (motifMembers[key] ??= { id: m.entry, name: m.description || m.entry, link: CDD(m.entry), members: [] });
        for (const f of feats) addMember(entry.members, `motif:${key}`, f);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const f of feats) (geneMotifs[f.uniqID] ??= []).push({ key, colorIndex: ci });
      }
    }
  }

  const w = (name, obj) => writeFileSync(resolve(proteinsDir, name), JSON.stringify(obj, null, 2) + '\n');
  w('domain_members.json', domainMembers);
  w('gene_domains.json', geneDomains);
  w('ted_members.json', tedMembers);
  w('gene_ted.json', geneTed);
  w('motif_members.json', motifMembers);
  w('gene_motifs.json', geneMotifs);
  console.log(`[domains] InterPro ${Object.keys(domainMembers).length} · TED/CATH ${Object.keys(tedMembers).length} · CDD motif ${Object.keys(motifMembers).length} → ${folder}/proteins/`);
}

main();
