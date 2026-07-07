#!/usr/bin/env node
// Org-specific (Tier 2) source builders for B. subtilis subsp. subtilis str. 168 (taxid 224308). Run
// after the general phase (scripts/build-organism.mjs runs general first), or standalone:
//   node scripts/organisms/224308_Bs/build.mjs [taxid=224308] [--only a,b] [--skip a,b] [--continue]
//
// Everything joins on BSU loci (our RefSeq locus_tag is BSU_#####). Sources (all general/manifest-driven
// except essentiality, which is org-specific):
//   conservation → RefSeq genome-panel π recompute (MUMmer); variants from the same panel
//   rna-modifications → MODOMICS (B. subtilis has rRNA + tRNA modified sequences)
//   expression   → iModulonDB b_subtilis/modulome (transcript, BSU_-keyed) + PaxDb 224308 (protein,
//                  BSU#####-keyed → matched via the underscore-stripped alias)
//   essentiality → Tn-seq (see build-essentiality.mjs)
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
  { name: 'build-mutation', cmd: s('build-mutation.mjs') },
];

function main() {
  const args = process.argv.slice(2);
  const taxid = args.find((a) => !a.startsWith('--')) || '224308';
  const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] || '').split(',') : null;
  const skip = args.includes('--skip') ? (args[args.indexOf('--skip') + 1] || '').split(',') : null;
  const keepGoing = args.includes('--continue');

  let steps = STEPS;
  if (only) steps = steps.filter((x) => only.includes(x.name));
  if (skip) steps = steps.filter((x) => !skip.includes(x.name));

  console.log(`[224308_Bs] ${steps.length} org-specific step(s) for taxid ${taxid}`);
  for (const st of steps) {
    console.log(`\n[224308_Bs] ▶ ${st.name}`);
    const r = spawnSync('node', [st.cmd, taxid], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`[224308_Bs] ✗ ${st.name} exited ${r.status}`);
      if (!keepGoing) process.exit(r.status || 1);
    }
  }
}

main();
