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
  execFileSync('tar', ['--exclude', '.DS_Store', '-czf', out, '-C', RESOURCES, org]);
  console.log(`[pack] ${org} -> _assets/${org}.tar.gz (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
}

console.log('\nPublish to the release:');
console.log('  gh release upload assets resources/_assets/*.tar.gz --clobber');
