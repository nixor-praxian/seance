---
created: 2026-08-14
updated: 2026-08-14
status: proposed
---

# Resume — parked conversations, from Alfred

*The reboot case. Nine Claude Code conversations across seven repos are worth
coming back to, the machine restarts, and there is no surface that lists them.
This spec adds one: type `s resume` in Alfred, see every parked conversation
ranked by when it was last worked on, labelled with where it stopped, and press
Enter to bring it back in its own Ghostty window.*

## Why this isn't already done

seance can already resume a conversation. `seance resume <repo> [uuid]` spawns
a window running `claude --resume`, and the Alfred palette surfaces up to four
dormant conversations once the query's first token prefix-matches a repo
(`src/cli.ts:1182-1215`). The primitives in `src/sessions.ts` — transcript
enumeration, mtime ranking, title extraction — are the right ones and this spec
keeps them.

What's missing is everything the reboot case needs, and the gaps are specific.

### 1. You have to already know what you're looking for

The palette only reaches a repo's conversations after you type its name. There
is no way to ask *"what did I leave running?"* — which is the only question
anyone has after a restart. `resolveRepoCwd` (`src/cli.ts:1541`) falls back to
`~/GitHub/<repo>`, so a named repo does resolve post-reboot; the missing verb is
the browse, not the lookup.

It also can't reach a conversation whose cwd isn't `~/GitHub/<repo>`. Two of the
nine live in `/Users/node/GitHub` itself, one in a `docs/` subdirectory of a
repo. No repo token reaches any of them.

### 2. mtime is not activity

`pickSessionUuids` ranks by file mtime. A `/remote-control` reconnect, a bridge
attach, or a `/exit` rewrites the transcript without a word being exchanged.
Measured across the nine, five reported the same mtime age to the minute while
their true last exchange ranged from **18 hours to 7 days**.

The fix is to read the last `timestamp` in the transcript tail — 2 ms for
twelve files (see [Cost](#cost)) — and rank on that.

### 3. A third of transcripts get no title at all, and the rest get the wrong one

`parseSessionTitleFromChunks` reads a 32 KB head window, prefers a tail
`summary` record, and otherwise takes the first user message. Run against the
nine real threads:

| outcome | count | what you actually see |
|---|---|---|
| no title — falls back to the uuid | 3 | `Resume Argus — ca83252d` |
| the boilerplate agent preamble | 4 | `- if you must explore, run a Sonnet agent…` |
| a true but useless opener | 2 | `pull latest` |
| describes where the session stopped | **0** | — |

Two separate causes, both worth fixing:

**A pasted image destroys the title.** The first user record carries its
attachment inline, so it runs 300–600 KB. It overruns the 32 KB head window,
the truncated line fails `JSON.parse`, and the session goes untitled. Measured
first-user-record lengths: Argus 580 KB at offset 17 KB, L'Impression 308 KB,
Spark 604 KB — all truncated; Zeus's image-free 1.5 KB record parses fine. This
is not an edge case for a user who pastes screenshots into most sessions.

**The first message is the wrong message.** None of these transcripts contains a
`summary` record (0 of 9), so every title falls through to the opener — which is
where a session *began*, often the standing agent-instructions preamble. What
you need on returning is where it *stopped*.

### 4. There is nowhere to put what you know

Some threads carry a fact the transcript can't yield by extraction: *this branch
is pushed but unmerged and needs your Turnstile keys*; *tasks 6–7 are blocked on
credentials only you hold*. That's a judgement, and it belongs in policy.

## What ships

### `seance parked` — the browse

```
seance parked [--limit 12] [--all] [--json]
```

Enumerates every transcript under `~/.claude/projects`, ranks by true last
activity, and prints one line each: repo, age, and label. `--all` drops the
limit. Conversations presumed live (a running `claude` pane on the same cwd,
via the existing `perceiveWorld` + `isClaudeCommand` path) are excluded by
default — you can't park what you're sitting in.

### `seance resume --uuid <uuid>`

The existing `resume <repo> [uuid]` form stays. The new flag resolves cwd by
scanning project directories for the transcript, so a conversation is reachable
by uuid alone with no repo token and no `~/GitHub` assumption. Reverses
`projectDirNameForCwd` by lookup, never by string surgery — the slug replaces
both `/` and `.`, so it isn't invertible.

### The Alfred surface

`s resume` — the palette's existing substring filter over `title`/`match` is
enough, so this needs no new grammar. Global parked items are appended to the
`json query` item list with `match` containing `resume parked sessions
conversations`, one per conversation:

```
title:    Resume zeus — options numbers layer
subtitle: 18h · feat/options-analytics-numbers · verification report landed, ASD-STE100 copy committed
arg:      resume --uuid 7ccc50ba-44dc-47b1-8e7a-520b0ea55620
```

Typing narrows by repo or by label text, so `s resume mesh` and `s resume
turnstile` both land. Enter spawns the window. Two modifiers, both cheap:

- `⌘↩` — copy `cd <cwd> && claude --resume <uuid>` to the clipboard instead of
  launching, for when you want it in a pane you already have.
- `⌥↩` — reveal the transcript in Finder.

Ordering within the palette: parked items sort by activity and sit below the
live-repo actions, so an unfiltered `s` is unchanged for existing muscle memory.

### The note overlay

```
seance note <uuid|repo> "<text>"      # write
seance note <uuid> --clear
```

Stored in `SeanceState` under `notes: { [uuid]: { text, writtenAt } }`. A note
replaces the extracted label in both surfaces and is the only persisted addition
this spec makes.

This is policy, not a binding — it names a conversation by its immutable uuid,
never a tty, window, or display id, so it can't rot in the way `docs/vision.md`
describes. It can go *stale* (the branch gets merged, the note still says
"unmerged"), which is why the palette renders `writtenAt` as an age when the
note is older than the session's last activity.

Notes are optional. Every conversation is reachable and legibly labelled
without one.

## Labelling, concretely

The label is the first of these that yields text:

1. A note for this uuid.
2. The last `summary` record in the tail window.
3. **The last substantive user message** — walking backwards from the tail,
   skipping `<system-reminder>`, `<task-notification>`, `<local-command-*>`,
   `<command-name>` and image-only records, and stripping the standing preamble
   (a leading run of `- ` instruction bullets).
4. The first user message, by the current head-window rule.
5. `uuid.slice(0, 8)`.

Rule 3 is the one that changes the experience: it answers *where did this stop*
rather than *how did it open*.

Three fixes to the existing extractor fall out and apply to
`listRepoSessions` too, which is a real improvement to the per-repo palette
path already in production:

- **Parse line-wise with the truncated boundary line dropped**, at both ends of
  the window. A 600 KB image record must be skipped, not allowed to blank the
  result.
- **Widen the tail window to 256 KB** and keep the head at 32 KB. The tail is
  where the answer is; the cost is measured below and negligible.
- **Rank on the last transcript `timestamp`**, falling back to mtime only when
  no timestamped record is found in the tail.

## Cost

Alfred re-runs the Script Filter on every keystroke, so the budget is real.
Measured on the live corpus — 49 project directories, 132 transcripts, 0.35 GB:

| step | time |
|---|---|
| enumerate + stat every transcript | 9 ms |
| tail-read the top 12 | 2 ms |

**No cache.** At 11 ms the whole thing is inside the keystroke budget, and a
cache would be exactly the kind of stored derived state `docs/vision.md` argues
against. Head/tail reads happen only for the ranked top `--limit`, never for all
132 — that bound is what keeps it flat as the corpus grows.

## Module placement

Per the boundaries in `CLAUDE.md`:

- `src/sessions.ts` (pure, testable on Linux) — `listAllSessions`, the tail
  scanner, `lastActivityMs`, the label chain, `findCwdForUuid`. Filesystem
  reads only; no `osascript`, no `execa`.
- `src/state.ts` — the `notes` map.
- `src/cli.ts` — `parked`, `note`, the `--uuid` flag, and the palette items.
- `ghostty.spawnWindow` is reused as-is. Nothing new touches AX, TTYs, or
  System Events, so no invariant is in play.

## Non-goals

- **No web UI.** The prototype in
  [`docs/prototypes/session-resume/`](prototypes/session-resume/) was the
  proving ground for the measurements above; Alfred is the shipping surface and
  the prototype does not get ported.
- **No LLM summarisation.** The labels are extracted or hand-written. Anything
  that calls a model on every keystroke fails the cost budget.
- **No new window placement.** A resumed pane is placed by the existing
  organize/policy path like any other.
- **No transcript mutation.** Read-only, always.

## Testing

Pure logic gets `vitest` coverage in `src/sessions.test.ts`, fixtures written
into an `mkdtemp` `projectsDir` — the pattern the suite already uses:

- a 600 KB image-bearing first record does not blank the label (regression, gap 3A);
- ranking prefers the last `timestamp` over a bumped mtime (gap 2);
- the label chain, each rung in turn, including preamble stripping;
- `findCwdForUuid` round-trips a cwd containing a `.`;
- an empty bridge stub — records but no conversation — is ranked last and
  labelled as such, not silently listed as resumable.

CLI black-box tests for `parked --json` and `note` go in `src/cli.test.ts` under
`SEANCE_HOME`. The Alfred path is manual: `s resume`, confirm ordering, confirm
Enter spawns in the right cwd, confirm `⌘↩` copies.

## Open questions

1. **Should `parked` hide conversations older than some horizon?** 132
   transcripts exist; roughly ten matter. Ranking may be sufficient, and a
   horizon would eventually hide something wanted. Proposal: no horizon, default
   `--limit 12`.
2. **Empty bridge stubs.** `/remote-control` leaves transcripts with metadata and
   zero conversation (one of the nine was exactly this — 7 records, no messages,
   and the id was the one a human had written down). Proposal: rank them last
   and label them `no conversation`, rather than hiding them, so a
   written-down-but-empty id explains itself instead of vanishing.
3. **Does `note` want a `--from-session` mode** that lets a Claude session write
   its own parting note before you close it? Natural fit, but it puts seance in
   the business of being written to by agents. Deferred.
