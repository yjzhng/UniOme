// Build the desktop app's bundled inputs: the single-file CJS server and the web dist.
// Run from apps/desktop (npm scripts set cwd there). Kept as a script (not just npm chaining)
// so the order + logging is explicit and it can grow (e.g. notarization hooks) later.
import { execSync } from 'node:child_process';
import { rmSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const repo = resolve(desktop, '../..');
const run = (cmd, cwd) => { console.log(`▸ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }); };

mkdirSync(resolve(desktop, 'build'), { recursive: true });

// 1. Bundle the Fastify server (apps/api) into one CJS file — no node_modules to ship.
run(
  'npx esbuild ../api/src/index.ts --bundle --platform=node --format=cjs --target=node20 ' +
    '--packages=bundle --outfile=build/server.cjs --log-level=error',
  desktop
);

// 2. Build the web app and copy its dist into build/web (served by the embedded server).
run('npm run build -w @uniome/web', repo);
const dist = resolve(repo, 'apps/web/dist');
if (!existsSync(dist)) throw new Error('web build produced no dist/');
rmSync(resolve(desktop, 'build/web'), { recursive: true, force: true });
cpSync(dist, resolve(desktop, 'build/web'), { recursive: true });

// Ship the dock icon png too (the packaged .app's icon comes from the bundle, but main.cjs uses
// this as a dock.setIcon fallback).
const iconPng = resolve(desktop, 'build-resources/icon.png');
if (existsSync(iconPng)) cpSync(iconPng, resolve(desktop, 'build/icon.png'));

// 3. Bundle the tile registry + the org-infra configs (scripts/ isn't shipped in the packaged app),
//    so the home page knows what tiles exist and what's available to download.
cpSync(resolve(repo, 'resources/organism-catalog.json'), resolve(desktop, 'build/organism-catalog.json'));
rmSync(resolve(desktop, 'build/organisms'), { recursive: true, force: true });
for (const dir of readdirSync(resolve(repo, 'scripts/organisms'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const cfg = resolve(repo, 'scripts/organisms', dir.name, 'organism.json');
  if (existsSync(cfg)) cpSync(cfg, resolve(desktop, 'build/organisms', dir.name, 'organism.json'));
}

console.log('✓ desktop build ready: build/{server.cjs, web, organism-catalog.json, organisms/}');
