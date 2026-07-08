# UniOme desktop (Electron)

UniOme runs as a native macOS window (no terminal, no system browser) via Electron. There are **two
ways** to run it — pick by how you want to ship + update:

| | **From source** (primary) | **Packaged `.dmg`** (optional) |
|---|---|---|
| Install | none — clone the repo | install the app |
| Launch | double-click `UniOme.app` | launch installed app |
| Update | `git pull` → relaunch | rebuild dmg + reinstall |
| Data | repo `resources/` (`npm run setup`) | first-run download to userData |
| Runs | Vite + API (`tsx`) from source, Electron window | bundled server + SPA, Electron window |

Both open the same native window with an in-app **Console** tab (a header toggle that streams the
server log via `/api/_logs`) — so there's never a separate terminal.

## From source — the `UniOme.app` launcher (recommended)

The repo ships a tiny double-clickable launcher at the repo root. Clone → double-click → live; to
update, `git pull` and relaunch (the dev stack compiles the latest source on the fly — no build, no
reinstall). It's the old `npm-run-dev` workflow, but in a native window instead of the browser, and
with no Terminal window.

```
UniOme.app                         double-click launcher (no terminal)
  └─ Contents/MacOS/UniOme         → backgrounds apps/desktop/launch.sh, exits
apps/desktop/launch.sh             npm install (1st run) → npm run setup if no data → dev stack
apps/desktop/scripts/dev.mjs       picks free ports; runs API (tsx) + Vite (HMR) + Electron window
```

First launch installs deps (with a persistent progress window) + opens; later launches are instant.
Run it headless/CLI with `npm run dev -w @uniome/desktop` (opens devtools unless `UNIOME_DEVTOOLS=0`).
Logs are written under the repo at `logs/launch.log` — the whole launch (install + API/Vite/Electron)
is captured there. Each launch starts a fresh `launch.log` (so it holds just the current session) and
keeps the previous session as `logs/launch.log.1`. Gitignored.

## Packaged build — internals

The packaged path bundles the Fastify server to one file (esbuild) and serves **both** the web UI
and `/api` on one localhost origin; the window loads that origin (so the web app's relative `/api`
calls work unchanged). Data isn't bundled — it's downloaded to userData on first run.

```
electron/
  main.cjs            shell: dev → load Vite URL; packaged → first-run download → boot server → window
  download.cjs        download + extract <org>.tar.gz into <userData>/resources (mirrors unpack-assets)
  loading.html        first-run progress UI · preload.cjs  loading-screen bridge
  data-manifest.json  archive list (empty in repo — set per build; see "Data" below)
scripts/dev.mjs       from-source dev stack (used by the launcher)
scripts/build.mjs     esbuild server → build/server.cjs + copy web dist → build/web
electron-builder.yml  macOS dmg packaging (arm64 + x64)
build/ · dist/        generated (gitignored): server bundle + web · the .dmg
```

```bash
npm run build -w @uniome/desktop     # esbuild the server + build/copy the web dist
npm start    -w @uniome/desktop      # build + launch the packaged-style app (electron .)
```

> In some sandboxes `ELECTRON_RUN_AS_NODE=1` is set globally, which makes `electron .` run as plain
> Node (`app` is undefined). If you hit that, launch with `env -u ELECTRON_RUN_AS_NODE electron .`.

## Package a .dmg — Electron bundled, zero user-side install

The `.dmg` is the distribution for anyone who can't (or shouldn't) run the from-source launcher —
non-technical users, or **locked-down machines that block npm install scripts** (a global
`ignore-scripts`, `@lavamoat/allow-scripts`, corporate policy). electron-builder bundles **Electron +
the built server + web UI** into a self-contained `UniOme.app`, so the end user just drags it to
Applications and opens it — **no `npm install`, no postinstall scripts, no Electron download.** Electron
is fetched at *build* time on the maintainer's machine, so the user's environment never matters.
(The from-source `UniOme.app` still needs npm/Electron on first run; that's the developer path.)

```bash
npm run dist            # arm64 + x64 → apps/desktop/dist/UniOme-<version>-<arch>.dmg
npm run dist:arm64      # Apple silicon only (fastest)
npm run dist:x64        # Intel only
```

The build first runs `scripts/build.mjs` (esbuild the server + `vite build` the web + copy the org
configs), then electron-builder packages it. Output `apps/desktop/dist/` is gitignored. **Publish** by
uploading to the GitHub Release so users can download it:

```bash
gh release upload assets apps/desktop/dist/UniOme-*.dmg --clobber
```

Builds are **unsigned** — first launch needs right-click → **Open** (Gatekeeper), and a browser-
downloaded `.dmg` may need `xattr -dr com.apple.quarantine UniOme.app` after copying. To distribute
beyond your lab, sign + notarize: set `CSC_LINK` / `CSC_KEY_PASSWORD` to an Apple Developer ID cert and
add a notarize step. (Windows is not built here; add a `win` target + a Windows CI runner.)

## Organisms: the catalog & 3-state tiles

The home page tiles are merged from a **tile registry** ([`resources/organism-catalog.json`](../../resources/organism-catalog.json))
and each organism's **infra config** (`scripts/organisms/<folder>/organism.json`). Each tile is in
one of three states — exactly the lifecycle of **adding an organism**:

| Step | Where | Tile |
|---|---|---|
| 1. Add the tile | `{ taxid, nickname, keggid, name }` in `resources/organism-catalog.json` | **planned** — "not yet supported" |
| 2. Build its backend + host its archive | `available: true` + `url` (+ `bytes`) in `scripts/organisms/<folder>/organism.json` | **available** — *Download data* button |
| 3. Download (+ on-disk resource check) | data lands in `resources/<folder>` | **ready** — links into the organism page |

The registry carries the identifiers known at registration — **taxid, nickname, keggid** — plus a
human-readable **`name`** shown on the tile before any data exists. Everything else lives with the org's
build infra: cross-DB ids (`stringSpecies`/`speciesTaxid`/`paxdbSpecies`) and the availability/download
(`available`/`url`/`bytes`). The precise species/strain is **derived from the enriched DB** once ready
(before download the tile is labelled by `name`, else the nickname). The data dir is
`resources/<folder>`, where `folder` defaults to **`<taxid>_<nickname>`** (e.g. `83333_Ec`).
"Ready" means the server discovered the organism on disk (valid core DB → chromosomes) — the
resource check. Data is **not** bundled and **not** downloaded at startup — the app opens
immediately and each download runs server-side with a live progress bar, after which the tile flips
to ready automatically (the server re-discovers it).

Endpoints: `GET /api/catalog` (organisms + `present` flag), `POST /api/organism/:taxid/download`
(start), `GET /api/organism/:taxid/download/events` (SSE progress). Archive format is the same
`<org>.tar.gz` as `scripts/pack-assets.mjs` / the GitHub Release.

Archives download from the public GitHub Release by default (baked into `apps/api/src/catalog.ts`),
so the buttons work zero-config on a fresh clone. To point elsewhere (a fork/mirror, or a local dir
for testing), override the base:

- set `UNIOME_DATA_BASE=<url-or-dir>` in the environment, or put it in `.uniome.env` (gitignored) —
  the `UniOme.app` launcher sources that file, so it applies without per-launch env, or
- set each organism's `url` in `scripts/organisms/<folder>/organism.json` (an absolute
  `http(s)://…`/`file://…` url overrides the base; a relative url joins it).

`url` may be `http(s)://…`, `file://…`, or a local path (handy for testing against
`resources/_assets/<org>.tar.gz`). Data dir is the repo `resources/` when run from source, or
`~/Library/Application Support/UniOme/resources` when packaged.

(Bulk fetch via `npm run setup` still works for maintainers. `electron/{download,loading,preload}`
are now unused by the open-immediately flow and can be removed.)
