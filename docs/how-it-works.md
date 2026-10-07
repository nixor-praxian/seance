# How it works

seance keeps no list of windows. Every run starts by looking at what is open, decides from a small set of remembered rules, then moves and paints.

## Contents

- [Why nothing is registered](#why-nothing-is-registered)
- [Panes and their repos](#panes-and-their-repos)
- [Colours](#colours)
- [Displays](#displays)
- [Grids](#grids)
- [Window targeting](#window-targeting)
- [Paint](#paint)
- [Code layout](#code-layout)

## Why nothing is registered

seance 1.x stored window references, and they kept going bad. A terminal's TTY dies with its shell and macOS reuses the name for the next window, which may be in another repo. Display IDs change on reconnect. Groups you registered by hand ended up pointing at the wrong panes. 2.0 stopped storing anything that can go stale. What it remembers is policy: which colours a repo wears, which rules you set, how small a pane may get. None of that refers to a particular window.

## Panes and their repos

`ps` lists the TTYs that belong to Ghostty, and for each one, the shell `login` started. `lsof` reads that shell's working directory. seance walks up from there to the enclosing git work tree, and a linked worktree is folded into the repo it belongs to. A folder outside any repo stands for itself, and your home folder reads as `home`.

seance reads the shell because it lives as long as the pane. An earlier version read the pane's newest process instead, which on a busy Claude Code pane is often a tool call that exits a moment later. When it exited between `ps` and `lsof`, the pane looked like it lived in `home` and was repainted, over and over.

Throwaway worktrees created by agent runs (named `temp_git_<digits>_<id>`) get no identity at all, so they can't use up colours.

None of this needs Accessibility, so it's fast enough to run on every keystroke in the Alfred palette.

## Colours

Each repo gets a theme pair: one Ghostty theme for dark mode, one for light. The first time seance sees a repo, it gives it a pair that no open repo is wearing, preferring the pairs used least. Catppuccin is left out of the rotation because it's a common global Ghostty theme, so it's what an unpainted window already looks like. After that the pair never changes.

Many dark themes share nearly the same near-black background, so each repo also gets a background tint, chosen once to stand apart from the repos open beside it. The choice weighs hue over lightness: by plain lightness, black and near-black count as different, and on screen they aren't. If two open repos still share a pair, one of them is shaded slightly while it's on screen. The shade is never saved.

Before a palette is painted, every colour is checked against the background that gets painted. A colour below the minimum contrast (4.5:1 unless you change it) is made lighter or darker until it passes, so its hue survives. One Half Light, a Ghostty bundled theme, ships a bright white at 1.04:1 against its own background.

## Displays

Displays are given roles from their current geometry each run. `main` is the display macOS treats as main, the one with the focused window. `external.left` and `external.right` are the nearest external on each side of it. Further displays are labelled `display <n>` and remembered by UUID.

The UUID is the one identity macOS keeps for a display across reconnects. The display ID and the screen index don't survive: a DisplayLink monitor gets a new ID every time it's plugged in, because the DisplayLink software creates it rather than finding it on a port.

`organize` sends each repo to the display its rule names, with `*` as the catch-all (by default, everything on `main`). A rule for a display that isn't connected falls back to another external, then to `main`.

`arrange` ignores the catch-all and balances repos without a rule across every display, by how many readable panes each one fits. It remembers where each repo went, so repos don't hop between displays from run to run. A display holding a pinned repo is kept for pinned repos.

## Grids

`organize` uses columns of at least `minPaneWidth` (384 points by default): a display with n panes gets `min(n, floor(width / 384))` columns and as many rows as it needs. A `place` pin overrides that for its repo.

`arrange` splits each display along its long side into one block per repo, sized by pane count, so a repo's panes always touch. Within a block it picks the grid whose panes come closest to 9:16. A pane ends up about as portrait as the display is landscape.

## Window targeting

Ghostty and macOS offer no shared name for a window:

- Ghostty's window `id` names a tab group that System Events can't address.
- System Events numbers windows by stacking order, which changes as they move.
- Every Ghostty window has the same `AXIdentifier`: `TerminalWindowRestoration`.
- Titles collide, and Claude Code rewrites its title several times a second.

So seance writes a unique title straight to the pane's TTY, waits until System Events reports the new title, and finds the window by that title. All windows are found first and moved second, in one script, because moving a window brings it to the front and throws off the next lookup. A window that isn't found is retried for up to five rounds, then reported. After moving, seance reads each window's position and size back and retries one that didn't land.

Ghostty sizes windows to whole character cells, so a window rarely ends up exactly the size requested. seance checks the origin within a 40-point tolerance and nudges a window that grew past its tile back onto its own display.

Accessibility only sees the current macOS Space. A window left on another Space, usually after a display disconnects, can't be moved until you bring it over with Mission Control. `arrange` and `organize` list such panes with the command running in each.

## Paint

Ghostty's theme setting is global. To give each pane its own colours, seance reads the theme files bundled with Ghostty and writes the palette straight to each pane's TTY as escape sequences (OSC 4, 10, 11 and 12). Nothing in Ghostty's config changes. This also reaches windows on other Spaces, because a TTY is reachable whichever Space its window is on.

Claude Code draws its interface in its own fixed colours, picked by the `theme` key in `~/.claude/settings.json`, so no terminal palette can reach it. `seance appearance` sets that key to match, and the watcher sets it again on every pass, because Claude Code rewrites the whole file when any setting changes. A running Claude Code session keeps the theme it started with until you restart it.

## Code layout

```text
src/
├── cli.ts          commands, and the arrange, organize and watch passes
├── policy.ts       repo identity, display roles, placement, theme assignment
├── arrange.ts      repo blocks, grid choice, balancing across displays
├── contrast.ts     contrast repair and background tints
├── layouts.ts      rectangle maths for a grid on a display
├── themes.ts       theme pairs and Ghostty theme file parsing
├── sessions.ts     Claude Code transcripts for save, restore and resume
├── cheatsheet.ts   the cheatsheet text
├── state.ts        reading, migrating and writing state.json
├── groups.ts       legacy groups
├── save.ts         legacy restore scripts
├── ghostty.ts      everything that touches macOS: osascript, JXA, TTYs, ps, lsof
└── types.ts        shared types
```

`policy.ts`, `arrange.ts`, `contrast.ts` and `layouts.ts` are pure. `state.ts`, `themes.ts` and `sessions.ts` read and write local files but call no macOS APIs. All of them are tested without a Mac; only `ghostty.ts` needs one.
