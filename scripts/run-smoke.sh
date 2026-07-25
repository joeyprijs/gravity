#!/usr/bin/env bash
# Runs tests/smoke.html in headless Chrome and fails unless the page reports
# SMOKE: PASS — the repo's only DOM coverage, so CI can catch what `npm test`
# structurally cannot (anything touching window, the DOM, or Web Audio).
#
#   scripts/run-smoke.sh
#
# Zero dependencies, deliberately: the verdict is the page title, read over
# Chrome's plain-HTTP DevTools endpoint (/json/list) with curl and grep. No
# WebSocket client, no npm install, nothing to keep in step with a browser
# release. The page also writes failing step names into its URL hash, which the
# same endpoint reports — that is how a red build names the broken step.
#
# Overridable: SMOKE_PORT, SMOKE_DEBUG_PORT, SMOKE_TIMEOUT, CHROME.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SMOKE_PORT:-8765}"
DEBUG_PORT="${SMOKE_DEBUG_PORT:-9222}"
TIMEOUT="${SMOKE_TIMEOUT:-60}"

find_chrome() {
  if [ -n "${CHROME:-}" ]; then echo "$CHROME"; return; fi
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then echo "$candidate"; return; fi
  done
  local mac="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [ -x "$mac" ]; then echo "$mac"; return; fi
  echo ""
}

CHROME_BIN="$(find_chrome)"
if [ -z "$CHROME_BIN" ]; then
  echo "[smoke] no Chrome found — set CHROME=/path/to/chrome" >&2
  exit 1
fi

PROFILE="$(mktemp -d)"
SERVER_PID=""
CHROME_PID=""
# Nothing in here may change the exit status — the verdict below owns that — and
# the profile can only be removed once Chrome has actually stopped writing to it.
cleanup() {
  local status=$?
  for pid in "$CHROME_PID" "$SERVER_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait "$CHROME_PID" "$SERVER_PID" 2>/dev/null || true
  rm -rf "$PROFILE" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!

# The page boots the engine over HTTP, so wait for the server before Chrome
# loads it — a connection refused would look like a silent smoke failure.
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/tests/smoke.html"; then break; fi
  sleep 0.25
done

"$CHROME_BIN" --headless=new --disable-gpu --no-sandbox --mute-audio \
  --remote-debugging-port="$DEBUG_PORT" --user-data-dir="$PROFILE" \
  "http://127.0.0.1:$PORT/tests/smoke.html" >/dev/null 2>&1 &
CHROME_PID=$!

verdict=""
for _ in $(seq 1 "$TIMEOUT"); do
  sleep 1
  targets="$(curl -fs "http://127.0.0.1:$DEBUG_PORT/json/list" 2>/dev/null || true)"
  verdict="$(printf '%s' "$targets" | grep -o 'SMOKE: [A-Z]* ([0-9]*)' | head -1 || true)"
  [ -n "$verdict" ] && break
done

case "$verdict" in
  "SMOKE: PASS"*)
    echo "[smoke] $verdict"
    ;;
  "SMOKE: FAIL"*)
    echo "[smoke] $verdict" >&2
    # The hash carries the failing step names; %20-style escapes are left as-is
    # rather than shelling out to a decoder.
    printf '%s' "$targets" | grep -o '#failed=[^"]*' | head -1 |
      sed 's/#failed=/[smoke] failed steps: /; s/%20/ /g; s/%7C/|/g' >&2 || true
    echo "[smoke] reproduce: python3 -m http.server $PORT then open /tests/smoke.html" >&2
    exit 1
    ;;
  *)
    echo "[smoke] no verdict within ${TIMEOUT}s — the page never finished" >&2
    exit 1
    ;;
esac
