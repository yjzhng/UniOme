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

# Logs live under the repo (logs/) so they travel with the portable app folder. The .app stub appends
# this script's whole output (install + dev stack) here; when run directly we still write the install
# log and point error notifications at it. $PWD is the repo root (cd'd above). logs/ is gitignored.
LOG_DIR="$PWD/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG="$LOG_DIR/launch.log"
note() { osascript -e "display notification \"$1\" with title \"UniOme\"" >/dev/null 2>&1 || true; }

# First run — or a previous interrupted install — installs workspace deps (Electron, Vite, tsx, …).
# We gate on Electron's actual downloaded binary, NOT just node_modules/: a fresh `npm install`
# creates the dirs first, then Electron's postinstall fetches a ~150 MB binary. If that step stalls or
# is force-quit, the dirs exist but the binary doesn't — a plain "is node_modules there?" check would
# then skip install forever and the window would never open. So re-install until Electron is really
# present, and surface failures (this runs headless under the .app, so silent errors look like a hang).
electron_ready() { [ -e node_modules/electron/dist/Electron.app ] || [ -e node_modules/electron/path.txt ]; }

# Persistent progress window for the first-run install. macOS notification banners auto-dismiss after
# a few seconds and can't show a bar, so we compile a tiny AppleScript *applet* at runtime — its
# `progress` UI is a real, persistent window with a bar + %. It polls a status file ("PCT|message")
# that we update; writing 100 makes it close. Falls back to notifications if AppleScript is unavailable.
STATUS="${TMPDIR:-/tmp}/uniome-setup.progress"
APPLET="${TMPDIR:-/tmp}/UniOmeSetup.app"
APPSRC="${TMPDIR:-/tmp}/uniome-progress.applescript"
progress_write() { printf '%s|%s' "$1" "$2" > "$STATUS" 2>/dev/null || true; }
start_progress_window() {
  command -v osacompile >/dev/null 2>&1 || return 1
  progress_write 0 "starting…"
  cat > "$APPSRC" <<APPLESCRIPT
on run
  set statusFile to "$STATUS"
  set progress total steps to 100
  set progress description to "Setting up UniOme"
  set progress additional description to "Starting…"
  repeat
    set txt to "0|working…"
    try
      set txt to (do shell script "cat " & quoted form of statusFile)
    end try
    set AppleScript's text item delimiters to "|"
    try
      set pct to (text item 1 of txt) as integer
    on error
      set pct to 0
    end try
    if (count of text items of txt) > 1 then
      set msg to text item 2 of txt
    else
      set msg to ""
    end if
    if pct < 0 then set pct to 0
    if pct > 100 then set pct to 100
    set progress completed steps to pct
    set progress additional description to ((pct as string) & "%  ·  " & msg)
    if pct is greater than or equal to 100 then exit repeat
    delay 1
  end repeat
end run
APPLESCRIPT
  rm -rf "$APPLET"
  osacompile -o "$APPLET" "$APPSRC" >/dev/null 2>&1 || return 1
  open "$APPLET" >/dev/null 2>&1 || return 1
  return 0
}

if [ ! -d node_modules ] || ! electron_ready; then
  win=0
  if start_progress_window; then win=1; else note "First run: setting up UniOme… (a few minutes)"; fi
  npm install >>"$LOG" 2>&1 &
  npm_pid=$!
  # Phase inferred from the filesystem (Electron's ~150 MB binary is the slow part and lands last, in
  # its postinstall). npm gives no clean overall %, so the percentage is phase-weighted and ramps with
  # elapsed time within each phase — monotonically increasing (bases 2 → 35 → 92) and capped per phase.
  phase=""; phase_start=$SECONDS
  while kill -0 "$npm_pid" 2>/dev/null; do
    if electron_ready; then p="finishing up"; base=92; cap=98
    elif [ -d node_modules/electron ]; then p="downloading Electron (~150 MB)"; base=35; cap=90
    else p="installing dependencies"; base=2; cap=30; fi
    if [ "$p" != "$phase" ]; then
      phase="$p"; phase_start=$SECONDS
      [ "$win" -eq 0 ] && note "Setting up — $p…"
    fi
    pct=$(( base + (SECONDS - phase_start) )); [ "$pct" -gt "$cap" ] && pct=$cap
    [ "$win" -eq 1 ] && progress_write "$pct" "$p"
    sleep 1
  done
  if ! wait "$npm_pid"; then
    [ "$win" -eq 1 ] && progress_write 100 "failed"
    note "Install failed — see $LOG, then relaunch"
    exit 1
  fi
  if [ "$win" -eq 1 ]; then
    progress_write 100 "done"
    sleep 2   # the applet polls every 1s: let it read 100 and close BEFORE we delete its status file,
              # else its next read finds no file, falls back to 0%, and the window stays open forever
  fi
  rm -f "$STATUS" "$APPSRC"; rm -rf "$APPLET"
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
