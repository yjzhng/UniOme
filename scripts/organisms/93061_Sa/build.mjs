#!/usr/bin/env node
// Org-specific (Tier 2) source builders for S. aureus NCTC 8325 (taxid 93061). Run after the general
// phase (scripts/build-organism.mjs runs general first), or standalone:
//   node scripts/organisms/93061_Sa/build.mjs [taxid=93061] [--only a,b] [--skip a,b] [--continue]
//
// Everything joins on SAOUHSC_ loci (our NCTC 8325 locus_tag). Sources (general/manifest-driven except
// essentiality):
//   conservation → RefSeq genome-panel π recompute (MUMmer); variants from the same panel
//   rna-modifications → MODOMICS (S. aureus has modified rRNA)
//   expression   → PaxDb 93061 (protein, SAOUHSC_-keyed, in the `latest` release) — PROTEIN ONLY: the
//                  iModulonDB datasets (staph_precise108/165) are USA300-keyed (SAUSA300_), so transcript
//                  needs a USA300 → NCTC 8325 crosswalk (no `imodulonOrg` set → that half is skipped).
//   essentiality → Tn-seq (SAOUHSC_-keyed; see build-essentiality.mjs)
//   regulation   → RegPrecise (N315 regulons) mapped to SAOUHSC_ via the AureoWiki ortholog matrix; TF
//                  regulons + operons only (no sigma/modulon source for Sa). See build-regulation.mjs.
//
// NOT built — mutation-frequency (no MA-line dataset for S. aureus).
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const s = (f) => resolve(here, f);
const g = (f) => resolve(here, '..', '..', 'general', f); // shared, manifest-parameterized steps

// conservation before variants (variants reuses its alignment cache). Otherwise independent.
const STEPS = [
  { name: 'build-conservation', cmd: g('build-conservation.mjs') },
  { name: 'build-variants', cmd: g('build-variants.mjs') },
  { name: 'build-rna-modifications', cmd: g('build-rna-modifications.mjs') },
  { name: 'build-expression', cmd: g('build-expression.mjs') },
  { name: 'build-essentiality', cmd: s('build-essentiality.mjs') },
  { name: 'build-regulation', cmd: s('build-regulation.mjs') },
  { name: 'build-regulatory-map', cmd: s('build-regulatory-map.mjs') },
  { name: 'build-regulator-index', cmd: g('build-regulator-index.mjs') }, // regulator overlap-network metadata
];

function main() {
  const args = process.argv.slice(2);
  const taxid = args.find((a) => !a.startsWith('--')) || '93061';
  const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] || '').split(',') : null;
  const skip = args.includes('--skip') ? (args[args.indexOf('--skip') + 1] || '').split(',') : null;
  const keepGoing = args.includes('--continue');

  let steps = STEPS;
  if (only) steps = steps.filter((x) => only.includes(x.name));
  if (skip) steps = steps.filter((x) => !skip.includes(x.name));

  console.log(`[93061_Sa] ${steps.length} org-specific step(s) for taxid ${taxid}`);
  for (const st of steps) {
    console.log(`\n[93061_Sa] ▶ ${st.name}`);
    const r = spawnSync('node', [st.cmd, taxid], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`[93061_Sa] ✗ ${st.name} exited ${r.status}`);
      if (!keepGoing) process.exit(r.status || 1);
    }
  }
}

main();
