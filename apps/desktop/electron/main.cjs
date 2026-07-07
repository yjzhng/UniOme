// UniOme desktop shell. Boots the embedded Fastify server (which serves BOTH the web UI and the
// /api routes on one localhost origin) and points a BrowserWindow at it. The ~GB of organism data
// lives in the user-data dir (not inside the read-only app bundle); it is NOT downloaded at startup
// — the app opens immediately and each organism is downloaded on demand from its home-page tile.
const { app, BrowserWindow, dialog, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Stable name so the user-data dir is "UniOme" in dev too (not the scoped package name).
app.setName('UniOme');

// Dock icon for the from-source run (it's the stock Electron binary, so its bundle icon would show
// otherwise). The packaged .app gets its icon from the bundle (electron-builder mac.icon).
function setDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  for (const png of [
    path.join(__dirname, '..', 'build-resources', 'icon.png'), // from source
    path.join(__dirname, '..', 'build', 'icon.png'),           // bundled (if shipped)
  ]) {
    if (fs.existsSync(png)) { try { app.dock.setIcon(nativeImage.createFromPath(png)); } catch { /* ignore */ } return; }
  }
}

const isDev = !app.isPackaged;

// Dev mode: when the dev orchestrator (scripts/dev.mjs) sets VITE_DEV_URL, the window loads the
// Vite dev server (HMR) instead of the bundled SPA, and the API runs as a separate `tsx watch`
// process (Vite proxies /api to it). No embedded server, no first-run download — edits to the
// frontend hot-reload and backend changes auto-restart, with no desktop rebuild.
const devUrl = process.env.VITE_DEV_URL || null;

// Writable data dir. The server reads it via UNIOME_RESOURCES; must be set BEFORE the server
// bundle is required (its loaders capture the path at load time).
const RESOURCES_DIR = path.join(app.getPath('userData'), 'resources');
process.env.UNIOME_RESOURCES = RESOURCES_DIR;
process.env.UNIOME_EMBED = '1'; // tell the server bundle not to auto-listen; we call start() ourselves
// Bundled tile registry + org-infra configs (scripts/ isn't shipped). build.mjs copies them into build/.
if (!process.env.UNIOME_CATALOG) {
  const bundled = path.join(__dirname, '..', 'build', 'organism-catalog.json');
  if (fs.existsSync(bundled)) process.env.UNIOME_CATALOG = bundled;
}
if (!process.env.UNIOME_ORG_INFRA) {
  const infra = path.join(__dirname, '..', 'build', 'organisms');
  if (fs.existsSync(infra)) process.env.UNIOME_ORG_INFRA = infra;
}

// Bundled inputs. server.cjs sits next to this file (inside the asar — require() reads it fine);
// the web dist is shipped unpacked as an extraResource so @fastify/static can serve real files.
const serverPath = path.join(__dirname, '..', 'build', 'server.cjs');
const webDir = isDev
  ? path.join(__dirname, '..', 'build', 'web')
  : path.join(process.resourcesPath, 'web');

let mainWindow = null;
let serverUrl = null;

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'UniOme',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true },
  });
  mainWindow.loadURL(url);
  // Never let a link spawn a second app window (that's how "return to organisms" was duplicating
  // UniOme). Deny all window.open/target=_blank; route genuinely-external URLs to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const u = new URL(target);
      const appOrigin = serverUrl ? new URL(serverUrl).origin : null;
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin !== appOrigin) {
        shell.openExternal(target); // e.g. a data-source homepage from the /legal page
      }
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Poll a URL until it answers (used to wait for the Vite dev server). Belt-and-suspenders — the
// dev orchestrator already waits before launching Electron.
async function waitForUrl(url, { tries = 80, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url); return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

async function boot() {
  setDockIcon();
  // Dev: load Vite (HMR) directly; the API + data come from the separate `tsx watch` process.
  if (devUrl) {
    await waitForUrl(devUrl);
    serverUrl = devUrl;
    createMainWindow(devUrl);
    if (process.env.UNIOME_DEVTOOLS !== '0') mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  // Packaged: boot the embedded server and open the window immediately. Organism data is fetched
  // on demand from the home-page tiles (no startup download), so an empty data dir is fine.
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  const { start } = require(serverPath);
  const { url } = await start({ webDir, port: 0, host: '127.0.0.1' });
  serverUrl = url;
  createMainWindow(url);
}

app.whenReady().then(boot).catch((err) => {
  dialog.showErrorBox('UniOme failed to start', String(err?.stack || err));
  app.quit();
});

// macOS: keep the app alive when all windows close; re-open on dock click.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (serverUrl && BrowserWindow.getAllWindows().length === 0) createMainWindow(serverUrl);
});
