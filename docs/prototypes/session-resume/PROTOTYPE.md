---
created: 2026-08-14
updated: 2026-08-17
status: superseded by docs/resume.md
---

# session-resume prototype

Working code, kept for evidence — **not a component of seance**. It is a
throwaway local web page built in the zeus repo to solve one reboot: nine
Claude Code conversations parked across seven repos, no surface listing them.
It works, and every measurement in [`../../resume.md`](../../resume.md) came out
of building it. Alfred is the shipping surface; this page is not getting ported.

```bash
python3 serve.py          # 127.0.0.1:7788, stdlib only
```

| file | what it is |
|---|---|
| `serve.py` | localhost server: manifest + `POST /api/launch` → Ghostty |
| `index.html` | the card list, one thin row per conversation |
| `sessions.json` | the nine conversations, hand-written from reading transcripts |

## What it proved

**The Ghostty spawn — and how it was wrong.** The prototype shipped
`open -na Ghostty.app --args --working-directory=<dir> -e zsh -lc '<cmd>'`,
noting that "each resume gets its own app instance" as if that were a
consequence rather than a defect. It is the defect. `-n` means *new instance
even if one is running*, so nine clicks left nine Ghostty processes alive for
three days. Two harms, neither visible from the page:

- **Windows in an extra instance belong to a different pid.** Anything that
  addresses one `"Ghostty"` process never sees them — `ghosttyPid()` takes the
  first match, so `seance windows` reported a single pane while eight more sat
  in instances it could not perceive. `src/ghostty.ts:338` already carried the
  warning; the prototype didn't heed it.
- **`open` hands the caller's environment to the new instance.** Started from
  inside a Claude Code session — the normal case — that propagates
  `CLAUDE_CODE_CHILD_SESSION=1` into every restored conversation. Verified:
  stray instance 36365 carried the marker and a stale `SESSION_ID`, while the
  launchd-started Ghostty (pid 647) carried neither. Resumed conversations still
  append to their existing transcript, so nothing was lost, but a *new* session
  started in such a window is never written and can never be resumed.

Fixed by routing through the running instance via Ghostty 1.3's scripting
dictionary, the same record-literal form as `spawnWindow` in
`src/ghostty.ts:342`, with `ensure_ghostty()` covering the cold start. `open -a`
without `-n` is not an alternative: `--args` are only honoured on a cold launch,
so on a running Ghostty it activates the app and silently drops the command.
The markers are also unset in the spawned shell, which the AppleScript route
already avoids but which costs nothing to guarantee.

`ghostty +new-window` remains unavailable on macOS — *"not supported on this
platform"* — which is what pushed the original toward `open` in the first place.

**mtime lies.** The page first showed last-activity from file mtime and rendered
five cards reading an identical "7h ago" when the real spread was 18 hours to 7
days. Bridge reconnects and `/exit` rewrite the file without a word being
exchanged. Reading the last `timestamp` from the tail fixed it — that's gap 2 in
the spec.

**Hand-written labels are worth something.** `sessions.json` carries a
`headline` / `stopped_at` / `next` triple per conversation, written by reading
the transcripts. Nothing extractable came close, which is what motivated both
the label chain and the note overlay. The file is also a usable corpus for
testing an extractor against: what a human wrote, per session, for the same nine
transcripts the spec measures.

**The manifest slug is wrong here.** `serve.py` maps cwd → project directory
with `cwd.replace("/", "-")`. Claude Code also replaces `.`, which
`projectDirNameForCwd` in `src/sessions.ts` gets right. Any cwd containing a dot
breaks this prototype and not seance.

## What it does not do

No global enumeration — the nine entries are hand-listed, which is precisely the
work the spec automates. No live-pane exclusion, no notes, no Alfred.

**No de-duplication.** Clicking the same card twice starts a second `claude
--resume` on the same transcript; session `a4424561` was observed open twice.
`~/.claude/bin/ccresume.sh` already solves this — it looks for a live process
matching the id and focuses that window instead of spawning — and `docs/resume.md`
should carry the guard when this lands for real.
