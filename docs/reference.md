# Reference

Every command, the Alfred grammar, the state file and the environment variables. For the reasoning behind them, see [How it works](how-it-works.md).

## Contents

- [Layout commands](#layout-commands)
- [Colour and appearance](#colour-and-appearance)
- [Sessions](#sessions)
- [Watcher and setup](#watcher-and-setup)
- [Legacy commands](#legacy-commands)
- [Alfred palette](#alfred-palette)
- [State file](#state-file)
- [Environment variables](#environment-variables)

`seance <command> --help` prints the same information from the CLI itself. <!-- unverified: --help is built into commander, not defined in this repo -->

## Layout commands

| Command | What it does |
|---|---|
| `seance arrange` | Sort every active (not minimized) pane by repo, spread the repos across every connected display, tile each repo into one block shaped for its display, and paint. It picks the grid itself. |
| `seance arrange --in-place` | Same, but every pane stays on the display it's on. Useful for a fourth or fifth display. |
| `seance arrange --save <name>` | Record which display each repo is on now, as a named arrangement. Moves nothing. |
| `seance arrange <name>` | Apply a saved arrangement for this run. |
| `seance organize` | Perceive, place by your rules, tile, paint. Follows the `*` catch-all rule and pinned grids exactly. Never moves a minimized pane. |
| `seance organize <grid>` | Force a grid such as `3x2` for this run. Fails if a display's panes don't fit it. |
| `seance organize <grid> --screen <n>` | Apply the grid to one display only. |
| `seance organize <grid> --pin` | Keep the grid as a rule for the repos on the affected displays. |
| `seance organize auto` | Clear every pinned grid, then organize. |
| `seance place <repo> <grid> [--screen <n>]` | Tile the repo now and pin its grid and display. With `--screen`, the pin names that exact display (by UUID), so it can reach any screen. |
| `seance place <repo> auto` | Clear the repo's grid pin. |
| `seance focus <repo>` | Raise and focus the repo's first live pane. |
| `seance screens` | List displays: index, display ID, the first 8 characters of the UUID, size, position, and whether each is `main`, `primary` or `external`. |

A `<grid>` is `<cols>x<rows>`: `3x2` is three columns by two rows. A command fails if the grid has fewer cells than the panes it has to hold.

A display index is the number `seance screens` prints, counting from 0. It can change between runs, so pins store the display's UUID instead.

## Colour and appearance

| Command | What it does |
|---|---|
| `seance appearance <dark\|light\|auto>` | Pick the theme side for every repo, or follow macOS with `auto`. Repaints every open pane and sets Claude Code's own `theme` setting to match. |
| `seance contrast [ratio\|off]` | Minimum contrast ratio every palette colour must reach against its background (default 4.5). With no argument, audits the registered pairs. `off` paints themes exactly as they ship. |
| `seance theme list-pairs` | List the theme pairs repos are coloured from. |
| `seance theme register <name> --dark <theme> --light <theme>` | Add or replace a pair. Theme names must match files in Ghostty's bundled themes folder. |
| `seance theme list` | List every theme Ghostty ships. Needs the `ghostty` CLI. |

To choose a repo's colours yourself, change `pair` in its `identity` entry in the state file.

## Sessions

| Command | What it does |
|---|---|
| `seance session save [name]` | Record each pane's repo, folder and Claude Code conversation ID. Default name `latest`. |
| `seance session restore [name]` | Open whatever from the snapshot isn't already open, inside the running Ghostty, then organize. Defaults to `latest`, or the watcher's `auto` snapshot if you never saved. |
| `seance session restore --repo <repo>` | Restore one repo's panes only. |
| `seance session list` | List snapshots with their pane count, resumable conversations and save time. |
| `seance resume <repo> [id]` | Reopen one parked Claude Code conversation for a repo: the most recent one not already open, unless you give its ID. |

## Watcher and setup

| Command | What it does |
|---|---|
| `seance watch` | Run the watcher in the foreground. `--interval <ms>` sets the poll interval (default 2000). |
| `seance watch --install` | Install or reinstall the launchd agent `com.seance.watcher` and start it. Refuses to run from a temporary checkout. |
| `seance watch --uninstall` | Stop and remove the agent. |
| `seance reflow [always\|new\|off]` | What the watcher does when displays change. `new` (default) lays out only arrangements it hasn't seen. `always` lays out on every change that adds or moves a display. No mode lays out when a display is removed. `off` never moves windows. No argument prints the setting. |
| `seance alfred install` | Install the Alfred workflow, with your current Node on its `PATH`, and reload it. Re-run it after moving your Node install. |
| `seance cheatsheet [--alfred]` | Print the cheatsheet, or open it in Alfred. |
| `seance json query "<q>"` | The palette's results as Alfred Script Filter JSON. Shows what the palette offers for a query, without Alfred. |
| `seance where` | Print the path of the state file. |

## Legacy commands

The 1.x commands still work: `group`, `grid`, `summon`, `gather`, `windows`, `init`, `save`, `restore`, `theme set`, `theme apply`, `background` and `use`. They store window references, which break when a shell exits and can end up pointing at another repo's window. Use `arrange`, `organize`, `place` and `session` instead. Removal is planned.

## Alfred palette

| Type | Result | Enter does |
|---|---|---|
| `s` | The full menu | |
| `s arrange` | Arrange, plus each saved arrangement | Arrange |
| `s arrange <name>` | Arrange *name* | Apply that arrangement |
| `s arrange save <name>` | Save arrangement *name* | Record the current split, moving nothing |
| `s org` | Organize | Organize |
| `s org 3x2`, `s org 3x2 1` | Organize 3x2, on display 1 | Force that grid this run |
| `s organize myapp` | Organize myapp | Tile one repo in an automatic grid, clearing its pin |
| `s myapp` | Focus myapp, Restore myapp, Resume myapp with each conversation's title | Focus, restore or resume |
| `s myapp 3x2 1` | Place myapp 3x2 on display 1 | Same as `seance place` |
| `s myapp auto` | Place myapp auto | Clear the pin |
| `s dark`, `s light` | Appearance | Switch and repaint |
| `s save` | Save session | Snapshot as `latest` |
| `s restore` | Restore latest | Respawn what's missing |
| `s help` | Cheatsheet | Open it in Alfred |

Repo names match by prefix. A leading `organize`, `place` or `arrange` narrows the rest of the query instead of being matched as a repo name.

## State file

Everything seance remembers is in `~/.config/seance/state.json` (`seance where` prints the path). It's safe to edit by hand: every command reads it fresh.

```text
~/.config/seance/
├── state.json      rules, colours, saved arrangements and sessions
├── watcher.log     the watcher's output, if installed
└── saves/          scripts written by the legacy save command
```

The fields you're most likely to touch:

```json
{
  "identity": {
    "myapp": { "pair": "Rose Pine", "tint": 210 },
    "infra": { "pair": "Gruvbox Material", "bg": { "dark": "#2e4636", "light": "#eef4e8" }, "pinned": true }
  },
  "placement": [
    { "repo": "myapp", "role": "external.left", "display": "<display UUID>", "grid": { "cols": 2, "rows": 2 } },
    { "repo": "*", "role": "main" }
  ],
  "arrangements": { "desk": [{ "repo": "myapp", "role": "external.left" }] },
  "autoPlacement": { "docs": "external.right" },
  "layout": { "minPaneWidth": 384, "minPaneHeight": 440 },
  "appearance": "dark",
  "minContrast": 4.5,
  "reflowMode": "new"
}
```

- `identity`: each repo's theme pair, background tint (a hue in degrees, or `null` when its theme already stands out) and optional fixed background (`bg`). Written once per repo. `pinned: true` makes a repo keep its unshaded colour when another open repo shares its pair.
- `placement`: your rules, checked in order. `role` is `main`, `external.left` or `external.right`. `display` is a UUID written by `place --screen` and wins while that display is connected.
- `arrangements`: named sets of rules, applied only when you name one.
- `autoPlacement`: where `arrange` put each unpinned repo last time, so repos don't hop between displays. Delete it for a fresh balance.
- `layout`: the smallest pane seance makes, in points. `minPaneWidth` (default 384) applies to `organize` and `arrange`; `minPaneHeight` (default 440, and never lower) applies to `arrange` only.

## Environment variables

| Name | Required | Default | Purpose |
|---|---|---|---|
| `SEANCE_HOME` | No | `~/.config/seance` | Where seance keeps its state. The tests point it at a temporary folder. |
| `CLAUDE_CONFIG_DIR` | No | `~/.claude` | Where `seance appearance` and the watcher find Claude Code's `settings.json`. |
