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

note() { osascript -e "display notification \"$1\" with title \"UniOme\"" >/dev/null 2>&1 || true; }

# First run: install workspace deps (Electron, Vite, tsx, …). Slow once; silent otherwise.
if [ ! -d node_modules ] || [ ! -d apps/web/node_modules ]; then
  note "First run: installing… (a few minutes)"
  npm install
fi

# Note: organism data is NOT auto-downloaded here anymore. The app opens immediately and each
# organism tile on the home page offers a "Download data" button (with a progress bar) when its
# data isn't present yet. (Bulk fetch is still available via `npm run setup`.)

note "Starting UniOme…"
# Run-from-source desktop stack: API (tsx) + Vite (HMR) + the Electron window. No devtools for a
# clean end-user window; the in-app Console tab shows the server log instead of a terminal.
export UNIOME_DEVTOOLS=0
exec node apps/desktop/scripts/dev.mjs
