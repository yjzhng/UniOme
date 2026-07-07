#!/usr/bin/env node
// Pack each organism's full resources/<org>/ folder (DB.csv + proteins/ + any future
// org-specific resources) into ONE archive for distribution via a GitHub Release:
//   resources/_assets/<org>.tar.gz
// Adding an organism = pack it + upload its archive. Counterpart: unpack-assets.mjs.
//
//   node scripts/pack-assets.mjs [<taxid>]   # all organisms, or one

import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const RESOURCES = resolve(here, '../resources');
const ASSETS = resolve(RESOURCES, '_assets');

const taxid = process.argv[2];
const orgs = readdirSync(RESOURCES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d+_/.test(e.name) && (!taxid || e.name.startsWith(`${taxid}_`)))
  .map((e) => e.name);

mkdirSync(ASSETS, { recursive: true });
for (const org of orgs) {
  const out = resolve(ASSETS, `${org}.tar.gz`);
  // Ship the runtime data (DB, proteins/, rna/, the derived index dirs, and the only runtime _assets
  // subdir, complex_chains). Everything else under _assets/ is a build-time CACHE (raw downloads +
  // intermediate tables) that the build derives its outputs from but the app never reads — exclude it
  // so the release archive stays lean. complex_chains is NOT listed below, so it ships.
  execFileSync('tar', [
    '--exclude', '.DS_Store',
    // build-cache directories
    '--exclude', '*/_assets/conservation',
    '--exclude', '*/_assets/foldseek',
    '--exclude', '*/_assets/mutation',
    '--exclude', '*/_assets/kegg',
    '--exclude', '*/_assets/blast',
    '--exclude', '*/_assets/modomics',
    '--exclude', '*/_assets/regulation',
    '--exclude', '*/_assets/rnainter',
    '--exclude', '*/_assets/_enrich_cache',
    // build-cache loose files (raw source dumps + intermediate tables)
    '--exclude', '*/_assets/crispri_supp.zip',
    '--exclude', '*/_assets/Supplementary_Table_*.xlsx',
    '--exclude', '*/_assets/minch2015_*.xlsx',
    '--exclude', '*/_assets/regprecise_*',
    '--exclude', '*/_assets/deg_*.csv',
    '--exclude', '*/_assets/aureowiki_*.tsv',
    '--exclude', '*/_assets/complextab_*.tsv',
    '--exclude', '*/_assets/ecocyc_*.json',
    '--exclude', '*/_assets/imodulon_means.json',
    '--exclude', '*/_assets/gene_info.csv',
    '--exclude', '*/_assets/trn.csv',
    '--exclude', '*/_assets/biocyc_operon_annotations.csv',
    '--exclude', '*/_assets/M.csv',
    '--exclude', '*/_assets/M_thresholds.csv',
    '--exclude', '*/_assets/iM_table.csv',
    '-czf', out, '-C', RESOURCES, org,
  ]);
  console.log(`[pack] ${org} -> _assets/${org}.tar.gz (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
}

console.log('\nPublish to the release:');
console.log('  gh release upload assets resources/_assets/*.tar.gz --clobber');
