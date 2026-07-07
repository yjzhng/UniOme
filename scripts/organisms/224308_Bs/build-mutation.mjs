#!/usr/bin/env node
// One-time, build-time computation of per-locus MUTATION FREQUENCY for the General section — the
// intrinsic, experimentally-measured mutation rate (not natural diversity, which is the conservation
// field). Local-first. Mirrors scripts/organisms/83333_Ec/build-mutation.mjs.
//
// Source: mutation-accumulation + whole-genome-sequencing of mismatch-repair (MMR) defective
//   Bacillus subtilis lines. Tanneur et al. 2025, "The mutational landscape of Bacillus subtilis
//   conditional hypermutators…" (Nucleic Acids Research 53:gkaf147) consolidates, in its
//   Supplementary Table S4.1, every base-pair substitution from MA-line/WGS B. subtilis studies
//   (this work + Sung et al. 2015 + Schroder et al. 2016), each with its position on the strain-168
//   reference (GenBank AL009126.3 == NC_000964.3, the assembly our DB is built on).
//
//   With MMR removed, replication errors accumulate ~neutrally across the chromosome, mapping the
//   intrinsic base-substitution landscape (the chromosomal "wave" + local hotspots) — exactly as the
//   E. coli builder uses the Foster 2018 MMR-defective lines. We therefore keep only the MMR-deficient
//   genotypes (the table's WT lines carry almost no events; its polC proofreading mutants impose a
//   different, engineered bias) and drop intervals the authors flagged `isrejected`.
//
// Per gene: count substitution events landing in the gene (recurrences across MA lines kept — a
// position hit in N lines is N events = genuine hotspot signal), rate = events per kb, min-max
// normalised to [0,1] (`rate`), and ranked to a genome-wide percentile (`pct`) for the UI chip.
//
// CAVEAT (surfaced in the UI): the MMR-defective spectrum is the intrinsic *replication-error*
// landscape — biased toward the errors MMR normally repairs — not the wild-type realized rate.
//
// Writes resources/<org>/mutation/mmr.json: { uniqID: { events, ratePerKb, rate (0–1), pct } }
//
// Usage: node scripts/organisms/224308_Bs/build-mutation.mjs [taxid]

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import Papa from 'papaparse';
import XLSX from 'xlsx';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

// Tanneur et al. 2025 (NAR gkaf147) supplementary bundle, served un-gated by the Europe PMC mirror
// (the NCBI PMC "bin" path is behind a JS proof-of-work download gate). The outer zip contains the
// nested gkaf147_supplemental_files.zip, which in turn holds Tanneur-SI_NAR_TableS4.xlsx.
const SUPP_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11890065/supplementaryFiles';
const OUTER_ZIP_MEMBER = 'gkaf147_supplemental_files.zip';
const TABLE_MEMBER = 'Tanneur-SI_NAR_TableS4.xlsx';
const SUBS_SHEET = 'Table S4.1 Substitutions in MA ';

// MMR-deficient genotypes in Table S4.1 — the intrinsic replication-error landscape (see header).
//   ΔS / ΔS3610  = mutL/mutS deletions (ΔS3610 is "MMR-3610" in the text)
//   JWS108/112/224 = MMR- strains in a PY79 background
const MMR_GENOTYPES = new Set(['ΔS', 'ΔS3610', 'JWS108', 'JWS112', 'JWS224']);

// Parse a GenBank location into 1-based [start,end] segments (handles complement / join).
function segments(coord) {
  const out = [];
  const re = /(\d+)\.\.(\d+)/g; let m;
  while ((m = re.exec(coord))) out.push([+m[1], +m[2]]);
  return out;
}

function main() {
  const taxid = process.argv[2] || '224308';
  const folder = orgFolder(taxid);
  // Read the ENRICHED DB (core/), as the API ingests it.
  const dbDir = resolve(RESOURCES, folder, 'core');
  const dbFile = readdirSync(dbDir).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(dbDir, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const GLEN = Number((rows.find((r) => r.chrom_len) || {}).chrom_len) || 4215606;

  const cacheDir = resolve(RESOURCES, folder, '_assets', 'mutation');
  mkdirSync(cacheDir, { recursive: true });
  const xlsxPath = resolve(cacheDir, 'tanneur2025_S4_bps.xlsx');
  if (!existsSync(xlsxPath)) {
    console.log('[mut] downloading Tanneur 2025 (NAR gkaf147) Table S4 via Europe PMC…');
    const outerZip = resolve(cacheDir, '_epmc_supp.zip');
    execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', '-o', outerZip, SUPP_URL], { stdio: 'inherit' });
    // Unwrap the two-level zip without leaving cruft behind: outer → nested zip → the xlsx.
    const nestedZip = resolve(cacheDir, OUTER_ZIP_MEMBER);
    execFileSync('unzip', ['-o', '-j', outerZip, OUTER_ZIP_MEMBER, '-d', cacheDir], { stdio: 'inherit' });
    execFileSync('unzip', ['-o', '-j', nestedZip, TABLE_MEMBER, '-d', cacheDir], { stdio: 'inherit' });
    execFileSync('mv', [resolve(cacheDir, TABLE_MEMBER), xlsxPath]);
    for (const f of [outerZip, nestedZip]) { try { execFileSync('rm', ['-f', f]); } catch { /* ignore */ } }
  }

  // Table S4.1: one row per substitution event, columns include genotype / isrejected / position
  // (1-based, on AL009126.3). Keep MMR-deficient genotypes, drop rejected intervals.
  const ws = XLSX.readFile(xlsxPath).Sheets[SUBS_SHEET];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const header = grid[0] ?? [];
  const gi = header.indexOf('genotype');
  const ri = header.indexOf('isrejected');
  const pi = header.indexOf('position');

  // Per-position event count over the chromosome (recurrences kept).
  const counts = new Uint16Array(GLEN + 1);
  let total = 0, kept = 0;
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]; if (!row) continue;
    if (!MMR_GENOTYPES.has(row[gi])) continue;
    const rj = row[ri];
    if (rj === 1 || rj === true || rj === 'TRUE') continue; // author-flagged rejected interval
    kept++;
    const p = Number(row[pi]);
    if (Number.isInteger(p) && p >= 1 && p <= GLEN) { counts[p]++; total++; }
  }
  console.log(`[mut] ${total} MMR- substitution events (${kept} kept rows; ${(total / (GLEN / 1000)).toFixed(1)}/kb)`);

  // Per-gene events → rate per kb.
  const out = {};
  const rates = [];
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    const segs = segments(r.coord ?? '');
    if (!uniqID || segs.length === 0) continue;
    let events = 0, len = 0;
    for (const [s, e] of segs) { len += e - s + 1; for (let p = s; p <= e && p <= GLEN; p++) events += counts[p]; }
    if (len < 1) continue;
    const ratePerKb = (events / len) * 1000;
    out[uniqID] = { events, ratePerKb: Math.round(ratePerKb * 100) / 100 };
    rates.push([uniqID, ratePerKb]);
  }

  // Normalise the per-kb rate to [0,1] (min-max across loci → 0 = no mutations, 1 = most mutable).
  const maxRate = Math.max(...rates.map(([, x]) => x), 1e-9);
  for (const [u] of rates) out[u].rate = Math.round((out[u].ratePerKb / maxRate) * 1000) / 1000;

  // Genome-wide rate percentile per gene → low/med/high chip.
  rates.sort((a, b) => a[1] - b[1]);
  rates.forEach(([u], i) => { out[u].pct = Math.round(((i + 0.5) / rates.length) * 100); });

  const outDir = resolve(RESOURCES, folder, 'mutation'); mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'mmr.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`[mut] ${Object.keys(out).length} loci → ${folder}/mutation/mmr.json`);
}

main();
