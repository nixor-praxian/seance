# todo

Remaining work, most valuable first. Updated 2026-08-18.

Excludes transient machine state (stray processes, windows to close) — this is
work that outlives a reboot.

---

## 1. Implement `seance parked` — the resume surface

`docs/resume.md` is merged as **`status: proposed`** and none of its core
surface exists. Everything below is unbuilt; `seance resume <repo> [uuid]` and
`seance session save/restore/list` already work and are unaffected.

Module placement is settled by the spec (§"Module placement") and respects the
`CLAUDE.md` boundaries — nothing here touches AX, TTYs, or System Events, so no
invariant is in play and `ghostty.spawnWindow` is reused as-is.

- [ ] **`src/sessions.ts` (pure)** — `listAllSessions`, the tail scanner,
      `lastActivityMs`, the label chain, `findCwdForUuid`. Filesystem reads
      only, no `execa`/`osascript`.
      - `findCwdForUuid` must resolve by **lookup, never string surgery**: the
        project-dir slug replaces both `/` and `.`, so it is not invertible.
        (The merged prototype gets this wrong on purpose — see its docstring.)
      - Rank by the last `timestamp` in the transcript, not mtime. A bridge
        reconnect or `/exit` bumps mtime with no words exchanged, which made
        five cards read an identical "7h ago" against a real 18h–7d spread.
- [ ] **`seance parked [--limit 12] [--all] [--json]`** — exclude conversations
      presumed live via the existing `perceiveWorld` + `isClaudeCommand` path.
      **Depends on §2**: while perception is degraded the live-exclusion filter
      silently under-excludes.
- [ ] **`seance resume --uuid <uuid>`** — reach a conversation by uuid alone, no
      repo token, no `~/GitHub` assumption. Keeps the existing positional form.
- [ ] **Note overlay** — `seance note <uuid|repo> "<text>"`, `--clear`, stored as
      `state.notes: { [uuid]: { text, writtenAt } }`. Keyed by immutable uuid, so
      it is policy and cannot rot; render `writtenAt` as an age when the note is
      older than the session's last activity.
- [ ] **Alfred items** — appended to `json query`, no new grammar needed. Must
      derive from `live` + `state` only: that path runs on **every keystroke**,
      so no `listScreens`, no `listAllWindows`, no sentinel pass. Sort parked
      items below the live-repo actions so an unfiltered `s` is unchanged.
      `⌘↩` copies the command, `⌥↩` reveals the transcript.
- [ ] **Tests** — `src/sessions.test.ts` with fixtures in an `mkdtemp`
      `projectsDir`: a 600 KB image-bearing first record must not blank the
      label; ranking prefers last `timestamp` over bumped mtime; each rung of
      the label chain; `findCwdForUuid` round-trips a cwd containing a `.`; an
      empty bridge stub ranks last and is labelled, not listed as resumable.
      CLI black-box for `parked --json` and `note` under `SEANCE_HOME`.

**Open questions to settle before building** (spec §"Open questions"): whether
`parked` needs an age horizon (proposal: no, `--limit 12`); how to present empty
`/remote-control` bridge stubs (proposal: rank last, label `no conversation`);
and whether `note` gets a `--from-session` mode letting an agent write its own
parting note (deferred — it puts seance in the business of being written to by
agents).

---

## 2. Finish verifying `arrange`

Shipped and unit-tested (44 pure tests), but three manual checks from the
implementation plan were never run, because they need several panes across
several repos and displays:

- [ ] Multi-repo cohesion — same-repo panes contiguous, bands sized by count.
- [ ] Display-unplug rebalance — everything lands on main; replug rebalances
      (hysteresis should let the returning display win immediately).
- [ ] `arrange --save <name>` round-trip — moves nothing, then `arrange <name>`
      restores the repo→display split.

**Precondition:** perception must see every pane. Per invariant 8, `ghosttyPid()`
takes the first matching process, so verification is meaningless unless exactly
one Ghostty instance is running — otherwise `arrange` reports a pane count that
looks plausible and is wrong.

---

## 3. Alfred palette returns nothing

Typing `s` in Alfred produces no menu at all. Unresolved.

Already ruled out — **do not re-run these**: global `seance` symlinks to this
checkout and loads a fresh `dist/cli.js`; the installed workflow's baked `PATH`
includes the nvm bin; `seance json query ""` returns valid JSON, exit 0, no
stderr **in Alfred's exact sterile environment**; the installed `info.plist` is
identical to the repo copy apart from that `PATH` line; Alfred 5.6 is running
with `disabled=false` and keyword `s`; no keyword collision; no prefs sync
folder. Reinstalling the workflow and restarting Alfred are therefore not
indicated — no plist changed, and Alfred re-runs the CLI per keystroke.

- [ ] Open the workflow in Alfred Preferences → bug icon → type `s `, and read
      the script's stdout/stderr **as Alfred sees it**. That view has never been
      obtained and is the only remaining source of new information.
- [ ] Confirm the attempt was made in Alfred rather than a terminal — there is
      no shell command `s`; the terminal form is `seance arrange`.

---

## 4. `ccresume.sh` lives outside version control

`~/.claude/bin/ccresume.sh` carries the same `open -na` → scripting-dictionary
fix and marker scrub as `serve.py`, but sits outside any repo, so the fix exists
**only on this machine** and disappears with a rebuild. Backup:
`ccresume.sh.bak-20260817`.

- [ ] Decide: vendor it into this repo (or a dotfiles repo), or accept the risk
      and note it somewhere durable.

---

## Deferred, with reasons

- **`arrange --list` / `--forget`** — Alfred surfaces the names and `state.json`
  is documented as hand-editable. ~4 lines whenever it's wanted.
- **`watch` calling `arrange`** — the watcher stays on `organize`. `arrange`
  skips minimized panes and picks shapes, and a daemon making aesthetic choices
  is a different product decision. No `state.watchVerb` knob until asked.
- **The merged prototype's own defects** — no de-duplication, and the
  non-invertible slug. Both documented in `serve.py`'s docstring. Not worth
  fixing: Alfred is the shipping surface and the page is not being ported.
