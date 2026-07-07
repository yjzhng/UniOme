#!/usr/bin/env node
// Build a within-genome SEQUENCE-similarity index via all-vs-all BLAST (local, no network).
// Writes a FASTA of every CDS protein (keyed by uniqID), makes a BLAST db, runs blastp all-vs-all,
// and stores per-protein hits → proteins/seq_similar.json
//   { uniqID: [ { uniqID, gene, identity, coverage } ] }  (self excluded, top N by identity)
// Requires `makeblastdb` + `blastp` on PATH.
//
// Usage: node scripts/build-seq-similarity.mjs <taxid>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, findDb } from '../lib/org.mjs';

const EVALUE = '1e-5';
const MAX_TARGETS = 50;
const MIN_IDENTITY = 25; // % — drop weak hits
const TOP_N = 25;

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  // Read the ENRICHED DB (core/), which carries prot_seq — not the bare prokDB core at the org root.
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const geneOf = new Map();
  const fasta = [];
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    const seq = (r.prot_seq ?? '').trim();
    if (!uniqID || !seq) continue;
    geneOf.set(uniqID, (r.gene ?? '').trim() || uniqID);
    fasta.push(`>${uniqID}\n${seq}`);
  }
  console.log(`[seq-sim] ${fasta.length} proteins`);

  const work = resolve(RESOURCES, folder, '_assets', 'blast'); mkdirSync(work, { recursive: true });
  const faPath = resolve(work, 'proteins.fasta');
  writeFileSync(faPath, fasta.join('\n') + '\n');
  execFileSync('makeblastdb', ['-in', faPath, '-dbtype', 'prot', '-out', resolve(work, 'db')], { stdio: 'ignore' });
  // all-vs-all; columns: query, subject, %identity, alignment length, query length
  const outPath = resolve(work, 'all.tsv');
  execFileSync('blastp', [
    '-query', faPath, '-db', resolve(work, 'db'),
    '-evalue', EVALUE, '-max_target_seqs', String(MAX_TARGETS), '-num_threads', '4',
    '-outfmt', '6 qseqid sseqid pident length qlen', '-out', outPath,
  ], { stdio: 'ignore' });

  const hits = new Map(); // qid → Map(sid → {identity, coverage})
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line) continue;
    const [q, s, pid, len, qlen] = line.split('\t');
    if (q === s) continue;
    const identity = parseFloat(pid);
    if (!(identity >= MIN_IDENTITY)) continue;
    const coverage = Math.min(100, Math.round((parseInt(len, 10) / parseInt(qlen, 10)) * 100));
    const m = hits.get(q) ?? hits.set(q, new Map()).get(q);
    const prev = m.get(s);
    if (!prev || identity > prev.identity) m.set(s, { identity: Math.round(identity * 10) / 10, coverage });
  }

  const out = {};
  for (const [q, m] of hits) {
    // Dedupe by gene (some genes have multiple feature rows) — keep the best hit per gene.
    const byGene = new Map();
    for (const [sid, v] of m) {
      const gene = geneOf.get(sid) ?? sid;
      const prev = byGene.get(gene);
      if (!prev || v.identity > prev.identity) byGene.set(gene, { uniqID: sid, gene, identity: v.identity, coverage: v.coverage });
    }
    out[q] = [...byGene.values()].sort((a, b) => b.identity - a.identity).slice(0, TOP_N);
  }
  writeFileSync(resolve(RESOURCES, folder, 'proteins', 'seq_similar.json'), JSON.stringify(out) + '\n');
  console.log(`[seq-sim] ${Object.keys(out).length} proteins with within-genome hits → ${folder}/proteins/seq_similar.json`);
}

main();
