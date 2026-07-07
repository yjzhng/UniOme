#!/usr/bin/env node
// Org-specific source parsers for E. coli K-12 (taxid 83333). Each of these is pinned to a
// curated/E.-coli-only source (EcoCyc, RegulonDB, HT-CRISPRi, MODOMICS, the MG1655 genome
// panel, …) and does NOT generalize — a new organism needs analog sources, not these scripts.
// See README.md in this folder for the source list and what to swap per attribute.
//
// Invoked by scripts/build-organism.mjs (the general phase runs first), or standalone:
//   node scripts/organisms/83333_Ec/build.mjs [taxid=83333] [--only a,b] [--skip a,b] [--continue]
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const s = (f) => resolve(here, f);
const g = (f) => resolve(here, '..', '..', 'general', f); // shared, manifest-parameterized steps

// Order: regulation fetch before the maps that read it; essentiality EcoCyc before CRISPRi
// (CRISPRi is the fallback layer). conservation before variants (variants reuses its alignment
// cache). Otherwise independent.
const STEPS = [
  { name: 'fetch-regulation', cmd: s('fetch-regulation.mjs') },
  { name: 'build-regulatory-map', cmd: s('build-regulatory-map.mjs') },
  { name: 'build-regulator-index', cmd: g('build-regulator-index.mjs') }, // regulator overlap-network metadata
  { name: 'build-genome-features', cmd: s('build-genome-features.mjs') },
  { name: 'build-essentiality', cmd: s('build-essentiality.mjs') },
  { name: 'build-essentiality-crispri', cmd: s('build-essentiality-crispri.mjs') },
  { name: 'build-conservation', cmd: g('build-conservation.mjs') },
  { name: 'build-variants', cmd: g('build-variants.mjs') },
  { name: 'build-mutation', cmd: s('build-mutation.mjs') },
  { name: 'build-expression', cmd: s('build-expression.mjs') },
  { name: 'build-rna-modifications', cmd: g('build-rna-modifications.mjs') },
];

function main() {
  const args = process.argv.slice(2);
  const taxid = args.find((a) => !a.startsWith('--')) || '83333';
  const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] || '').split(',') : null;
  const skip = args.includes('--skip') ? (args[args.indexOf('--skip') + 1] || '').split(',') : null;
  const keepGoing = args.includes('--continue');

  let steps = STEPS;
  if (only) steps = steps.filter((x) => only.includes(x.name));
  if (skip) steps = steps.filter((x) => !skip.includes(x.name));

  console.log(`[83333_Ec] ${steps.length} org-specific step(s) for taxid ${taxid}`);
  for (const st of steps) {
    console.log(`\n[83333_Ec] ▶ ${st.name}`);
    const r = spawnSync('node', [st.cmd, taxid], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`[83333_Ec] ✗ ${st.name} exited ${r.status}`);
      if (!keepGoing) process.exit(r.status || 1);
    }
  }
}

main();
