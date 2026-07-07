#!/usr/bin/env node
// One-time, build-time computation of per-locus sequence CONSERVATION for the General section,
// measured as natural diversity: a panel of complete E. coli genomes is aligned to the MG1655
// reference and per-gene nucleotide diversity is computed (low π = highly conserved). This is the
// `diversity` source of the conservation field (EnteroBase allele diversity is the other source).
//
// Method:
//   1. Panel — N complete RefSeq genomes of the species (NCBI `datasets`), stride-sampled across the
//      sorted accession list for diversity; cached so re-runs are stable.
//   2. Align — each genome vs the MG1655 reference with MUMmer (`nucmer` → `delta-filter -1` for a
//      1-to-1 alignment → `show-snps` for substitutions in reference coords + `show-coords` for the
//      callable intervals). Per-genome SNP/coord files are cached → resumable.
//   3. Aggregate — per reference position: callable depth (genomes whose 1-to-1 alignment covers it,
//      plus the reference itself) and the allele distribution.
//   4. Per gene — nucleotide diversity π = mean over the gene's callable sites of
//      (n/(n-1))·(1 − Σ_a f_a²), plus SNP density (variable sites / callable sites). Each gene's π is
//      ranked to a genome-wide percentile (`pct`) for the UI's low/med/high chip.
// Indels are ignored (substitutions only). Validated: rpsL/rpoB/rRNA low; fimA/fhuA/gnd/O-antigen high.
//
// Requirements (local build only): MUMmer (`nucmer`, `show-snps`, …) on PATH (brew install mummer);
// the NCBI `datasets` CLI is auto-downloaded into _assets/ if absent.
// Writes resources/<org>/conservation/diversity.json: { uniqID: { pi, snpDensity, pct } }
//
// Usage: node scripts/build-conservation.mjs <taxid> [panelSize]

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, findDb } from '../lib/org.mjs';
import { loadOrganismManifest } from '../lib/manifest.mjs';

// MUMmer/brew live outside the default non-login PATH.
process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;
// Panel + reference are per-organism (from organism.json via the manifest): speciesTaxid drives the
// NCBI `datasets` complete-genome panel query; refAssembly is the RefSeq assembly whose chromosome is
// our coordinate system (must match the DB's `chrom`). E. coli (MG1655) values are the bare-run fallback.
let TAXON = '562'; // species taxid for the complete-genome panel query
let REF_ACC = 'GCF_000005845.2'; // MG1655 = NC_000913.3 (our coordinate system)
const DEFAULT_PANEL = 60;

function ensureDatasets(cacheDir) {
  try { execFileSync('datasets', ['--version'], { stdio: 'ignore' }); return 'datasets'; } catch { /* not on PATH */ }
  const bin = resolve(cacheDir, 'datasets');
  if (existsSync(bin)) return bin;
  const os = platform() === 'darwin' ? 'mac' : 'linux-amd64';
  console.log('[var] downloading NCBI datasets CLI…');
  execFileSync('curl', ['-sL', '-o', bin, `https://ftp.ncbi.nlm.nih.gov/pub/datasets/command-line/v2/${os}/datasets`], { stdio: 'inherit' });
  execFileSync('chmod', ['+x', bin]);
  return bin;
}

// Download one assembly's genomic FASTA to <dir>/<acc>.fna (returns the path), via datasets.
function fetchGenome(datasets, acc, dir) {
  const zip = resolve(dir, `${acc}.zip`);
  execFileSync(datasets, ['download', 'genome', 'accession', acc, '--include', 'genome', '--filename', zip], { stdio: 'ignore' });
  execFileSync('unzip', ['-q', '-o', zip, '-d', resolve(dir, acc)], { stdio: 'ignore' });
  const fna = execFileSync('find', [resolve(dir, acc), '-name', '*.fna'], { encoding: 'utf8' }).trim().split('\n')[0];
  return fna;
}

// Resolve the panel of accessions (cached). Stride-sample N across the sorted complete-genome list.
function resolvePanel(datasets, cacheDir, n) {
  const file = resolve(cacheDir, 'panel.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  console.log('[var] listing complete genomes…');
  const jsonl = execFileSync(datasets, ['summary', 'genome', 'taxon', TAXON, '--assembly-level', 'complete', '--annotated', '--as-json-lines'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const accs = [...new Set(jsonl.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).accession; } catch { return null; } }).filter(Boolean))]
    .filter((a) => a !== REF_ACC)
    .sort();
  const stride = Math.max(1, Math.floor(accs.length / n));
  const panel = [];
  for (let i = 0; i < accs.length && panel.length < n; i += stride) panel.push(accs[i]);
  writeFileSync(file, panel.join('\n') + '\n');
  console.log(`[var] panel: ${panel.length} of ${accs.length} complete genomes (stride ${stride})`);
  return panel;
}

// nucmer-align one genome vs the reference and cache its SNP + coord tables (resumable).
function alignGenome(refFna, acc, dir, cacheDir) {
  const snps = resolve(cacheDir, `${acc}.snps`);
  const coords = resolve(cacheDir, `${acc}.coords`);
  if (existsSync(snps) && existsSync(coords)) return { snps, coords };
  const fna = fetchGenome(globalThis.__datasets, acc, dir);
  const pre = resolve(dir, acc);
  execFileSync('nucmer', ['--prefix', pre, refFna, fna], { stdio: 'ignore' });
  const filt = `${pre}.1delta`;
  writeFileSync(filt, execFileSync('delta-filter', ['-1', `${pre}.delta`], { encoding: 'buffer', maxBuffer: 1 << 30 }));
  writeFileSync(snps, execFileSync('show-snps', ['-ClrTH', filt], { encoding: 'buffer', maxBuffer: 1 << 30 }));
  writeFileSync(coords, execFileSync('show-coords', ['-rclTH', filt], { encoding: 'buffer', maxBuffer: 1 << 30 }));
  rmSync(resolve(dir, acc), { recursive: true, force: true });
  rmSync(resolve(dir, `${acc}.zip`), { force: true });
  rmSync(`${pre}.delta`, { force: true }); rmSync(filt, { force: true });
  return { snps, coords };
}

// Parse a GenBank location into 1-based [start,end] segments (handles complement / join).
function segments(coord) {
  const out = [];
  const re = /(\d+)\.\.(\d+)/g; let m;
  while ((m = re.exec(coord))) out.push([+m[1], +m[2]]);
  return out;
}

function main() {
  const taxid = process.argv[2] || '83333';
  const panelSize = Number(process.argv[3]) || DEFAULT_PANEL;
  const folder = orgFolder(taxid);
  const man = loadOrganismManifest(taxid);
  TAXON = man.speciesTaxid || TAXON;
  REF_ACC = man.refAssembly || REF_ACC;
  // Read the ENRICHED DB (core/), which carries the genome columns (coord, chrom_len) this needs — the
  // org-root DB is the prokDB core without them. findDb prefers core/, falls back to root.
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const GLEN = Number((rows.find((r) => r.chrom_len) || {}).chrom_len) || 4641652;

  const work = resolve(RESOURCES, folder, '_assets', 'conservation');
  const cache = resolve(work, 'aln');
  mkdirSync(cache, { recursive: true });
  globalThis.__datasets = ensureDatasets(work);

  // Reference FASTA for nucmer.
  const refFna = resolve(work, 'ref.fna');
  if (!existsSync(refFna)) writeFileSync(refFna, readFileSync(fetchGenome(globalThis.__datasets, REF_ACC, work)));

  const panel = resolvePanel(globalThis.__datasets, work, panelSize);

  // Align every panel genome (resumable), then aggregate.
  let done = 0;
  for (const acc of panel) {
    alignGenome(refFna, acc, work, cache);
    if (++done % 5 === 0) console.log(`  aligned ${done}/${panel.length}`);
  }

  // callable[p] = panel genomes whose 1-to-1 alignment covers reference position p.
  const callable = new Uint16Array(GLEN + 1);
  const alt = new Map(); // p → Map(base → count)
  const ACGT = new Set(['A', 'C', 'G', 'T']);
  for (const acc of panel) {
    for (const line of readFileSync(resolve(cache, `${acc}.coords`), 'utf8').split('\n')) {
      if (!line) continue;
      const c = line.split('\t'); const s = +c[0], e = +c[1];
      for (let p = s; p <= e && p <= GLEN; p++) callable[p]++;
    }
    for (const line of readFileSync(resolve(cache, `${acc}.snps`), 'utf8').split('\n')) {
      if (!line) continue;
      const c = line.split('\t'); const pos = +c[0], rb = c[1], qb = c[2];
      if (!ACGT.has(rb) || !ACGT.has(qb)) continue; // substitutions only
      let m = alt.get(pos); if (!m) { m = new Map(); alt.set(pos, m); }
      m.set(qb, (m.get(qb) || 0) + 1);
    }
  }

  // Per-site π (include the reference as one sample: n = callable + 1).
  const siteStats = (p) => {
    const cov = callable[p]; const n = cov + 1; if (n < 2) return null;
    const m = alt.get(p); let nalt = 0; const counts = [];
    if (m) for (const v of m.values()) { nalt += v; counts.push(v); }
    counts.push(cov - nalt + 1); // reference allele
    let sumsq = 0; for (const c of counts) sumsq += (c / n) * (c / n);
    return { pi: (n / (n - 1)) * (1 - sumsq), variable: nalt > 0 };
  };

  const out = {};
  const pis = [];
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    const segs = segments(r.coord ?? '');
    if (!uniqID || segs.length === 0) continue;
    let piSum = 0, callSites = 0, varSites = 0;
    for (const [s, e] of segs) for (let p = s; p <= e && p <= GLEN; p++) {
      const ss = siteStats(p); if (!ss) continue;
      callSites++; piSum += ss.pi; if (ss.variable) varSites++;
    }
    if (callSites < 1) continue;
    const pi = piSum / callSites;
    out[uniqID] = { pi: Math.round(pi * 1e5) / 1e5, snpDensity: Math.round((varSites / callSites) * 1e4) / 1e4, callable: callSites };
    pis.push([uniqID, pi]);
  }

  // Genome-wide π percentile per gene → low/med/high chip.
  pis.sort((a, b) => a[1] - b[1]);
  pis.forEach(([u], i) => { out[u].pct = Math.round(((i + 0.5) / pis.length) * 100); });

  const outDir = resolve(RESOURCES, folder, 'conservation'); mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'diversity.json'), JSON.stringify(out, null, 2) + '\n');
  const med = pis[pis.length >> 1]?.[1] ?? 0;
  console.log(`[cons] ${Object.keys(out).length} loci → ${folder}/conservation/diversity.json (panel ${panel.length}, median π ${med.toFixed(4)})`);
}

main();
