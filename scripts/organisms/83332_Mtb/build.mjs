#!/usr/bin/env node
// Org-specific source builders for M. tuberculosis H37Rv (taxid 83332). Run after the general phase
// (scripts/build-organism.mjs runs general first), or standalone:
//   node scripts/organisms/83332_Mtb/build.mjs [taxid=83332] [--only a,b] [--skip a,b] [--continue]
//
// Sources (all Rv-keyed → join directly to our H37Rv genome):
//   expression   → iModulonDB modulome (transcript) + PaxDb (protein)   [general, manifest-driven]
//   essentiality → MtbTnDB (Sassetti 2003 in-vitro essential column); see build-essentiality.mjs
//   conservation → RefSeq genome-panel π recompute (MUMmer); variants from the same panel  [general]
//   (RNA modifications skipped — MODOMICS returns empty for M. tuberculosis.)
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const s = (f) => resolve(here, f);
const g = (f) => resolve(here, '..', '..', 'general', f); // shared, manifest-parameterized steps

const STEPS = [
  { name: 'build-expression', cmd: g('build-expression.mjs') },
  { name: 'build-essentiality', cmd: s('build-essentiality.mjs') },
  { name: 'build-conservation', cmd: g('build-conservation.mjs') },
  { name: 'build-variants', cmd: g('build-variants.mjs') },
  { name: 'build-regulation', cmd: s('build-regulation.mjs') },
  { name: 'build-regulatory-map', cmd: s('build-regulatory-map.mjs') },
  { name: 'build-regulator-index', cmd: g('build-regulator-index.mjs') }, // regulator overlap-network metadata
];

function main() {
  const args = process.argv.slice(2);
  const taxid = args.find((a) => !a.startsWith('--')) || '83332';
  const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] || '').split(',') : null;
  const skip = args.includes('--skip') ? (args[args.indexOf('--skip') + 1] || '').split(',') : null;
  const keepGoing = args.includes('--continue');

  let steps = STEPS;
  if (only) steps = steps.filter((x) => only.includes(x.name));
  if (skip) steps = steps.filter((x) => !skip.includes(x.name));

  console.log(`[83332_Mtb] ${steps.length} org-specific step(s) for taxid ${taxid}`);
  for (const st of steps) {
    console.log(`\n[83332_Mtb] ▶ ${st.name}`);
    const r = spawnSync('node', [st.cmd, taxid], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`[83332_Mtb] ✗ ${st.name} exited ${r.status}`);
      if (!keepGoing) process.exit(r.status || 1);
    }
  }
}

main();
