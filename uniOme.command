#!/bin/bash
# Double-click to launch uniOme.
# Boots the API + web dev servers and opens the browser.

set -e
cd "$(dirname "$0")"

echo "▸ uniOme — $(pwd)"

# Install deps the first time (or if node_modules is missing).
if [ ! -d node_modules ] || [ ! -d apps/web/node_modules ]; then
  echo "▸ installing dependencies (first run)…"
  npm install
fi

# Open the browser once the web server is up.
(
  for _ in $(seq 1 60); do
    if curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
      open http://localhost:5173/
      exit 0
    fi
    sleep 0.5
  done
  echo "⚠︎ web server did not come up within 30s"
) &

# Forward Ctrl-C to the dev servers so they exit cleanly.
trap 'echo; echo "▸ stopping uniOme"; kill 0' INT TERM
echo "▸ starting servers — press Ctrl-C to stop"
npm run dev
