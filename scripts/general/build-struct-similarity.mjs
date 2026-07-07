#!/usr/bin/env node
// Build a within-genome STRUCTURAL-similarity index via all-vs-all Foldseek (local, no network at
// search time). AlphaFold models ship as BinaryCIF (.bcif), which Foldseek can't read, so each is
// first converted to text mmCIF (wwPDB python `mmcif` library), then Foldseek builds a structure DB
// and runs an all-vs-all TM-align search. Per-protein hits → proteins/struct_similar.json
//   { uniqID: [ { uniqID, gene, tmscore, altPose? } ] }
//   tmscore = consolidated S = √(qTM·tTM); altPose = same parts, different arrangement (low S but
//   high coverage + LDDT). Self excluded, top N by S.
//
// Requirements (local build only): python3 with the `mmcif` package (pip install mmcif). The
// Foldseek binary is auto-downloaded into _assets/ if not on PATH. macOS / Linux.
//
// Usage: node scripts/build-struct-similarity.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { platform, arch } from 'node:os';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

// Consolidated structural-similarity score S = √(qTM·tTM) — the geometric mean of the two
// chain-length-normalised TM-scores, so a hit must superpose well AND span most of BOTH proteins.
const TM_MIN = 0.5;       // S ≥ 0.5 ⇒ same fold (a normal hit)
// "Alt pose" = same parts, different relative arrangement/conformation: global superposition is poor
// (S below TM_MIN) yet the alignment covers most of both chains and is locally accurate (high LDDT).
// These would otherwise be dropped; we keep + tag them.
const ALT_TM_FLOOR = 0.35; // don't flag genuinely-different folds
const ALT_COV_MIN = 0.7;   // min(qcov, tcov): alignment spans most of both proteins
const ALT_LDDT_MIN = 0.6;  // locally well-superposed where aligned
const SEARCH_TM = 0.35;    // Foldseek report threshold — low enough to return alt-pose candidates
const TOP_N = 25;

// Foldseek binary: prefer one on PATH, else download a static build into _assets/.
function ensureFoldseek(cacheDir) {
  try { execFileSync('foldseek', ['version'], { stdio: 'ignore' }); return 'foldseek'; } catch { /* not on PATH */ }
  const bin = resolve(cacheDir, 'foldseek', 'bin', 'foldseek');
  if (existsSync(bin)) return bin;
  const asset = platform() === 'darwin' ? 'foldseek-osx-universal.tar.gz'
    : arch() === 'arm64' ? 'foldseek-linux-arm64.tar.gz' : 'foldseek-linux-avx2.tar.gz';
  console.log(`[struct] downloading Foldseek (${asset})…`);
  const tar = resolve(cacheDir, 'foldseek.tar.gz');
  execFileSync('curl', ['-sL', '-o', tar, `https://mmseqs.com/foldseek/${asset}`], { stdio: 'inherit' });
  execFileSync('tar', ['xzf', tar, '-C', cacheDir], { stdio: 'inherit' });
  if (!existsSync(bin)) throw new Error('Foldseek extraction failed');
  return bin;
}

// Convert every <acc>.bcif to text mmCIF (resumable — skips already-converted), via a tiny python
// helper using the same wwPDB mmcif library that wrote the BinaryCIF.
function convertStructures(structDir, cifDir) {
  mkdirSync(cifDir, { recursive: true });
  const py = resolve(cifDir, '..', '_bcif2cif.py');
  writeFileSync(py, `import sys, os, glob
from mmcif.io.BinaryCifReader import BinaryCifReader
from mmcif.io.PdbxWriter import PdbxWriter
src, out = sys.argv[1], sys.argv[2]
rdr = BinaryCifReader(storeStringsAsBytes=False)
n = 0
for f in sorted(glob.glob(src + '/*.bcif')):
    acc = os.path.basename(f)[:-5]
    dst = os.path.join(out, acc + '.cif')
    if os.path.exists(dst):
        continue
    try:
        with open(dst, 'w') as fh:
            PdbxWriter(fh).write(rdr.deserialize(f))
        n += 1
        if n % 500 == 0:
            print('  converted', n, flush=True)
    except Exception as e:
        if os.path.exists(dst):
            os.remove(dst)
        print('  skip', acc, str(e)[:80], flush=True)
print('[bcif2cif] wrote', n, 'new cif (total', len(glob.glob(out + '/*.cif')), ')')
`);
  console.log('[struct] converting BinaryCIF → mmCIF (resumable)…');
  execFileSync('python3', [py, structDir, cifDir], { stdio: 'inherit' });
}

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;

  // accession → uniqID + gene (structures are named by UniProt accession).
  const uniqOfAcc = new Map();
  const geneOf = new Map();
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    const acc = (r.UniProtID ?? '').trim();
    if (uniqID) geneOf.set(uniqID, (r.gene ?? '').trim() || uniqID);
    if (acc && uniqID && !uniqOfAcc.has(acc)) uniqOfAcc.set(acc, uniqID);
  }

  const structDir = resolve(RESOURCES, folder, 'proteins', 'structures');
  const work = resolve(RESOURCES, folder, '_assets', 'foldseek');
  mkdirSync(work, { recursive: true });
  const cifDir = resolve(work, 'cif');

  const foldseek = ensureFoldseek(work);
  convertStructures(structDir, cifDir);

  // All-vs-all TM-align search (easy-search builds its own DB; max sensitivity, the DB is small).
  console.log('[struct] Foldseek all-vs-all search…');
  const aln = resolve(work, 'aln.tsv');
  const tmp = resolve(work, 'tmp');
  execFileSync(foldseek, [
    'easy-search', cifDir, cifDir, aln, tmp,
    '--alignment-type', '1',            // TM-align
    '--tmscore-threshold', String(SEARCH_TM),
    '-s', '9.5',                        // max sensitivity
    '--max-seqs', '2000',
    // qtmscore/ttmscore = TM normalised by query/target length (coverage baked in); qcov/tcov = the
    // covered fraction of each chain; lddt = local superposition quality.
    '--format-output', 'query,target,qtmscore,ttmscore,qcov,tcov,lddt',
    '-v', '1',
  ], { stdio: 'inherit' });

  // Parse: per query→target, the best consolidated score S = √(qTM·tTM); keep same-fold hits (S ≥
  // TM_MIN) and "alt pose" hits (S below it but high coverage + LDDT). map to uniqID, top N.
  const byQuery = new Map(); // qUniq → Map(tUniq → { s, alt })
  for (const line of readFileSync(aln, 'utf8').split('\n')) {
    if (!line) continue;
    const [qAcc, tAcc, qtmStr, ttmStr, qcovStr, tcovStr, lddtStr] = line.split('\t');
    if (qAcc === tAcc) continue;
    const q = uniqOfAcc.get(qAcc), t = uniqOfAcc.get(tAcc);
    if (!q || !t || q === t) continue;
    const qtm = Number(qtmStr), ttm = Number(ttmStr);
    const s = Math.sqrt(Math.max(0, qtm) * Math.max(0, ttm));
    const cov = Math.min(Number(qcovStr), Number(tcovStr)), lddt = Number(lddtStr);
    const normal = s >= TM_MIN;
    const alt = !normal && s >= ALT_TM_FLOOR && cov >= ALT_COV_MIN && lddt >= ALT_LDDT_MIN;
    if (!normal && !alt) continue;
    let m = byQuery.get(q);
    if (!m) { m = new Map(); byQuery.set(q, m); }
    const prev = m.get(t);
    if (!prev || s > prev.s) m.set(t, { s, alt: !normal });
  }

  const out = {};
  for (const [q, m] of byQuery) {
    out[q] = [...m.entries()]
      .sort((a, b) => b[1].s - a[1].s)
      .slice(0, TOP_N)
      .map(([t, { s, alt }]) => ({ uniqID: t, gene: geneOf.get(t) ?? t, tmscore: Math.round(s * 1000) / 1000, ...(alt ? { altPose: true } : {}) }));
  }

  const outFile = resolve(RESOURCES, folder, 'proteins', 'struct_similar.json');
  writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`[struct] ${Object.keys(out).length} proteins with structural neighbours → ${folder}/proteins/struct_similar.json`);

  // Drop the bulky converted mmCIF (1.6 GB); keep the Foldseek DB + alignment for re-runs.
  rmSync(cifDir, { recursive: true, force: true });
}

main();
