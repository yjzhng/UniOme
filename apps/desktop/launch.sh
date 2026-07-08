#!/bin/bash
# Run UniOme from source in its own Electron window — no install, no rebundle, no terminal.
# This is what UniOme.app double-click invokes. Clone → click → live; `git pull` → relaunch →
# updated (the dev stack compiles the latest source on the fly, like the old npm-run-dev flow,
# but in a native window instead of the system browser).
set -e
cd "$(cd "$(dirname "$0")/../.." && pwd)" # repo root (apps/desktop/launch.sh → ../..)

# Finder-launched .apps inherit a minimal PATH (/usr/bin:/bin:…) without node/npm — and tsx, vite
# and electron all use `#!/usr/bin/env node` shebangs, so they need it too. Recover the real PATH:
# common Homebrew dirs first, then, if node still isn't found, whatever a login shell resolves
# (covers nvm/other installs). Exported so the spawned dev stack inherits it.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  USER_PATH="$(/bin/zsh -lic 'printf %s "$PATH"' 2>/dev/null || true)"
  [ -n "$USER_PATH" ] && export PATH="$PATH:$USER_PATH"
fi

# Optional local config (gitignored): the home-page download buttons default to the public GitHub
# Release (baked into apps/api/src/catalog.ts), so no config is needed on a fresh clone. Create a
# .uniome.env only to override the source, e.g. a single line:
#   UNIOME_DATA_BASE=https://example.org/uniome-data   (or a local dir for testing)
# (also honors UNIOME_CATALOG to point at an alternate catalog). Exported to the dev stack.
if [ -f .uniome.env ]; then set -a; . ./.uniome.env; set +a; fi

LOG="${TMPDIR:-/tmp}/uniome-launch.log" # the .app stub redirects this script's output here
note() { osascript -e "display notification \"$1\" with title \"UniOme\"" >/dev/null 2>&1 || true; }

# First run — or a previous interrupted install — installs workspace deps (Electron, Vite, tsx, …).
# We gate on Electron's actual downloaded binary, NOT just node_modules/: a fresh `npm install`
# creates the dirs first, then Electron's postinstall fetches a ~150 MB binary. If that step stalls or
# is force-quit, the dirs exist but the binary doesn't — a plain "is node_modules there?" check would
# then skip install forever and the window would never open. So re-install until Electron is really
# present, and surface failures (this runs headless under the .app, so silent errors look like a hang).
electron_ready() { [ -e node_modules/electron/dist/Electron.app ] || [ -e node_modules/electron/path.txt ]; }
if [ ! -d node_modules ] || ! electron_ready; then
  note "First run: setting up UniOme… (installs dependencies + downloads Electron)"
  # Run install in the background and post progress so a multi-minute first run doesn't look frozen.
  # The phase is inferred from the filesystem: Electron's ~150 MB binary is the slow part and lands
  # last (its postinstall), so once its package unpacks we say "downloading Electron"; a heartbeat with
  # elapsed minutes fires during long phases. Output → the log for debugging.
  npm install >>"$LOG" 2>&1 &
  npm_pid=$!
  phase=""; ticks=0
  while kill -0 "$npm_pid" 2>/dev/null; do
    if electron_ready; then p="finishing up"
    elif [ -d node_modules/electron ]; then p="downloading Electron (~150 MB)"
    else p="installing dependencies"; fi
    if [ "$p" != "$phase" ]; then note "Setting up — $p…"; phase="$p"
    elif [ "$ticks" -gt 0 ] && [ $((ticks % 4)) -eq 0 ]; then note "Still $p… (~$((ticks * 15 / 60)) min)"; fi
    ticks=$((ticks + 1)); sleep 15
  done
  if ! wait "$npm_pid"; then
    note "Install failed — see $LOG, then relaunch"
    exit 1
  fi
  if ! electron_ready; then
    note "Electron didn't finish downloading — relaunch to retry (log: $LOG)"
    exit 1
  fi
fi

# Note: organism data is NOT auto-downloaded here anymore. The app opens immediately and each
# organism tile on the home page offers a "Download data" button (with a progress bar) when its
# data isn't present yet. (Bulk fetch is still available via `npm run setup`.)

note "Starting UniOme…"
# Run-from-source desktop stack: API (tsx) + Vite (HMR) + the Electron window. No devtools for a
# clean end-user window; the in-app Console tab shows the server log instead of a terminal.
export UNIOME_DEVTOOLS=0
exec node apps/desktop/scripts/dev.mjs
