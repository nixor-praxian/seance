# seance

> A gathering of ghosts. Summon and arrange [Ghostty](https://ghostty.org) terminal windows into named groups, tile them into screen-proportional grids, and dress each group in its own per-window color palette — all from one CLI.

`seance` is a macOS-only command-line tool for working with multiple Ghostty windows as a coherent unit. Where Ghostty's built-ins handle splits, tabs, and themes per app, seance adds a layer above: named groups of *separate* top-level windows, deterministic grids on demand, save-and-restore of entire window layouts, and per-window theme application that lets two groups sit on screen at the same time with visibly different palettes.

## Key features

- **Groups** — name a set of Ghostty windows (`seance group add dev --slot 1`); a group survives the rest of the session as a first-class object.
- **Grids** — `seance grid dev 2x2` lays out the group as four equal panes, or `--cols 1,3` for custom column weights.
- **Multi-display** — `seance screens` lists every connected display; `seance grid dev 2x2 --screen 1` tiles a group onto a specific monitor, remembered per-group by a stable display id so `summon` puts it back there.
- **Self-healing layout** — `seance gather dev` re-tiles the windows it can reach and names the ones that drifted onto another macOS Space (with the command to recover each), instead of silently leaving them.
- **Save / restore** — `seance save dev` emits a self-contained, human-readable AppleScript that spawns the same windows in the same cwds at the same rects, days later, in any state.
- **Per-window theming** — `seance theme apply dev` paints the group's theme into each window via OSC palette sequences, so different on-screen groups can run different palettes simultaneously.
- **Central inspection** — `seance windows --probe --assign` enumerates every Ghostty window with its tty, foreground command, cwd, and current group assignment, then assigns them to groups interactively.
- **Light/dark aware** — themes are stored as `{ dark, light }` pairs; the active variant follows macOS appearance automatically.

## Why it exists

Ghostty 1.3+ ships an AppleScript dictionary, but it deliberately doesn't expose the things you need to orchestrate windows from outside: no `position`/`size` properties, no per-window theme switch, no API for "make these four windows a 2×2 grid right now." Seance fills that gap by treating *named multi-window groups* as the primary object — and adds save/restore and per-window theming on top.

## Table of contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [Command reference](#command-reference)
- [Architecture](#architecture)
- [State and file layout](#state-and-file-layout)
- [Environment variables](#environment-variables)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

## Prerequisites

- **macOS** — seance shells out to `osascript` and reads macOS-only paths. Linux/Windows are not supported.
- **Ghostty 1.3 or newer** — older versions don't expose the AppleScript dictionary seance needs (`id of window`, `perform action`, etc.). Get it from <https://ghostty.org>.
- **Node.js 18 or newer** — uses ESM, `node:fs/promises`, and other modern features. The bin shim is `#!/usr/bin/env node`.
- **Accessibility permission for Ghostty (and your terminal multiplexer/IDE that launches seance)** — seance moves windows via System Events, which requires Accessibility access. Grant it under **System Settings → Privacy & Security → Accessibility**. macOS will prompt the first time you run a `grid` or `summon` command.
- **A `ghostty` CLI on `PATH`** (optional but recommended) — `seance theme list` shells out to `ghostty +list-themes`. Without it, theme listing won't work, but everything else will.

## Installation

### Option 1 — global install from a local clone (recommended for now)

```bash
git clone https://github.com/nixor-praxian/seance.git
cd seance
npm install
npm link              # creates a global `seance` symlink pointing at this checkout
seance --version      # → 0.0.1
```

`npm link` is the recommended path while seance is pre-release: your edits apply live to the global binary, no rebuild-and-reinstall cycle. To remove later: `npm unlink -g seance`.

### Option 2 — local-only (no global binary)

```bash
git clone https://github.com/nixor-praxian/seance.git
cd seance
npm install
npm run build
./bin/seance.mjs --version
```

### Option 3 — run from source (no build step)

```bash
npm install
npm run dev -- group list      # equivalent to `seance group list`
```

The `dev` script wraps `tsx src/cli.ts`.

## Quickstart

### One-shot wizard (recommended)

```bash
seance init dev
```

Opens an interactive flow: lists every Ghostty window with its tty/cmd/cwd, asks which to put in the group and in what order, asks for a theme pair, asks for a grid layout (default is the nearest-square for the picked count), then applies everything in one shot. From zero state to fully-arranged + themed group in a single command.

### Manual setup

```bash
# 1. Open four Ghostty windows (cmd+N four times).
# 2. In each window, run one of these — the slot number determines its grid cell:
seance group add dev --slot 1   # top-left
seance group add dev --slot 2   # top-right
seance group add dev --slot 3   # bottom-left
seance group add dev --slot 4   # bottom-right

# 3. From any window, tile them:
seance grid dev 2x2
```

Give the group a theme:

```bash
seance theme set dev "Rose Pine"
seance theme apply dev          # all 4 windows recolor in place
```

Save it for later:

```bash
seance save dev                 # writes ~/.config/seance/saves/dev.applescript
cat ~/.config/seance/saves/dev.applescript    # inspect, edit, share
osascript ~/.config/seance/saves/dev.applescript    # restore on a fresh Mac with no seance installed
# or:
seance restore dev --rebind     # restore via seance and re-bind to the group
```

Inspect what Ghostty currently has open:

```bash
seance windows --probe          # table with ghostty id, tty, foreground cmd, cwd, group
seance windows --probe --assign # same table, then prompts for `<idx> <group> [slot]` lines
```

## Command reference

### Wizard

| Command | Description |
|---|---|
| `seance init [name]` | Interactive flow: pick windows from a probed table, pick a theme pair, pick a layout, apply everything. `--no-theme` and `--no-grid` to opt out of either step. |

### Groups

| Command | Description |
|---|---|
| `seance group new <name>` | Create an empty group. |
| `seance group add <name> [--slot N]` | Add the *current* shell's Ghostty window to `<name>` at slot `N` (1-indexed, row-major). Slot defaults to the next free integer. |
| `seance group list` | List all groups with their window counts, current layout, and theme. |
| `seance group show <name>` | Show each window in the group with its slot, ghostty id, tty path, and title. |
| `seance group rm <name>` | Delete a group. |

### Layout

| Command | Description |
|---|---|
| `seance grid <name> <NxM>` | Tile the group as N columns × M rows of equal cells. |
| `seance grid <name> --cols 1,3 [--rows N]` | Custom column weights — `1,3` makes column 1 take 25% and column 2 take 75%. |
| `seance grid <name> [...] --screen <n>` | Tile onto display `<n>` (see `seance screens`). The choice is saved per-group as a stable display id; falls back to main with a notice if that monitor is unplugged. |
| `seance grid <name> [...] --gap 8 --padding 12` | Add pixel gap between tiles / outer padding from the screen edge. |
| `seance summon <name>` | Activate Ghostty and re-apply the group's last-used layout, on its saved display. |
| `seance gather <name>` | Re-tile the windows reachable on the current Space; report any stranded on another Space (with how to recover them). |
| `seance screens` | List connected displays — index, stable id, size, position, role — for use with `grid --screen`. |

### Save / restore

| Command | Description |
|---|---|
| `seance save <name> [path]` | Emit a self-contained AppleScript that recreates the group's windows fresh: spawns N new Ghostty windows in the saved cwds and positions each at the saved rect. Defaults to `~/.config/seance/saves/<name>.applescript`. |
| `seance restore <name> [--rebind]` | Run the saved AppleScript via `osascript`. With `--rebind`, snapshot ghostty window ids before/after, re-probe TTYs, and update the group's bindings to point at the newly spawned windows. |

### Windows (central inspection)

| Command | Description |
|---|---|
| `seance windows` | Plain list of every Ghostty window: AX index, state (position/size or `min`), title. |
| `seance windows --probe` | Adds Ghostty id, TTY path, current `GROUP:SLOT` if assigned, and foreground command (via `ps` against the tty). |
| `seance windows --probe --assign` | Same table, then prompts `<idx> <group> [slot]` lines on stdin — blank line to commit. Auto-creates groups if needed, auto-assigns next free slot if omitted. |

### Themes

| Command | Description |
|---|---|
| `seance theme list-pairs` | List registered theme *pairs* (name → dark / light). Seven curated pairs are seeded on first load. |
| `seance theme list` | List every Ghostty theme name available (shells out to `ghostty +list-themes`). |
| `seance theme register <name> --dark <X> --light <Y>` | Register or overwrite a pair. |
| `seance theme set <group> <pair-name>` | Assign a theme pair to a group. |
| `seance theme apply <group>` | Paint the group's pair into each of its windows via OSC palette sequences. Resolves dark vs light via the current macOS appearance. |
| `seance background <group> <color>` | Set a per-group background override (e.g. `#2e4636`) painted on top of the theme — survives `theme apply`/`use`. Pass `none` to clear. |

### Meta

| Command | Description |
|---|---|
| `seance where` | Print the absolute path to seance's state file. |
| `seance --version` | Print version. |
| `seance --help`, `seance <cmd> --help` | Built-in help. |

## Architecture

### Module layout

```
src/
├── cli.ts          commander entry; subcommand wiring; self-invoke guard for `tsx`
├── layouts.ts      pure rect math: (screen, NxM) → rect[]
├── groups.ts       group CRUD over the state object
├── state.ts        JSON persistence at $SEANCE_HOME/state.json; seeds builtin themes
├── themes.ts       theme pair registry + Ghostty theme file parser + builtin 7 pairs
├── save.ts         emits restore-time AppleScript
├── ghostty.ts      osascript / JXA / TTY bridge (the only macOS-bound module)
└── types.ts        Rect, Group, WindowRef, ThemePair, SeanceState
```

`layouts.ts`, `groups.ts`, `state.ts`, `themes.ts`, and `save.ts` are pure TypeScript and testable on Linux. `ghostty.ts` is the only module that shells out to `osascript` or writes to TTYs. The CLI composes them.

### How window targeting actually works

This was the hard problem. Naïve approaches don't work:

- **Ghostty's `id` of a window** is `tab-group-XXXX` (the NSWindowTabGroup id), not a property System Events can address.
- **System Events' `window <N>`** is a 1-based index into the AX z-ordered window list — frontmost first. Moving a window changes the order.
- **`AXIdentifier`** on Ghostty's AX window is the literal string `"TerminalWindowRestoration"` (the NSWindow autosave name), identical for every Ghostty window.
- **Window title** is shared across Ghostty windows running similar shells / Claude sessions, so name-based lookup collides.

Seance's solution is **sentinel-via-TTY targeting**:

1. At `group add` time, capture the calling shell's controlling TTY (`/dev/ttysNNN`) via the `tty` command, with `stdin: 'inherit'` so the child sees the same controlling terminal as seance itself.
2. At tile / theme / save time, write a unique OSC 2 title sentinel (`⎈seance:<stamp>:<i>`) to each TTY via `fs.writeFile('/dev/ttysNNN', ESC + ']2;' + sentinel + BEL, { flag: 'a' })`. Ghostty's PTY master receives the bytes and updates the window title.
3. Wait ~200ms for the title to propagate to AX.
4. In one System Events AppleScript, look up each window by sentinel: `first window whose name is "⎈seance:..."`. Capture stable references first, *then* apply all moves — never resize one window at a time, because the z-order shuffles between calls.

This sidesteps every namespace mismatch and gives us deterministic per-window targeting from any state.

### Why batched moves matter

`setWindowBounds(plans[])` takes an array, not a single window+rect. Single-window calls in a loop break because each `position` set promotes the moved window to frontmost, shifting `window 1` for the next iteration. The batched script captures all references first, then applies all rects.

### Why `NSScreen.visibleFrame` via JXA, and how multi-display works

`listScreens()` uses `osascript -l JavaScript` to enumerate `NSScreen.screens`, reading each display's `visibleFrame` (which excludes the menu bar and Dock automatically — Finder's `bounds of window of desktop` returns the *full* display, so tiles would land under the menu bar). `visibleFrame` is in Cocoa coordinates (bottom-left origin, y-up, one global space). The pure `cocoaFramesToAx` helper flips each into AX coordinates (top-left, y-down), anchored to the **primary** display's full frame height — so a monitor sitting above/left of the primary correctly lands at negative AX y.

A group remembers its target monitor by **`CGDirectDisplayID`** (`group.displayId`), not the `NSScreen.screens` array index. The index is volatile — the array reorders when keyboard focus moves between displays, and the ids themselves re-enumerate when a display reconnects — so persisting an index would tile a group onto the wrong monitor. `grid --screen <n>` resolves the index to a display id at run time and stores *that*; `summon`/`gather` resolve it back, falling back to the main display (with a notice) when the saved monitor is unplugged.

### Why themes apply per-window via OSC, not globally via config

Ghostty's `theme = light:X,dark:Y` config is global. To have two groups visible at the same time with different palettes (the user-visible point of per-group theming), we read Ghostty's theme files at `/Applications/Ghostty.app/Contents/Resources/ghostty/themes/<name>`, parse the palette + bg + fg + cursor, and write `OSC 4` / `OSC 10` / `OSC 11` / `OSC 12` sequences to each window's TTY. Ghostty's config is never touched.

### Why `--rebind` exists

After `restore`, the spawned windows are *new* — their TTYs and Ghostty ids differ from the saved state. `--rebind` snapshots ghostty's window-id set before+after the spawn, probes the new ones, and matches each new window back into the group's slots by cwd. Without it, the restored windows exist but seance doesn't know about them.

## State and file layout

```
~/.config/seance/
├── state.json                  groups, projects, themes registry
└── saves/
    └── <group>.applescript     self-contained restore scripts
```

`state.json` shape:

```json
{
  "version": 1,
  "groups": {
    "dev": {
      "name": "dev",
      "windows": [
        {
          "windowId": "tab-group-600003c30510",
          "ttyPath": "/dev/ttys003",
          "slot": 1,
          "cwd": "/Users/you/projects/myrepo"
        }
      ],
      "lastLayout": { "cols": 2, "rows": 2 },
      "themeName": "Rose Pine",
      "createdAt": "...",
      "updatedAt": "..."
    }
  },
  "projects": {},
  "themes": {
    "Rose Pine": { "dark": "Rose Pine", "light": "Rose Pine Dawn" }
  }
}
```

On first load, `state.themes` is seeded with the 7 curated builtin pairs (see `src/themes.ts:BUILTIN_THEME_PAIRS`). Any pair you `theme register` later overlays the builtin.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `SEANCE_HOME` | Override the state directory. Used by the test suite for isolation. | `~/.config/seance` |

## Development

```bash
npm install
npm run dev -- group list      # run from source via tsx
npm run build                  # compile TypeScript → dist/
npm run typecheck              # strict typecheck, no emit
npm test                       # vitest run (all suites)
npm run test:watch             # vitest watch mode
npm link                       # symlink global `seance` → this checkout
```

Strict TypeScript is on: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`. The bin entry (`bin/seance.mjs`) loads the built `dist/cli.js`, while `tsx` runs the TS source directly via a self-invoke guard at the bottom of `src/cli.ts`.

## Testing

```bash
npm test
```

Four suites, currently 37 tests:

```
src/
├── layouts.test.ts     pure rect math (tileGrid, tileCustomColumns, parseGrid, parseCustomColumns)
├── ghostty.test.ts     pure helpers (looksLikeShellDefaultTitle)
├── themes.test.ts      pure helpers (parseThemePalette, BUILTIN_THEME_PAIRS, resolveTheme)
└── cli.test.ts         black-box CLI: spawns `tsx src/cli.ts` in an mkdtemp dir
                        with SEANCE_HOME isolated; exercises group lifecycle,
                        save/restore error paths, theme list-pairs / register / apply
```

Tests that would require Ghostty / System Events are deliberately *not* exercised in CI — they live behind manual verification recipes in pull requests (see the README of each PR for the relevant smoke test).

The black-box CLI tests use `mkdtemp` + `SEANCE_HOME` env injection — no state file is created until the test asks for one, and each test gets a fresh temp dir.

## Troubleshooting

### "no focused Ghostty window"

`seance group add` reads Ghostty's *front* window. If Ghostty isn't frontmost when you run the command, the lookup returns nothing. Click the Ghostty window first, then re-run.

### Windows don't move when I run `seance grid`

Most common: Ghostty (or the terminal you launched `seance` from) doesn't have **Accessibility** permission. Grant it under **System Settings → Privacy & Security → Accessibility**, then retry. macOS usually prompts on the first attempt — but if you dismissed it, you have to enable it manually.

### `seance grid` moves *other* windows that aren't in the group

You're on a seance version before TTY-sentinel targeting landed. Update, then re-add the affected windows with `seance group rm <name> && seance group add <name> --slot N` from each shell. The fix relies on per-window TTY capture, which older entries don't have.

### `seance save` says "no windows in '<group>' have slot+tty+cwd"

The group still contains pre-cwd entries. Re-add each window with `seance group add <name> --slot N` from inside the shell you want to capture. The cwd is captured from the calling shell's `process.cwd()`.

### `seance theme apply` errors with "failed to load Ghostty theme"

The theme name in the registered pair must match an actual file at `/Applications/Ghostty.app/Contents/Resources/ghostty/themes/<name>` exactly (case- and space-sensitive). Run `seance theme list` to see what Ghostty knows about, or `ls "/Applications/Ghostty.app/Contents/Resources/ghostty/themes/"` directly.

### Window titles flash `⌬probe:ttysNNN` after `windows --probe`

Expected — that's the probe sentinel. Your shell or Claude Code will reset the title on the next prompt redraw.

### `seance restore` spawns windows but they're not in the group

Add `--rebind`: `seance restore <name> --rebind`. Without it, restore just runs the script; the new windows exist but seance doesn't track them.

### A pane "disappeared"

It's almost certainly stranded on another macOS Space, not closed — its shell/process is still alive (check `ps`). This happens when an external display disconnects (especially one that cycles on/off): the windows that lived on it get left on a Space with no screen. macOS Accessibility only sees the *current* Space, so seance can't pull it back automatically. Open **Mission Control** (F3) and click the window onto your current Space, then `seance gather <group>` to re-tile it. `gather` also lists which windows are stranded and how to recover each.

### `seance windows --probe` shows no TTY / command columns

On Ghostty 1.3.x the AppleScript dictionary only exposes one window, so the probe resolves windows purely through System Events — which only sees the **current Space**. Windows on other Spaces won't appear. Bring them over (Mission Control) and re-run. (If you're on a build where it returned *zero* windows entirely, update — that was a bug where probe required a Ghostty window id it could no longer get.)

## Roadmap

- **v0.x** ✅ targeting, groups, grids, windows command, save/restore, per-window themes, **multi-display tiling (`grid --screen`, `screens`), and `gather` for Space-stranded windows** (where we are now)
- **v1** — project mode: auto-apply a theme + layout on `chpwd` via a shell hook; `.seance` files in repos
- **v1.1** — cross-restart persistence: re-bind a saved group to live windows by cwd-matching when TTYs are gone
- **future** — auto-arrangement (same project → adjacent slots), a `gather --all` that restores every group's row + theme after a display cycle, the `seance follow-appearance` daemon

## License

MIT.
