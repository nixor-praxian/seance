#!/usr/bin/env python3
"""Local launcher for parked Claude Code sessions.

Serves a single page listing the sessions worth coming back to. Clicking a card
opens a fresh Ghostty window in that session's working directory and runs
`claude --resume <id>`.

Binds 127.0.0.1 only. The session id is never taken from the request body — the
request carries an index into sessions.json, and the id comes from the manifest.

    python3 serve.py [--port 7788] [--no-open]

Status: throwaway evidence, superseded by ../../resume.md, which is the design
that ships. Not a component of seance. Three things to know before running it:

- The manifest is HAND-WRITTEN. `sessions.json` lists nine conversations
  captured on 2026-08-14; it does not enumerate anything. Entries go stale, and
  several of those sessions may already be open.
- There is NO DE-DUPLICATION. Clicking a card whose session is already running
  starts a second `claude --resume` on the same transcript — observed for
  a4424561. `~/.claude/bin/ccresume.sh` shows the guard: look for a live process
  matching the id and focus that window instead of spawning.
- The project-directory slug is WRONG here. `project_dir()` maps cwd with
  `cwd.replace("/", "-")`, but Claude Code also replaces `.`, so any cwd
  containing a dot resolves to a path that does not exist. `projectDirNameForCwd`
  in `src/sessions.ts` gets this right; this prototype does not.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "sessions.json"
PAGE = HERE / "index.html"
PROJECTS = Path.home() / ".claude" / "projects"
GHOSTTY = Path("/Applications/Ghostty.app")
GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty"

# Per-session variables that must never reach a restored conversation. If this
# server is started from inside a Claude Code session — the normal way, since
# that's where you notice a session worth parking — its environment carries
# them. CLAUDE_CODE_CHILD_SESSION marks a process as a nested session and turns
# transcript saving off, so a conversation restored under it can start a
# successor that is never written to ~/.claude/projects and can never be
# resumed again. The rest name a session and a bridge socket that are dead by
# the time anything reads them.
INHERITED_MARKERS = (
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
)


def project_dir(cwd: str) -> Path:
    """Claude Code stores a session under a slug of its working directory."""
    return PROJECTS / cwd.replace("/", "-")


def last_activity(transcript: Path) -> float:
    """Newest timestamp in the transcript, not its mtime.

    A session touched by /remote-control or a bridge reconnect gets a fresh
    mtime without a word being exchanged, which makes every card claim the
    same age. Read the tail and take the last real timestamp instead.
    """
    with transcript.open("rb") as fh:
        fh.seek(0, os.SEEK_END)
        size = fh.tell()
        fh.seek(max(0, size - 65536))
        tail = fh.read().decode("utf-8", "ignore").splitlines()
    for line in reversed(tail):
        try:
            ts = json.loads(line).get("timestamp")
        except json.JSONDecodeError:
            continue
        if ts:
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    return transcript.stat().st_mtime


def load_sessions() -> list[dict]:
    sessions = json.loads(MANIFEST.read_text())
    for s in sessions:
        transcript = project_dir(s["cwd"]) / f"{s['id']}.jsonl"
        s["exists"] = transcript.exists()
        s["last_active"] = last_activity(transcript) if s["exists"] else None
        s["command"] = f"cd {s['cwd']} && claude --resume {s['id']}"
    return sessions


def as_applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def ghostty_running() -> bool:
    return (
        subprocess.run(
            ["pgrep", "-f", "Ghostty.app/Contents/MacOS/"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        == 0
    )


def ensure_ghostty() -> None:
    """Cold start only. `open -a` without -n reuses a running instance."""
    if ghostty_running():
        return
    subprocess.run(["open", "-a", str(GHOSTTY)], check=True)
    for _ in range(60):
        time.sleep(0.1)
        if ghostty_running():
            return
    raise RuntimeError("Ghostty did not come up")


def launch(session: dict) -> None:
    """Open the session in a new window of the *running* Ghostty instance.

    Never `open -na`: -n means "new instance even if one is running", so every
    click started another whole Ghostty process. Beyond the clutter, windows in
    those extra instances belong to a different pid, which puts them out of
    reach of anything that addresses one "Ghostty" process — seance's AX
    scripts resolve a single pid and silently never see them.

    `open -a` alone is not the fix: --args are only honoured on a cold launch,
    so on an already-running Ghostty it would activate the app and drop the
    command. Ghostty 1.3's scripting dictionary is what makes a window in the
    instance that already exists.
    """
    ensure_ghostty()
    # Routing through the running instance already leaves this server's
    # environment behind — Ghostty was started by launchd, not by us. The
    # explicit unset keeps that true even if Ghostty itself was ever launched
    # from a marked shell, which costs nothing and is not obvious from here.
    scrub = f"unset {' '.join(INHERITED_MARKERS)}; "
    inner = f"{scrub}cd {json.dumps(session['cwd'])} && exec claude --resume {session['id']}"
    # A record literal with only the fields we mean: `new surface configuration`
    # materialises an empty command and the surface fails to initialise.
    configuration = (
        f"{{initial working directory:{as_applescript_string(session['cwd'])}, "
        f"initial input:{as_applescript_string(inner)} & linefeed}}"
    )
    subprocess.run(
        [
            "osascript",
            "-e",
            f'tell application id "{GHOSTTY_BUNDLE_ID}" to '
            f"new window with configuration {configuration}",
        ],
        check=True,
    )


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict | list) -> None:
        self._send(code, json.dumps(payload).encode(), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/sessions":
            self._json(200, load_sessions())
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/launch":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            index = json.loads(self.rfile.read(length))["index"]
            session = load_sessions()[int(index)]
        except (ValueError, KeyError, IndexError, TypeError):
            self._json(400, {"error": "bad request"})
            return
        if not session["exists"]:
            self._json(409, {"error": "transcript not found on disk"})
            return
        try:
            launch(session)
        except subprocess.CalledProcessError as exc:
            self._json(500, {"error": f"ghostty failed: {exc}"})
            return
        self._json(200, {"launched": session["name"]})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"  {fmt % args}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7788)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    if not GHOSTTY.exists():
        print(f"Ghostty not found at {GHOSTTY}", file=sys.stderr)
        return 1

    url = f"http://127.0.0.1:{args.port}/"
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    missing = [s["name"] for s in load_sessions() if not s["exists"]]
    if missing:
        print("transcript missing for: " + ", ".join(missing), file=sys.stderr)
    print(f"session-resume on {url}  (ctrl-c to stop)")
    if not args.no_open and not os.environ.get("SSH_TTY"):
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
