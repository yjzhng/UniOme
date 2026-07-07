#!/usr/bin/env node
// Build a protein → complex-membership index from the EBI Complex Portal, for the protein
// viewer's STATE (oligomeric assembly) and COMPLEX (composition) fields. Downloads the
// per-species ComplexTAB once (local-first) and writes:
//   proteins/complexes.json  { <UniProtAcc>: [ { ac, name, link, assembly, classes, members } ] }
// where members are the OTHER participants (proteins/RNA linked to our features when possible,
// ligands by ChEBI id). `classes` is the set of molecule kinds in the complex (protein / RNA /
// ligand …) and `assembly` is Complex Portal's curated quaternary state (Homodimer, …).
//
// ComplexTAB columns used: 0 ac, 1 name, 4 participants "ID(stoich)|…", 11 complex assembly.
// Participant id kinds: UniProt acc → protein, URS… → RNA, CHEBI: → ligand, CPX- → sub-complex.
//
// Usage: node scripts/build-complex-index.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const COMPLEXTAB = (taxid) => `https://ftp.ebi.ac.uk/pub/databases/intact/complex/current/complextab/${taxid}.tsv`;
const PORTAL = (ac) => `https://www.ebi.ac.uk/complexportal/complex/${ac}`;

// Molecule kind from a Complex Portal participant id.
const kindOf = (id) => id.startsWith('CHEBI:') ? 'ligand' : id.startsWith('URS') ? 'RNA' : id.startsWith('CPX-') ? 'complex' : 'protein';
// Base UniProt acc — strip the PRO chain (P69741-PRO_0000013430) / isoform (P12345-2) suffix
// that Complex Portal often uses for a specific processed chain, so it matches our UniProtID.
const baseAcc = (id) => id.replace(/-(PRO_\d+|\d+)$/, '');
// "P76052(1)" → { id: 'P76052', stoich: '1' }
const parsePart = (s) => { const m = /^(.+?)\((\d+)\)$/.exec(s.trim()); return m ? { id: m[1], stoich: m[2] } : { id: s.trim(), stoich: '' }; };
const cleanAssembly = (s) => { const t = (s ?? '').trim(); return t && t !== '-' ? t : null; };
// Representative PDB id from the cross-references column: prefer a structure of the whole
// complex ("identity") over a partial one ("subset").
const pdbOf = (xrefs) => {
  const ids = [...(xrefs ?? '').matchAll(/wwpdb:([0-9a-zA-Z]{4})\((identity|subset)\)/g)].map((m) => ({ id: m[1].toLowerCase(), q: m[2] }));
  return (ids.find((x) => x.q === 'identity') ?? ids[0])?.id ?? null;
};

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const proteinsDir = resolve(RESOURCES, folder, 'proteins');
  mkdirSync(proteinsDir, { recursive: true });

  // UniProt acc → our feature, and RNAcentral URS → our RNA feature (for linkable members).
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const byAcc = new Map();
  for (const r of rows) { const a = (r.UniProtID ?? '').trim(); if (a) byAcc.set(a, { uniqID: (r.uniqID ?? '').trim(), gene: (r.gene ?? '').trim() }); }
  const byUrs = (() => {
    const m = new Map();
    try {
      const idx = JSON.parse(readFileSync(resolve(RESOURCES, folder, 'rna', 'index.json'), 'utf8'));
      const gene = new Map(rows.map((r) => [(r.uniqID ?? '').trim(), (r.gene ?? '').trim()]));
      for (const [uniqID, v] of Object.entries(idx)) { const u = (v.urs ?? '').toUpperCase(); if (u && !m.has(u)) m.set(u, { uniqID, gene: gene.get(uniqID) || uniqID }); }
    } catch { /* no rna index */ }
    return m;
  })();

  // Download the ComplexTAB once into _assets (cache), then parse.
  const cacheDir = resolve(RESOURCES, folder, '_assets'); mkdirSync(cacheDir, { recursive: true });
  const cache = resolve(cacheDir, `complextab_${taxid}.tsv`);
  if (!existsSync(cache)) {
    console.log(`  downloading Complex Portal ${taxid}.tsv …`);
    execSync(`curl -sS -L --max-time 120 ${JSON.stringify(COMPLEXTAB(taxid))} -o ${JSON.stringify(cache)}`, { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  const lines = readFileSync(cache, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

  const out = {}; // protein uniqID-acc → [complex]
  const rnaOut = {}; // RNA uniqID → [complex]
  for (const line of lines) {
    const c = line.split('\t');
    const ac = c[0]?.trim(); if (!ac) continue;
    const name = c[1]?.trim() || ac;
    const assembly = cleanAssembly(c[11]);
    const pdbId = pdbOf(c[8]);
    const parts = (c[4] ?? '').split('|').map(parsePart).filter((p) => p.id);

    // Composition: a sub-complex (CPX) participant is itself protein-based → count it as protein.
    const classes = [...new Set(parts.map((p) => { const k = kindOf(p.id); return k === 'complex' ? 'protein' : k; }))];
    // Display member for each participant (proteins/RNA resolved to our features; ligands by id).
    const member = (p) => {
      const kind = kindOf(p.id);
      if (kind === 'RNA') { const h = byUrs.get(p.id.replace(/_\d+$/, '').toUpperCase()); return { id: p.id, kind, stoich: p.stoich, name: h?.gene ?? 'RNA', uniqID: h?.uniqID ?? null }; }
      if (kind === 'ligand') return { id: p.id, kind, stoich: p.stoich, name: p.id, uniqID: null };
      if (kind === 'complex') return { id: p.id, kind: 'protein', stoich: p.stoich, name: p.id, uniqID: null };
      const h = byAcc.get(baseAcc(p.id)); return { id: p.id, kind, stoich: p.stoich, name: h?.gene || baseAcc(p.id), uniqID: h?.uniqID ?? null };
    };
    const members = parts.map(member);

    const entry = (self) => ({ ac, name, link: PORTAL(ac), assembly, pdbId, classes, members: members.filter((m) => m.id !== self) });
    for (const p of parts) {
      const kind = kindOf(p.id);
      if (kind === 'protein') {
        const key = baseAcc(p.id);
        if (byAcc.has(key)) (out[key] ??= []).push(entry(p.id)); // index by our proteins
      } else if (kind === 'RNA') {
        const h = byUrs.get(p.id.replace(/_\d+$/, '').toUpperCase());
        if (h?.uniqID) (rnaOut[h.uniqID] ??= []).push(entry(p.id)); // index by our RNA features
      }
    }
  }

  writeFileSync(resolve(proteinsDir, 'complexes.json'), JSON.stringify(out, null, 2) + '\n');
  const rnaDir = resolve(RESOURCES, folder, 'rna'); mkdirSync(rnaDir, { recursive: true });
  writeFileSync(resolve(rnaDir, 'complexes.json'), JSON.stringify(rnaOut, null, 2) + '\n');
  console.log(`[complexes] RNA: ${Object.keys(rnaOut).length} RNA features in complexes → ${folder}/rna/complexes.json`);
  console.log(`[complexes] ${lines.length} complexes → ${Object.keys(out).length} proteins with complex membership → ${folder}/proteins/complexes.json`);
}

main();
