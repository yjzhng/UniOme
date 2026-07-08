// Desktop dev loop with hot reload — no rebuild while editing. Runs three processes:
//   1. API   — `tsx watch` (auto-restarts on backend changes), serves /api on API_PORT,
//              reads the in-tree resources/ (UNIOME_RESOURCES unset → repo data, no download).
//   2. Web   — Vite dev server (HMR) on WEB_PORT, proxies /api to the API.
//   3. Electron — window loads the Vite URL (via VITE_DEV_URL); main.cjs skips the embedded
//              server + first-run download in this mode.
//
// Edit apps/web/src → instant HMR. Edit apps/api/src → tsx restarts the API. Only cutting a
// .dmg needs `npm run build` / `npm run dist`.
//
//   npm run dev -w @uniome/desktop        (or: npm run dev:desktop)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const repo = resolve(desktop, '../..');
const bin = (n) => resolve(repo, 'node_modules/.bin', n);

// macOS: the dock/menu name + icon of an unpackaged Electron run come from the stock Electron.app's
// bundle (CFBundleName "Electron"), which app.setName() can't override. Make a branded clone once —
// CFBundleName=UniOme + our icon + a UNIQUE bundle id — and launch that instead. APFS copy-on-write
// makes the clone cheap; it's cached under build/ (gitignored), keyed by Electron version + brand rev.
// Any failure → fall back to stock.
//
// The unique CFBundleIdentifier is essential for coexisting with a sibling Electron dev app (e.g.
// autumnLab): the stock clone keeps Electron's default `com.github.Electron`, so two such apps collide
// in macOS Launch Services and one window can end up hosting/loading the other's session. A distinct id
// per app keeps them isolated.
const BRAND_ID = 'tech.yjzhng.uniome';
const BRAND_REV = '1'; // bump to force a re-brand when this logic changes
function brandedElectronBin() {
  if (process.platform !== 'darwin' || process.env.UNIOME_NO_BRAND === '1') return null;
  try {
    const stock = resolve(repo, 'node_modules/electron/dist/Electron.app');
    if (!existsSync(stock)) return null;
    const ver = JSON.parse(readFileSync(resolve(repo, 'node_modules/electron/package.json'), 'utf8')).version;
    const branded = resolve(desktop, 'build/UniOme.app');
    const marker = resolve(desktop, 'build/.electron-brand');
    const want = `${ver}:${BRAND_REV}`;
    const cur = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
    if (cur !== want || !existsSync(branded)) {
      console.log('[dev] branding Electron → UniOme (one-time)…');
      mkdirSync(resolve(desktop, 'build'), { recursive: true });
      rmSync(branded, { recursive: true, force: true });
      execFileSync('cp', ['-Rc', stock, branded]);                                    // APFS clone
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName UniOme',
        '-c', 'Set :CFBundleDisplayName UniOme', '-c', `Set :CFBundleIdentifier ${BRAND_ID}`,
        resolve(branded, 'Contents/Info.plist')]);
      const icns = resolve(desktop, 'build-resources/icon.icns');
      if (existsSync(icns)) copyFileSync(icns, resolve(branded, 'Contents/Resources/electron.icns'));
      execFileSync('codesign', ['--force', '--sign', '-', branded], { stdio: 'ignore' }); // ad-hoc re-sign
      writeFileSync(marker, want);
    }
    execFileSync('codesign', ['--verify', branded], { stdio: 'ignore' });             // sanity check
    const exe = resolve(branded, 'Contents/MacOS/Electron');
    return existsSync(exe) ? exe : null;
  } catch (e) {
    console.warn('[dev] Electron branding failed, using stock:', e.message);
    return null;
  }
}

// First free 127.0.0.1 port at/after `start` (the interface the API binds, per index.ts), so a stray
// process on 4000 — or a separate UniOme session — doesn't collide. Used for the API port only; Vite
// self-selects its web port (see startVite), so we never pre-probe a port a sibling then grabs.
function freePort(start) {
  return new Promise((res) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', () => res(freePort(start + 1)));
    srv.listen(start, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}

const API_PORT = String(process.env.API_PORT || (await freePort(4000)));
const WEB_BASE = process.env.WEB_PORT || '5173'; // Vite's START port; it auto-increments past conflicts
const apiTarget = `http://127.0.0.1:${API_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function run(cmd, args, env, cwd) {
  // detached so each gets its own process group — lets us kill the whole tree (tsx/vite spawn
  // their own children) on shutdown instead of leaving orphans.
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', detached: true, env: { ...process.env, ...env } });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* already gone */ } }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Wait until the URL serves OUR app — not just "something answers". Belt-and-suspenders against ever
// pointing Electron at a sibling app's dev server (which could win the port on a fast restart): the
// page must contain the UniOme title (apps/web/index.html). If another app answers there, refuse to
// launch rather than host the wrong session.
async function waitForUniOme(url, tries = 160, delay = 300) {
  for (let i = 0; i < tries; i++) {
    try {
      const text = await (await fetch(url)).text();
      if (text.includes('UniOme')) return;
      console.error(`[dev] ${url} answered but is not UniOme (port conflict with another app?) — refusing to launch`);
      shutdown(1);
    } catch { /* not up yet */ }
    await sleep(delay);
  }
  console.error(`[dev] ${url} did not come up`);
  shutdown(1);
}

// Start Vite, tee its output, and resolve the ACTUAL URL it bound. We let Vite pick the port (start at
// WEB_BASE, host 127.0.0.1, strictPort OFF) so a busy port auto-increments instead of failing the
// launch — and we point Electron at whatever Vite actually chose. This removes the fragile pre-probe /
// localhost-vs-127.0.0.1 mismatch that could load a sibling app's server. We pass --port on the CLI and
// clear WEB_PORT from the env so vite.config's strictPort stays off (auto-increment).
function startVite() {
  return new Promise((resolveUrl, reject) => {
    const env = { ...process.env, VITE_API_TARGET: apiTarget };
    delete env.WEB_PORT;
    const child = spawn(bin('vite'), ['--host', '127.0.0.1', '--port', WEB_BASE], {
      cwd: resolve(repo, 'apps/web'), detached: true, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let done = false;
    const scan = (buf) => {
      const s = buf.toString();
      process.stdout.write(s); // tee Vite's logs through
      const m = s.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m && !done) { done = true; resolveUrl(`http://127.0.0.1:${m[1]}`); }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('exit', (code) => { if (!done) reject(new Error(`Vite exited (code ${code}) before serving`)); });
  });
}

console.log(`[dev] API → ${apiTarget}  ·  starting Vite + Electron…`);

// 1. API (standalone, /api only — UNIOME_EMBED unset so it auto-listens).
run(bin('tsx'), ['watch', 'apps/api/src/index.ts'], { PORT: API_PORT, UNIOME_EMBED: '' }, repo);

// 2. Web — Vite picks its port and tells us the real URL.
let webUrl;
try { webUrl = await startVite(); } catch (e) { console.error('[dev]', e.message); shutdown(1); }

// 3. Electron — only after our server is actually serving UniOme.
await waitForUniOme(webUrl);
const electronEnv = { ...process.env, VITE_DEV_URL: webUrl };
delete electronEnv.ELECTRON_RUN_AS_NODE; // some shells set this; it makes `electron .` run as plain node
// Defense-in-depth: an interrupted first install leaves node_modules/electron/ without its downloaded
// binary. launch.sh reinstalls in that case, but if dev.mjs is reached anyway, fail loudly (not a
// silent spawn error → an app that never opens).
if (!existsSync(resolve(repo, 'node_modules/electron/dist/Electron.app'))) {
  console.error('[dev] Electron is not installed (node_modules/electron/dist missing) — the first-run install was likely interrupted. Relaunch UniOme.app to reinstall, or run `npm install`.');
  shutdown(1);
}
const electronBin = brandedElectronBin() || bin('electron');
const electron = spawn(electronBin, ['.'], { cwd: desktop, stdio: 'inherit', detached: true, env: electronEnv });
children.push(electron);
electron.on('exit', (code) => shutdown(code ?? 0)); // quitting the app ends the dev session
