# seance

> A gathering of ghosts. A summonable workspace for [Ghostty](https://ghostty.org) on macOS: panes auto-organize by repo, every project wears its own colors, an Alfred palette drives it all, and a background watcher keeps it true — across one display or three.

Run one command — `seance organize` — and every Ghostty window is identified by the repo it's working in, placed on the right display, tiled into a sensible grid, and painted with that repo's color palette. Open a new pane in a new repo and it gets its own distinct theme within seconds, automatically. Unplug your externals and everything reflows to the laptop. Nothing to register, nothing to name, nothing that goes stale.

## Key features

- **Perception, not bookkeeping** — a pane's identity is derived live from its working directory (`repo = basename(cwd)`), rediscovered at every command. There are no groups to maintain and no saved window references to rot.
- **One verb** — `seance organize` perceives → colors → places → tiles → paints. Idempotent; safe to run any time, from the CLI, Alfred, or the watcher.
- **Colors per project** — each repo is assigned a theme pair from a curated ring, collision-free among live repos, sticky across days. Applied per *window* via OSC sequences, so five repos can sit side by side in five palettes.
- **Policy, not coordinates** — displays are addressed by *role* (`main`, `external.left`, `external.right`), computed from live geometry at each run. Layouts derive from one number (`minPaneWidth`). One screen or three, docked or nomad: same rules, correct result.
- **Imperative override that sticks** — `seance place zeus 3x3 --screen 1` tiles now *and* records the choice as policy, so every future organize honours it. `place zeus auto` clears it.
- **Alfred palette** — type `s` in Alfred: Organize, Focus any repo, or the grid grammar (`s zeus 3x3 1`). Results are generated from live perception on each keystroke.
- **Watcher daemon** — a launchd agent that paints new panes with their repo's colors within ~2s and re-organizes when the display set changes. Never re-tiles spontaneously otherwise.
- **Space-aware** — windows stranded on another macOS Space (the classic external-display-disconnect failure) are reported with their foreground command instead of silently skipped — and still get painted, since OSC crosses Spaces even when Accessibility can't.
- **Light/dark aware** — themes are `{ dark, light }` pairs; resolution follows macOS appearance, or pin it with `seance appearance dark`.

## Why it exists

Ghostty's AppleScript dictionary deliberately doesn't expose what window orchestration needs: no `position`/`size`, no per-window theming, no "make these a grid." seance built that layer — and then learned the harder lesson: **stored window references rot by design.** TTYs die and get recycled onto other repos' windows; display IDs re-enumerate on reconnect; manually-registered groups decay into pointers at the wrong panes. seance 2.0 inverts the model: identity is *perceived* (`ps` + `lsof` → tty → cwd → repo) at every act and never persisted. The only long-term state is policy — which colors, which rules, one layout number. Policy can't go stale. (The full design rationale lives in [`docs/vision.md`](docs/vision.md).)

## Table of contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [How it decides (the model)](#how-it-decides-the-model)
- [Command reference](#command-reference)
- [The Alfred palette](#the-alfred-palette)
- [The watcher](#the-watcher)
- [Legacy commands (v1)](#legacy-commands-v1)
- [State and file layout](#state-and-file-layout)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

## Prerequisites

- **macOS** — seance shells out to `osascript` and reads macOS-only paths. Linux/Windows are not supported.
- **Ghostty 1.3 or newer** — from <https://ghostty.org>.
- **Node.js 18 or newer**.
- **Accessibility permission** — seance moves windows via System Events. Grant it to the terminal you run seance from (and let the prompt through the first time the watcher reorganizes) under **System Settings → Privacy & Security → Accessibility**.
- **Alfred 5** (optional) — for the palette front-end. Everything works from the CLI without it.
- **A `ghostty` CLI on `PATH`** (optional) — only `seance theme list` needs it.

## Installation

```bash
git clone https://github.com/nixor-praxian/seance.git
cd seance
npm install
npm run build
npm link              # global `seance` symlink pointing at this checkout
seance --version      # → 2.0.0
```

Then, optionally:

```bash
seance alfred install   # install the Alfred workflow (keyword: s)
seance watch --install  # install + start the launchd watcher
```

To remove later: `seance watch --uninstall`, `npm unlink -g seance`, and delete the workflow from Alfred.

## Quickstart

Open a few Ghostty windows in different project directories. Then:

```bash
seance organize
```

```
theme assigned: myapp → Rose Pine
theme assigned: infra → Gruvbox Material
organized 5/5 pane(s), painted 5 (dark)
  main            3x1   myapp×2, infra
  external.left   2x1   docs, scratch
```

That's the whole workflow. Each repo got a distinct palette (sticky — same colors tomorrow), panes were tiled by display, and re-running any time is safe. Want a specific shape for one repo?

```bash
seance place myapp 2x2 --screen 1   # tile myapp 2x2 on display 1, and remember that
seance place myapp auto             # forget it, back to auto-grid
```

With the watcher installed you generally never type anything again: new panes are painted as they appear, and display changes trigger a re-organize.

## How it decides (the model)

Three layers, evaluated fresh on every run:

**1. Perception.** `ps` finds every Ghostty child TTY; `lsof` resolves each foreground process's cwd; `repo = basename(cwd)` (home directory → `home`). No Accessibility calls, ~50ms. Windows are only touched later, at act time, via the sentinel technique described under [Architecture](#architecture).

**2. Policy** — the only persisted state:

- **Identity** (`repo → theme pair`): assigned from a ring of curated pairs the first time a repo is seen, then sticky. Assignment prefers globally-unused pairs, guarantees no two *live* repos share one, and excludes **Catppuccin** — a common global Ghostty default, i.e. what an unpainted window already looks like. Manual pins (`"pinned": true`) always win.
- **Placement rules** (`repo → display role [+ grid]`): ordered, first match wins, `"*"` wildcard, default `* → main`. Roles are computed from live geometry each run: `main` is the focused display; externals sorted by x become `external.left` / `external.right`. A rule pointing at a missing role degrades gracefully (other external, then main) — so a three-display policy is still correct on a laptop in a café.
- **Layout** (`minPaneWidth`, default 384px): a display with n panes gets `cols = min(n, ⌊width / 384⌋)` columns, rows to fit. That one number yields 5×1 on a 1920 external, 4×2 for eight panes on a 16″ MacBook — and a `place` pin overrides it per repo (ignored automatically if the repo outgrows the pinned grid).

**3. Actuation.** All target windows are branded via their TTYs, captured as AX references *first*, then moved in one batch; palettes are written per-window as OSC sequences. Failures are per-window, reported, and never abort the batch.

## Command reference

### seance 2.0

| Command | Description |
|---|---|
| `seance organize` | Perceive every live pane, derive repo identity, assign colors, place by policy, tile, paint. Idempotent. |
| `seance place <repo> <NxM> [--screen n]` | Tile the repo's panes now **and** pin `{display role, grid}` as its placement rule. `place <repo> auto` clears the grid pin. |
| `seance focus <repo>` | Raise and focus the repo's first live pane. |
| `seance screens` | List connected displays — index, stable id, size, position, role. |
| `seance appearance <dark\|light\|auto>` | Pin theme resolution to an appearance (or follow macOS), repaint everything. |
| `seance json query "<q>"` | Machine-readable palette items (Alfred Script Filter JSON). |
| `seance watch` | Run the watcher loop in the foreground (see [The watcher](#the-watcher)). |
| `seance watch --install` / `--uninstall` | Install/remove the launchd agent. |
| `seance alfred install` | Install the Alfred workflow, baking in the correct PATH for your node install. |
| `seance where` | Print the state file path. |

### Identity and appearance

| Command | Description |
|---|---|
| `seance theme list-pairs` | Registered theme pairs (name → dark/light variant). |
| `seance theme register <name> --dark <X> --light <Y>` | Add or overwrite a pair (grows the assignment ring). |
| `seance theme list` | Every theme Ghostty ships (via `ghostty +list-themes`). |

To hand-pick a repo's colors, edit `identity` in the state file (see below) or pre-assign with the legacy `theme set` on a group named after the repo — `organize` migrates repo-named group themes into identity on first run.

## The Alfred palette

Install once (`seance alfred install`), then type **`s `** in Alfred:

| You type | Item | Enter does |
|---|---|---|
| `s` | full menu | — |
| `s org` | Organize | full perceive → place → paint |
| `s myapp` | Focus myapp | raise + focus that repo |
| `s myapp 3x2 1` | Place myapp 3x2 on display 1 | tile + pin, like `seance place` |
| `s myapp auto` | Place myapp auto | clear the grid pin |
| `s dark` | Appearance dark | pin + repaint |

Repo names prefix-match (`s mya 3x2` works). Results come from live perception on each keystroke — expect a brief "Summoning…" while `ps`/`lsof` run. If the keyword does nothing after an install, see [Troubleshooting](#troubleshooting).

## The watcher

`seance watch --install` writes `~/Library/LaunchAgents/com.seance.watcher.plist` and starts it. The loop, every 2s:

- **New pane?** Assign its repo a theme if it's a new repo, and paint it. This is the "colors just happen" experience.
- **Display set changed?** (checked every 10s, debounced 3s) — run a full organize, so plugging in at your desk reflows the workspace.
- **Never** re-tiles outside those events — it won't yank windows around while you work.

Logs: `~/.config/seance/watcher.log`. Remove with `seance watch --uninstall`. The watcher runs the *built* CLI (`dist/cli.js`), so re-run `npm run build` after changing source (then `seance watch --uninstall && seance watch --install` to restart it).

## Legacy commands (v1)

The 1.x binding-based commands still exist and work: `group new/add/list/show/rm`, `grid <name> <NxM> [--cols] [--gap] [--padding] [--screen]`, `summon`, `gather`, `windows [--probe] [--assign]`, `init`, `save`/`restore [--rebind]`, `theme set/apply`, `background`, `use`. They operate on *stored* window references, which die with their shells and can be recycled onto other windows — the exact failure mode 2.0 was built to eliminate. Prefer `organize`/`place`; the legacy surface is scheduled for removal.

One legacy piece remains genuinely useful: `seance save <group>` emits a self-contained AppleScript that respawns windows in their cwds at their rects — until Phase 4's repo-keyed sessions replace it.

## State and file layout

```
~/.config/seance/
├── state.json        policy (identity, placement, layout) + legacy groups + theme registry
├── watcher.log       watcher output (if installed)
└── saves/            legacy save/restore scripts
```

The 2.0 fields of `state.json`:

```json
{
  "identity": {
    "myapp": { "pair": "Rose Pine" },
    "infra": { "pair": "Gruvbox Material", "bg": { "dark": "#2e4636", "light": "#eef4e8" }, "pinned": true }
  },
  "placement": [
    { "repo": "myapp", "role": "external.left", "grid": { "cols": 2, "rows": 2 } },
    { "repo": "*", "role": "main" }
  ],
  "layout": { "minPaneWidth": 384 },
  "appearance": "dark"
}
```

Everything here is safe to edit by hand; `organize` reads it fresh each run. Note what's *absent*: no TTYs, no window ids, no display ids, no coordinates — nothing that can go stale.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `SEANCE_HOME` | Override the state directory. Used by the test suite for isolation. | `~/.config/seance` |

## Architecture

### Module layout

```
src/
├── cli.ts          commander wiring; organize/place/watch composition
├── policy.ts       pure decision engine: repoOf, computeRoles, placePanes,
│                   autoGrid, assignThemes — fully unit-tested, no I/O
├── layouts.ts      pure rect math: (screen, NxM) → rect[]
├── themes.ts       theme pair registry + Ghostty theme file parser
├── state.ts        JSON persistence + policy seeding/migration
├── groups.ts       legacy group CRUD
├── save.ts         legacy restore-script emitter
├── ghostty.ts      the only macOS-bound module: osascript/JXA, TTY writes,
│                   perception (ps + lsof), batched AX window moves
└── types.ts        shared types
```

`policy.ts`, `layouts.ts`, `themes.ts`, `state.ts`, `groups.ts`, `save.ts` are pure and testable anywhere. `ghostty.ts` owns every shell-out.

### How window targeting actually works

The hard problem. Every naïve approach fails:

- **Ghostty's window `id`** is a tab-group id System Events can't address.
- **System Events' `window <N>`** is a z-order index that shuffles as windows move.
- **`AXIdentifier`** is the literal string `"TerminalWindowRestoration"` — identical for every Ghostty window.
- **Titles** collide across similar shells, and title-setting apps (e.g. Claude Code) rewrite them every few hundred ms.

seance's answer is **sentinel-via-TTY**: write a unique OSC 2 title sentinel directly to the window's TTY (burst 3× to win title races), wait a beat for AX to mirror it, then look the window up by title in System Events. Per-window capture happens in an AppleScript `try`, ALL references are captured before ANY rect is applied (a `position` set promotes the moved window to frontmost, so interleaving capture and move targets the wrong windows), and unresolved windows are retried up to 5 rounds then reported as stranded — one contested title never aborts the batch.

### Perception without Accessibility

`perceivePanes()` never touches AX: `ps -axo pid,ppid,tty,command` yields Ghostty's child TTYs; the deepest PID per TTY is the foreground process; `/usr/sbin/lsof` (absolute path — sterile PATHs like Alfred's don't include `/usr/sbin`, and a silent miss would collapse every repo to `home`) resolves each cwd. Fast enough to run on every Alfred keystroke.

### Displays: roles over ids over indices

`listScreens()` enumerates `NSScreen.screens` via JXA, reading each `visibleFrame` (excludes menu bar and Dock; Finder's desktop bounds don't) in Cocoa coordinates, flipped to AX coordinates by a pure helper anchored to the primary display's frame height — which is why a monitor above the primary lands at negative AX y. On top of that, 2.0 computes *roles* per run: the `NSScreen.screens` index reorders on focus changes, and even the "stable" `CGDirectDisplayID` re-enumerates when a display reconnects — both were observed rotting in practice. Roles derived from live geometry each time are the only representation that survives.

### Themes: per-window OSC, config untouched

Ghostty's `theme` config is global. To give each repo its own look *simultaneously*, seance parses Ghostty's bundled theme files (`/Applications/Ghostty.app/Contents/Resources/ghostty/themes/`) and writes `OSC 4` (16-color palette), `OSC 10/11/12` (fg/bg/cursor) to each window's TTY. This also means painting works on windows stranded on other Spaces — the TTY doesn't care about window visibility.

## Development

```bash
npm install
npm run dev -- organize        # run from source via tsx
npm run build                  # tsc → dist/
npm run typecheck              # strict, no emit
npm test                       # vitest, all suites
npm link                       # live-linked global binary
```

Strict TypeScript throughout: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`.

## Testing

```bash
npm test        # 5 suites, 69 tests
```

| Suite | Covers |
|---|---|
| `policy.test.ts` | the full decision engine: roles, placement, auto-grid, sticky/collision-free theme assignment |
| `layouts.test.ts` | rect math |
| `themes.test.ts` | theme file parsing, pair resolution |
| `ghostty.test.ts` | pure helpers |
| `cli.test.ts` | black-box: spawns the CLI in a temp `SEANCE_HOME`, exercises state lifecycle |

Anything requiring System Events / real TTYs / Ghostty is verified manually — documented per-PR, not simulated in CI.

## Troubleshooting

### Windows don't move

Accessibility permission is missing for whatever launched seance (your terminal; for the watcher, the prompt appears on its first reorganize). **System Settings → Privacy & Security → Accessibility.**

### The Alfred keyword `s` does nothing

Alfred didn't load the workflow. `seance alfred install` now triggers a reload itself; if you copied the workflow manually, run `osascript -e 'tell application id "com.runningwithcrayons.Alfred" to reload workflow "com.seance.palette"'` or restart Alfred.

### Every repo shows up as `home`

`lsof` failed, so no cwds resolved. seance calls it by absolute path (`/usr/sbin/lsof`) precisely for this; if you see it anyway, check that `/usr/sbin/lsof` exists and is executable. A bogus `home` entry may linger in `identity` — delete it from the state file.

### A pane "disappeared"

It's stranded on another macOS Space — its process is alive (`ps` will show it). Happens when an external display disconnects. Accessibility only sees the current Space, so seance reports these (with each one's foreground command) instead of moving them. Bring the window over via Mission Control, then `seance organize`.

### Terminal text is invisible ("clear on clear")

Claude Code (and apps like it) render with their *own* fixed theme and text color, ignoring the terminal's. Dark app + light terminal = invisible text, and no terminal palette fixes it. Match the terminal to the app: `seance appearance dark`.

### Two repos ended up with the same colors

Only possible via manual edits or pre-2.0 state (the assigner is collision-free among live repos). Run `seance organize` — collisions among live repos are detected and one side is reassigned. Pin the pair you care about with `"pinned": true`.

### `theme apply` / painting errors with "failed to load Ghostty theme"

The pair's variant names must exactly match files in `/Applications/Ghostty.app/Contents/Resources/ghostty/themes/`. `seance theme list` shows what exists.

### Window titles flash `⎈seance:…` or `⌬probe:…`

Expected — targeting sentinels. Active shells restore their titles within milliseconds; idle windows get a readable label (their repo name) written back.

## Roadmap

- **2.0** ✅ — perception over bindings: `organize`, `place`, `focus`, policy engine, Alfred palette, watcher daemon
- **2.1** — Phase 4 of [`docs/vision.md`](docs/vision.md): direct hotkey chords (⌥1…⌥9 via Alfred), repo-keyed session save/restore that captures each pane's command (including `claude --resume <uuid>`) so a workspace survives reboots
- **2.2** — legacy surface removal; workspaces (named multi-repo bundles)

## License

[MIT](LICENSE)
