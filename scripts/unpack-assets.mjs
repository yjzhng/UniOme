#!/usr/bin/env node
// Restore organism data on a fresh clone / build (run via `npm run setup`): download
// each per-organism archive from the GitHub Release and extract it to resources/<org>/.
// Idempotent — skips organisms already present. Counterpart: pack-assets.mjs.
//
//   node scripts/unpack-assets.mjs
//   UNIOME_ASSETS_TAG=<tag> overrides the release tag (default "assets").
//
// Requires the GitHub CLI (`gh`), authed (the repo is private). Install: https://cli.github.com

import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const RESOURCES = resolve(ROOT, 'resources');
const ASSETS = resolve(RESOURCES, '_assets');
const TAG = process.env.UNIOME_ASSETS_TAG || 'assets';

mkdirSync(ASSETS, { recursive: true });

// Download every org archive from the release (gh handles private-repo auth).
// --skip-existing avoids re-downloading archives already staged in _assets/.
try {
  execFileSync(
    'gh',
    ['release', 'download', TAG, '--dir', ASSETS, '--pattern', '*.tar.gz', '--skip-existing'],
    { cwd: ROOT, stdio: 'inherit' }
  );
} catch (err) {
  console.error(
    `[setup] gh release download failed — install the GitHub CLI and run \`gh auth login\`, ` +
      `and make sure the "${TAG}" release exists. (${err.message})`
  );
  process.exit(1);
}

// Extract each archive into resources/, skipping organisms already unpacked.
const archives = readdirSync(ASSETS).filter((f) => f.endsWith('.tar.gz'));
if (archives.length === 0) {
  console.warn(`[setup] no archives found on release "${TAG}" — nothing to extract.`);
}
for (const a of archives) {
  const org = a.replace(/\.tar\.gz$/, '');
  if (existsSync(resolve(RESOURCES, org))) {
    console.log(`[setup] ${org}: already present, skipping`);
    continue;
  }
  execFileSync('tar', ['-xzf', resolve(ASSETS, a), '-C', RESOURCES]);
  console.log(`[setup] ${org}: extracted`);
}
