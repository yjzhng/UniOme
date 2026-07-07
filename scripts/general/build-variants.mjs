#!/usr/bin/env node
// Build a per-locus NATURAL-VARIANTS index (nucleotide SNPs) from the same panel of E. coli genomes
// already aligned for conservation (scripts/build-conservation.mjs leaves the per-genome MUMmer
// show-snps tables in _assets/conservation/aln/). For every feature it lists the variable positions
// within its span — DNA position, reference + alternate base, and how many panel genomes carry it —
// in the feature's own 5'→3' orientation (bases complemented for minus-strand genes), so the same
// index serves the DNA panel, the RNA panel, and a CDS's mRNA.
//
// Writes resources/<org>/variants.json: { uniqID: { n: <panel size>, sites: [[pos, ref, alt, count]] } }
//
// Usage: node scripts/build-variants.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, findDb } from '../lib/org.mjs';

const COMP = { A: 'T', T: 'A', G: 'C', C: 'G' };
const ACGT = new Set(['A', 'C', 'G', 'T']);

// GenBank location → { segments:[[s,e]], strand }.
function parseCoord(coord) {
  const strand = /complement/i.test(coord) ? '-' : '+';
  const segments = [];
  const re = /(\d+)\.\.(\d+)/g; let m;
  while ((m = re.exec(coord))) segments.push([+m[1], +m[2]]);
  return { segments, strand };
}

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const alnDir = resolve(RESOURCES, folder, '_assets', 'conservation', 'aln');
  const snpFiles = readdirSync(alnDir).filter((f) => f.endsWith('.snps'));
  const nGenomes = snpFiles.length;

  // Aggregate substitutions across the panel: refPos → { ref, alts: Map(base→count) }.
  const byPos = new Map();
  for (const f of snpFiles) {
    for (const line of readFileSync(resolve(alnDir, f), 'utf8').split('\n')) {
      if (!line) continue;
      const c = line.split('\t'); const pos = +c[0], rb = c[1], qb = c[2];
      if (!ACGT.has(rb) || !ACGT.has(qb)) continue; // substitutions only
      let e = byPos.get(pos);
      if (!e) { e = { ref: rb, alts: new Map() }; byPos.set(pos, e); }
      e.alts.set(qb, (e.alts.get(qb) ?? 0) + 1);
    }
  }
  console.log(`[variants] ${byPos.size} variable positions across ${nGenomes} genomes`);

  // Enriched DB (core/) for the genome columns (coord); the org-root DB is the prokDB core without them.
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;

  const out = {};
  let totalSites = 0;
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    const { segments, strand } = parseCoord(r.coord ?? '');
    if (!uniqID || segments.length === 0) continue;
    const start = segments[0][0];
    const end = segments[segments.length - 1][1];
    const len = end - start + 1;
    const sites = [];
    for (let p = start; p <= end; p++) {
      const e = byPos.get(p);
      if (!e) continue;
      // most-common alternate allele + total alt count at this position
      let alt = '', max = 0, total = 0;
      for (const [b, n] of e.alts) { total += n; if (n > max) { max = n; alt = b; } }
      const genePos = strand === '+' ? p - start + 1 : len - (p - start);
      const ref = strand === '+' ? e.ref : COMP[e.ref];
      const altB = strand === '+' ? alt : COMP[alt];
      sites.push([genePos, ref, altB, total]);
    }
    if (!sites.length) continue;
    sites.sort((a, b) => a[0] - b[0]);
    out[uniqID] = { n: nGenomes, sites };
    totalSites += sites.length;
  }

  writeFileSync(resolve(RESOURCES, folder, 'variants.json'), JSON.stringify(out) + '\n');
  console.log(`[variants] ${Object.keys(out).length} loci, ${totalSites} variant sites → ${folder}/variants.json`);
}

main();
