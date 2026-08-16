---
created: 2026-08-14
updated: 2026-08-14
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

**The Ghostty spawn.** `open -na Ghostty.app --args --working-directory=<dir> -e
zsh -lc '<cmd>'`. `ghostty +new-window` refuses on macOS — *"not supported on
this platform"* — so each resume gets its own app instance. seance's
`spawnWindow` already does the equivalent; this only confirms the `-e` form
survives the `open` indirection.

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
