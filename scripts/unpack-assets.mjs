#!/usr/bin/env node
// Restore organism data on a fresh clone / build (run via `npm run setup`): download
// each per-organism archive from the GitHub Release and extract it to resources/<org>/.
// Idempotent — skips organisms already present. Counterpart: pack-assets.mjs.
//
//   node scripts/unpack-assets.mjs
//   UNIOME_ASSETS_TAG=<tag> overrides the release tag (default "assets").
//
// The repo (and its data Release) is public: this uses the GitHub CLI (`gh`) when present — no auth
// needed — and otherwise falls back to a plain download of the public release assets, so `gh` is
// optional. Install gh (optional): https://cli.github.com

import { readdirSync, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const RESOURCES = resolve(ROOT, 'resources');
const ASSETS = resolve(RESOURCES, '_assets');
const TAG = process.env.UNIOME_ASSETS_TAG || 'assets';
// Public repo hosting the data Release; override to point setup at a fork.
const REPO = process.env.UNIOME_ASSETS_REPO || 'yjzhng/UniOme';

mkdirSync(ASSETS, { recursive: true });

function hasGh() {
  try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Download every org archive from the release via gh (no auth needed for a public repo).
// --skip-existing avoids re-downloading archives already staged in _assets/.
function downloadWithGh() {
  execFileSync(
    'gh',
    ['release', 'download', TAG, '--repo', REPO, '--dir', ASSETS, '--pattern', '*.tar.gz', '--skip-existing'],
    { cwd: ROOT, stdio: 'inherit' }
  );
}

// gh-free fallback: read the release's asset list from the public API, then fetch each archive
// straight from its public download URL. Skips archives already staged in _assets/.
async function downloadWithFetch() {
  const api = `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`;
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`release lookup failed (${res.status}) for ${api}`);
  const assets = (await res.json()).assets?.filter((a) => a.name.endsWith('.tar.gz')) ?? [];
  for (const a of assets) {
    const dest = resolve(ASSETS, a.name);
    if (existsSync(dest)) { console.log(`[setup] ${a.name}: already downloaded, skipping`); continue; }
    console.log(`[setup] downloading ${a.name} …`);
    const dl = await fetch(a.browser_download_url);
    if (!dl.ok || !dl.body) throw new Error(`download failed (${dl.status}) for ${a.name}`);
    await pipeline(Readable.fromWeb(dl.body), createWriteStream(dest));
  }
}

try {
  if (hasGh()) await downloadWithGh();
  else await downloadWithFetch();
} catch (err) {
  console.error(
    `[setup] release download failed — make sure the "${TAG}" release exists on ${REPO} ` +
      `(install the GitHub CLI for a faster path, or check your network). (${err.message})`
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
