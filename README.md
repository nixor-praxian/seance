# seance

> Summon and arrange [Ghostty](https://ghostty.org) terminal panes into named groups, grids, and per-project themes.

A *séance* is a gathering of ghosts. `seance` lets you call your Ghostty windows into formation — group `n` of them under a name, snap them into a grid, and dress each project in its own theme.

## Why

Ghostty has splits, tabs, themes, and (as of 1.3) an AppleScript dictionary. What it doesn't have:

- **Per-project themes.** Nothing about Ghostty's config is cwd- or project-aware.
- **Named groups of windows.** Groups exist only at the window-state level, not as a first-class user concept.
- **Deterministic grids on demand.** No "make these four windows a 2x2 right now."

Existing tools each solve one slice ([`ghostty-pane-splitter`](https://github.com/rikeda71/ghostty-pane-splitter) for grids, [`gtab`](https://github.com/Franvy/gtab) for named workspaces, AppleScript hacks for layouts). `seance` is the integration: groups + grids + themes, project-aware.

## Wishlist (the spec)

1. Project name → consistent theme (auto-applied)
2. Each theme has a `light` and `dark` variant; follows or overrides macOS appearance
3. Group `n` Ghostty windows under a name — not necessarily all open windows
4. One command for common grids: `2x1`, `1x2`, `2x2`, `2x3`, `2x4`, `3x3`, custom

## Status

**Pre-alpha.** Pure scaffolding. Layout math works on Linux; everything that touches Ghostty needs a Mac to test.

## CLI surface (v0)

```bash
# Groups — named sets of Ghostty windows
seance group new <name>          # create empty group
seance group add <name>          # add focused Ghostty window to <name>
seance group list                # list all groups
seance group show <name>         # show windows in group
seance group rm <name>           # delete group

# Layouts — arrange a group on screen
seance grid <name> <NxM>         # e.g. seance grid dev 2x2
seance grid <name> --cols 1,3    # custom column widths

# Summon — focus + arrange in one shot
seance summon <name>             # focus group, apply last layout

# Themes
seance theme set <name> <theme>  # assign theme to group (or project)
seance theme list                # list available Ghostty themes
seance theme apply <name>        # re-apply

# Project mode (v1)
seance project init              # writes .seance to current dir
seance project theme-for [path]  # print theme for cwd (for shell hooks)
```

## Architecture

```
src/
  cli.ts          # commander entry; thin wrappers over commands/
  layouts.ts      # pure rect math: (screen, NxM) -> rect[]
  groups.ts       # group CRUD over state.ts
  state.ts        # JSON persistence at ~/.config/seance/state.json
  ghostty.ts      # AppleScript + ghostty IPC bridge (macOS only)
  themes.ts       # theme assignment, light/dark resolution
  types.ts        # shared types: Rect, Group, ProjectConfig
```

**Pure vs impure separation.** `layouts.ts`, `groups.ts`, `state.ts`, `themes.ts` are pure TS, testable on Linux. `ghostty.ts` is the only macOS-bound module; it shells out to `osascript` and the `ghostty` CLI.

## Dev

```bash
npm install
npm run dev -- group list      # run from source
npm run build && ./bin/seance.mjs group list
npm test                       # vitest on pure modules
npm run typecheck
```

## Roadmap

- **v0**: scaffolding, layout math, group state, AppleScript stubs
- **v0.1**: working `group add` + `grid 2x2` on a Mac
- **v0.2**: theme assignment + Ghostty IPC theme swap
- **v1**: project mode + `chpwd` shell hook + `.seance` config files
- **v1.1**: persistent groups across Ghostty restarts (window-title tagging)

## Prior art

- [Rectangle](https://github.com/rxhanson/Rectangle) — general macOS window manager. Use it alongside.
- [macpane](https://github.com/Gigaxel/macpane) — i3-style tiler. Inspiration for planner/applier split.
- [ghostty-pane-splitter](https://github.com/rikeda71/ghostty-pane-splitter) — grid command, scoped to a single Ghostty window.
- [gtab](https://github.com/Franvy/gtab) — named Ghostty workspaces (window-level).

## License

MIT.
