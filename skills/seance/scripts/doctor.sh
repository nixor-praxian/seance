#!/usr/bin/env bash
# Preflight for seance diagnosis. Read-only: moves no windows, writes no state.
set -uo pipefail
REPO="${SEANCE_REPO:-$HOME/GitHub/seance}"
STATE="${SEANCE_HOME:-$HOME/.config/seance}"

say() { printf '%-34s %s\n' "$1" "$2"; }

echo "── seance doctor ──────────────────────────────────────────"

n=$(pgrep -f "Ghostty.app/Contents/MacOS/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" = "1" ]; then say "ghostty instances" "1 — ok"
elif [ "$n" = "0" ]; then say "ghostty instances" "0 — not running (or pgrep is sandboxed)"
else say "ghostty instances" "$n — TOO MANY. Perception sees only the first; close the extras."
fi

if w=$(pgrep -fl "cli.js watch" 2>/dev/null | head -1) && [ -n "$w" ]; then
  say "watcher" "running (pid ${w%% *})"
else
  say "watcher" "NOT running — 'seance watch --install'"
fi

if [ -f "$REPO/dist/cli.js" ]; then
  newest_src=$(find "$REPO/src" -name '*.ts' -not -name '*.test.ts' -newer "$REPO/dist/cli.js" 2>/dev/null | head -1)
  if [ -n "$newest_src" ]; then
    say "dist/" "STALE — src is newer. Run: npm run build && restart watcher"
  else
    say "dist/" "current"
  fi
else
  say "dist/" "missing — run npm run build"
fi

if command -v seance >/dev/null 2>&1; then
  say "seance on PATH" "$(command -v seance)"
  say "reflow policy" "$(seance reflow 2>/dev/null | head -1 | sed 's/^reflow on display change = //')"
else
  say "seance on PATH" "NOT FOUND"
fi

say "state" "$STATE/state.json"

if pgrep -q -f "DisplayLinkUserAgent" 2>/dev/null; then
  say "DisplayLink agent" "running — external displays are virtual, ids are reissued on every reconnect"
else
  say "DisplayLink agent" "not running"
fi

if command -v seance >/dev/null 2>&1; then
  echo
  echo "displays (ID churns on reconnect, UUID does not):"
  seance screens 2>/dev/null | sed 's/^/  /'
fi

log="$STATE/watcher.log"
if [ -f "$log" ]; then
  echo
  echo "last display events:"
  grep -E "display set changed|organized |known display arrangement|settled back|reflow is off" "$log" \
    | tail -6 | sed 's/^/  /'
else
  say "watcher.log" "none yet"
fi
