---
name: seance
description: Drive the seance CLI to orchestrate Ghostty terminal panes on macOS — tile panes by repo across displays, paint each repo its own colour, pin grids, control what happens when displays are plugged in, and save or restore workspaces including dormant Claude Code conversations. Use when the user asks to organize, arrange, tile, reflow, gather or summon their panes or terminal windows; asks why their windows moved, got reshuffled, or came back from being minimized; wants a repo on a particular screen; mentions pane colours, per-repo themes, light/dark appearance or unreadable terminal text; asks about the Alfred "s" palette; wants to resume a parked Claude conversation; or is debugging the seance watcher. Also use when modifying the seance codebase itself. macOS + Ghostty only.
allowed-tools: Bash
---

# seance

Tiles and colours Ghostty panes by repo. Source at `~/GitHub/seance`, global on PATH as
`seance`, plus a launchd watcher (`com.seance.watcher`) that paints new panes and reacts to
display changes in the background.

> CLI surface verified against the codebase 2026-08-29 (v2.2.3). If a command errors with an
> unknown option, check `seance --help` — this file may be behind.

## Moving windows is disruptive — do it when asked, not to check something

`arrange`, `organize`, `place`, `gather`, `summon`, `session restore` and `resume` **relocate the
user's windows**, immediately and with no undo. Never run one to verify a change or to "see what
happens". Announce before running one that was not directly requested.

Read-only, safe any time: `screens`, `reflow`, `contrast`, `session list`, `where`, `cheatsheet`,
`json query "<q>"`, and `scripts/doctor.sh` in this skill.

## Pick the verb

| the user wants | run |
|---|---|
| panes tidied, no shape specified | `seance arrange` |
| a specific shape everywhere | `seance organize 3x2` |
| a specific shape on one display | `seance organize 3x2 --screen 1` |
| one repo somewhere specific | `seance place <repo> 3x2 --screen 2` |
| that repo's grid pin cleared | `seance place <repo> auto` |
| a saved layout back | `seance arrange <name>` |
| this layout remembered | `seance arrange --save <name>` (moves nothing) |
| to jump to a repo | `seance focus <repo>` |
| panes stranded on another Space | `seance gather` |
| everything light or dark | `seance appearance light\|dark\|auto` |
| the workspace snapshotted | `seance session save [name]` |
| the workspace back after a reboot | `seance session restore [name]` |
| one dormant Claude conversation back | `seance resume <repo> [uuid]` |
| the displays listed | `seance screens` |

**`arrange` vs `organize` is the distinction to get right.** `arrange` picks the shape *and* the
display split itself, and deliberately ignores the `*` catch-all placement rule. `organize` takes
a shape from you and obeys `*` and pinned grids literally. If the user names a grid it is
`organize` or `place`; if they don't, it is `arrange`.

Neither moves a minimized pane. That is deliberate — ⌘M is the user's park gesture and seance
never overrides it.

## Tiling alone is not the job

Per-repo colour is the point, not a side effect. `arrange` and `organize` both perceive, place,
**and paint**. Never substitute a hand-rolled AppleScript or a one-off tiling script: the panes
come out uncoloured, and the work is not done. If colours look wrong, `seance arrange` repaints
everything.

## Diagnose from the log before theorising

`~/.config/seance/watcher.log` records every reflow, repaint and display event. Read it first —
it answers "why did my panes move?" directly and has repeatedly overturned plausible theories.

```bash
grep -n "display set changed\|organized \|known display arrangement\|settled back" \
  ~/.config/seance/watcher.log | tail -20
```

An `organized N/M` line names the shape per display role and lists any panes skipped for being
minimized.

## When windows move on their own

The watcher reacts to display changes. `seance reflow` reports and sets the policy:

| mode | behaviour |
|---|---|
| `new` (default) | re-tile only for a display arrangement seance has not laid out before. macOS restores window positions itself for a configuration it knows, and that restore is the user's real layout. |
| `always` | re-tile on every display change |
| `off` | never touch geometry (painting and the Claude Code theme sync continue) |

On any change the watcher waits for the geometry to settle before acting, because macOS emits
several transitions while negotiating a newly connected display.

## Unreadable terminal text

Claude Code paints its non-plain text (dim status lines, file paths, diffs) from its **own** fixed
palette chosen by `theme` in `~/.claude/settings.json`, not from the terminal. A light terminal
under a dark Claude theme is unreadable no matter what seance writes to the TTY. `seance
appearance <mode>` sets both. **Running sessions keep the theme they booted with** — the fix looks
like it failed if checked in the pane it was run from.

## Alfred palette

Type `s` in Alfred; items come from `seance json query "<q>"` on each keystroke. Grammar:
`s <repo>`, `s <repo> 3x2 1`, `s org 3x2`, `s arrange save <name>`, `s dark`, `s help`. Repos
prefix-match, and a leading `organize`/`place`/`arrange` scopes the rest of the query. Reinstall
with `seance alfred install` after changing the workflow — it bakes the node PATH in, because
Alfred runs scripts under a sterile environment.

Reproduce a palette complaint with `seance json query "<what they typed>"` before touching the
workflow. An empty `items` array is why Alfred shows nothing.

## Preflight

`scripts/doctor.sh` in this skill checks the things that silently invalidate everything else:
exactly one Ghostty instance, the watcher running the current build, and `dist/` newer than
`src/`. Run it before diagnosing anything that looks impossible.

## Modifying seance itself

Read `references/development.md` before editing the codebase. It covers the build-and-restart step
that makes a correct fix look inert if skipped, the invariants that must not be re-derived (window
targeting, batched bounds-setting, one Ghostty instance, minimized panes), the module boundaries,
and the testing conventions.
