#!/usr/bin/env node
// Builds the NON-GENE genome annotation that the upstream <org>_DB.csv (genes only) omits, so that
// DB.csv + this table = the complete chromosomal annotation. Two sources:
//   • RegulonDB (getGeneticElementsFromInterval) — promoters, terminators, TF binding sites,
//     translational TF binding sites (positional regulatory elements, with strand + label).
//   • RefSeq feature table (NC_000913.3) — mobile_element, rep_origin (oriC), misc_feature.
// Each feature's DNA sequence is extracted from the reference genome (reverse-complemented on the
// minus strand). Output mirrors DB.csv for pipeline transferability:
//   resources/<org>/genome/<org>_genome.csv   — same columns as <org>_DB.csv
//   resources/<org>/genome/<org>_genome.fasta — one record per feature
//
// Usage: node scripts/build-genome-features.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import https from 'node:https';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

const GQL = 'https://regulondb.ccg.unam.mx/graphql'; // incomplete TLS chain → rejectUnauthorized:false
const EFETCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
const CHUNK = 250_000; // genome interval per RegulonDB query (stays well under any result cap)
const REGULATORY = new Set(['promoter', 'terminator', 'tf_binding_site', 'translational_tf_binding_site']);
// type → uniqID prefix.
const PREFIX = { promoter: 'PRM', terminator: 'TRM', tf_binding_site: 'TFB', translational_tf_binding_site: 'TTF', mobile_element: 'MOB', rep_origin: 'ORI', misc_feature: 'MSC' };
const COLS = ['uniqID', 'source', 'species', 'strain', 'org', 'chrom', 'chrom_topo', 'chrom_len', 'GeneID', 'locus_tag', 'rna_id', 'protein_id', 'UniProtID', 'type', 'gene', 'product', 'KG_FG', 'KG_FM', 'KG_PC', 'KG_PG', 'KG_PW', 'UP_FM', 'UP_PW', 'UP_KW', 'coord', 'len', 'seq', 'rna_len', 'rna_seq', 'prot_len', 'prot_seq'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- reference genome -----------------------------------------------------------------------
const COMP = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
const revcomp = (s) => s.split('').reverse().map((c) => COMP[c] ?? 'N').join('');
function loadGenome(folder, accession) {
  const path = resolve(RESOURCES, folder, '_assets', 'conservation', 'ref.fna');
  if (!existsSync(path)) throw new Error(`reference genome not found at ${path}`);
  const text = readFileSync(path, 'utf8');
  const seq = text.slice(text.indexOf('\n') + 1).replace(/\s+/g, '').toUpperCase();
  return seq;
}
// 1-based inclusive subsequence on the given strand.
function subseq(genome, lo, hi, reverse) {
  const s = genome.slice(lo - 1, hi);
  return reverse ? revcomp(s) : s;
}

// --- RegulonDB GraphQL ----------------------------------------------------------------------
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

// All regulatory genetic elements across the genome (chunked), deduped by RegulonDB _id.
async function fetchRegulondb(genomeLen) {
  const byId = new Map();
  for (let lo = 1; lo <= genomeLen; lo += CHUNK) {
    const hi = Math.min(genomeLen, lo + CHUNK - 1);
    const d = await gql(`{ getGeneticElementsFromInterval(leftEndPosition:${lo}, rightEndPosition:${hi}){ _id objectType leftEndPosition rightEndPosition strand labelName } }`);
    const els = d?.getGeneticElementsFromInterval ?? [];
    for (const e of els) {
      if (!REGULATORY.has(e.objectType)) continue;
      const l = Number(e.leftEndPosition), r = Number(e.rightEndPosition);
      if (!Number.isFinite(l) || !Number.isFinite(r) || l < 1 || r < 1) continue;
      byId.set(e._id, { type: e.objectType, lo: Math.min(l, r), hi: Math.max(l, r), reverse: e.strand === 'reverse', name: (e.labelName ?? '').trim() });
    }
    process.stdout.write(`\r[genome] RegulonDB ${Math.min(hi, genomeLen).toLocaleString()}/${genomeLen.toLocaleString()} bp · ${byId.size} elements`);
  }
  process.stdout.write('\n');
  return [...byId.values()];
}

// --- RefSeq feature table -------------------------------------------------------------------
function fetchText(url) {
  return new Promise((res, rej) => {
    https.get(url, (r) => { let c = ''; r.on('data', (d) => (c += d)); r.on('end', () => res(c)); }).on('error', rej);
  });
}
// Parse the 5-column NCBI feature table, keeping the non-gene keys DB.csv omits.
function parseFeatureTable(text, keep) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (/^[<>]?\d+$/.test(f[0]) && /^[<>]?\d+$/.test(f[1] ?? '')) {
      const a = Number(f[0].replace(/[<>]/g, '')), b = Number(f[1].replace(/[<>]/g, ''));
      if (f[2]) { // new feature
        cur = { key: f[2], lo: Math.min(a, b), hi: Math.max(a, b), reverse: a > b, quals: {} };
        if (keep.has(cur.key)) out.push(cur);
      } else if (cur) { // continuation interval → widen span
        cur.lo = Math.min(cur.lo, a, b); cur.hi = Math.max(cur.hi, a, b);
      }
    } else if (cur && f[3]) {
      cur.quals[f[3]] = f[4] ?? '';
    }
  }
  return out;
}
function refseqName(feat) {
  if (feat.key === 'mobile_element') return (feat.quals.mobile_element_type ?? 'mobile element').replace(/^insertion sequence:?/i, '').trim() || 'IS';
  if (feat.key === 'rep_origin') return feat.quals.note ?? feat.quals.standard_name ?? 'oriC';
  return feat.quals.note ?? '';
}

function meta(folder) {
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const r = rows.find((x) => (x.chrom ?? '').trim()) ?? rows[0];
  return { species: r.species, strain: r.strain, org: r.org, chrom: r.chrom, chrom_topo: r.chrom_topo, chrom_len: r.chrom_len };
}

const DESC = {
  promoter: 'promoter', terminator: 'transcription terminator', tf_binding_site: 'transcription factor binding site',
  translational_tf_binding_site: 'translational regulator binding site', mobile_element: 'mobile element', rep_origin: 'origin of replication', misc_feature: 'misc feature',
};

async function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const m = meta(folder);
  const genome = loadGenome(folder, m.chrom);
  console.log(`[genome] ${folder}: chromosome ${m.chrom}, ${genome.length.toLocaleString()} bp`);

  // 1) RegulonDB regulatory elements.
  const reg = (await fetchRegulondb(genome.length)).map((e) => ({ ...e, source: 'RegulonDB' }));

  // 2) RefSeq non-gene features.
  console.log('[genome] RefSeq feature table…');
  const ftText = await fetchText(`${EFETCH}?db=nuccore&id=${encodeURIComponent(m.chrom)}&rettype=ft&retmode=text`);
  const refseq = parseFeatureTable(ftText, new Set(['mobile_element', 'rep_origin', 'misc_feature'])).map((f) => ({
    type: f.key, lo: f.lo, hi: f.hi, reverse: f.reverse, name: refseqName(f), source: 'RefSeq',
  }));
  console.log(`[genome] RefSeq: ${refseq.length} non-gene features`);

  // 3) assemble rows (DB.csv schema), sorted by type then position; extract sequence.
  const all = [...reg, ...refseq].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.lo - b.lo));
  const counter = {};
  const rows = [];
  const fasta = [];
  for (const e of all) {
    const n = (counter[e.type] = (counter[e.type] ?? 0) + 1);
    const uniqID = `${PREFIX[e.type] ?? 'GEN'}${String(n).padStart(5, '0')}`;
    const seq = subseq(genome, e.lo, e.hi, e.reverse);
    const coord = e.reverse ? `complement(${e.lo}..${e.hi})` : `${e.lo}..${e.hi}`;
    const product = e.name ? `${e.name} ${DESC[e.type] ?? e.type}` : (DESC[e.type] ?? e.type);
    rows.push({
      uniqID, source: e.source, species: m.species, strain: m.strain, org: m.org, chrom: m.chrom, chrom_topo: m.chrom_topo, chrom_len: m.chrom_len,
      GeneID: '', locus_tag: '', rna_id: '', protein_id: '', UniProtID: '', type: e.type, gene: e.name, product,
      KG_FG: '', KG_FM: '', KG_PC: '', KG_PG: '', KG_PW: '', UP_FM: '', UP_PW: '', UP_KW: '',
      coord, len: e.hi - e.lo + 1, seq, rna_len: '', rna_seq: '', prot_len: '', prot_seq: '',
    });
    fasta.push(`>${uniqID} ${e.type}${e.name ? ` ${e.name}` : ''} ${coord}\n${seq}`);
  }

  const outDir = resolve(RESOURCES, folder, 'genome');
  mkdirSync(outDir, { recursive: true });
  const base = resolve(outDir, `${folder}_genome`);
  writeFileSync(`${base}.csv`, Papa.unparse({ fields: COLS, data: rows.map((r) => COLS.map((c) => r[c])) }, { newline: '\n' }) + '\n');
  writeFileSync(`${base}.fasta`, fasta.join('\n') + '\n');

  const tally = {};
  for (const r of rows) tally[r.type] = (tally[r.type] ?? 0) + 1;
  console.log(`[genome] wrote ${base}.csv + .fasta — ${rows.length} features`);
  console.log('[genome] by type:', JSON.stringify(tally));
}

main().catch((e) => { console.error(e); process.exit(1); });
