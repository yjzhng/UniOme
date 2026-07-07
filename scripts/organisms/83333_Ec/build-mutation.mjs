#!/usr/bin/env node
// One-time, build-time computation of per-locus MUTATION FREQUENCY for the General section — the
// intrinsic, experimentally-measured mutation rate (not natural diversity, which is the conservation
// field). Local-first.
//
// Source: mutation-accumulation + whole-genome-sequencing of MMR (mismatch-repair) defective E. coli
//   K-12 MG1655 lines — Foster et al. 2018, "The Spectrum of Replication Errors…" (Genetics 209:1043).
//   With MMR removed, replication errors accumulate ~neutrally across the chromosome, mapping the
//   intrinsic base-substitution landscape (the chromosomal "wave" + local hotspots). The lab's BPS
//   list (all substitution events, with MG1655 positions) is deposited at IU ScholarWorks.
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
// Usage: node scripts/build-mutation.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import Papa from 'papaparse';
import XLSX from 'xlsx';
import { RESOURCES, orgFolder } from '../../lib/org.mjs';

// Foster et al. 2018 MMR-defective BPS list (IU ScholarWorks bitstream).
const XLSX_URL = 'https://scholarworks.iu.edu/dspace/bitstreams/43d8fe51-9f79-4ab7-97ef-13503ddf90e3/download';

// Parse a GenBank location into 1-based [start,end] segments (handles complement / join).
function segments(coord) {
  const out = [];
  const re = /(\d+)\.\.(\d+)/g; let m;
  while ((m = re.exec(coord))) out.push([+m[1], +m[2]]);
  return out;
}

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const GLEN = Number((rows.find((r) => r.chrom_len) || {}).chrom_len) || 4641652;

  const cacheDir = resolve(RESOURCES, folder, '_assets', 'mutation');
  mkdirSync(cacheDir, { recursive: true });
  const xlsxPath = resolve(cacheDir, 'foster2018_mmr_bps.xlsx');
  if (!existsSync(xlsxPath)) {
    console.log('[mut] downloading Foster 2018 MMR BPS list…');
    execFileSync('curl', ['-sL', '-o', xlsxPath, XLSX_URL], { stdio: 'inherit' });
  }

  // The sheet lays samples out in side-by-side blocks; every column headed "Position" holds events.
  const ws = XLSX.readFile(xlsxPath).Sheets['MMR bps'];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const header = grid[0] ?? [];
  const posCols = header.map((h, i) => (h != null && String(h).includes('Position') ? i : -1)).filter((i) => i >= 0);

  // Per-position event count over the chromosome (recurrences kept).
  const counts = new Uint16Array(GLEN + 1);
  let total = 0;
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]; if (!row) continue;
    for (const ci of posCols) {
      const p = Number(row[ci]);
      if (Number.isInteger(p) && p >= 1 && p <= GLEN) { counts[p]++; total++; }
    }
  }
  console.log(`[mut] ${total} substitution events across ${posCols.length} sample-blocks (${(total / (GLEN / 1000)).toFixed(1)}/kb)`);

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
