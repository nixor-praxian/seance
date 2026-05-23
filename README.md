# seance

Tile and colour your [Ghostty](https://ghostty.org) panes by repo, across every display, on macOS.

Run `seance arrange` and every Ghostty pane is sorted by the repo it's working in. Each repo's panes are tiled together on a display, and each repo is painted in its own colours. Open a pane in a new repo and it's painted within a couple of seconds. Plug in a dock and the watcher lays out the new screens. You don't register anything: seance reads what's open on every run.

## Contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Install](#install)
- [Quickstart](#quickstart)
- [Everyday use](#everyday-use)
- [The watcher](#the-watcher)
- [The Alfred palette](#the-alfred-palette)
- [Development](#development)
- [More docs](#more-docs)
- [License](#license)

## What you get

- **Repo detection.** A pane belongs to the git repo its shell is in. A linked worktree counts as the repo it came from, and a folder outside any repo stands for itself.
- **Automatic layout.** `seance arrange` keeps each repo's panes together in one block, picks a grid that suits each display, and spreads repos across all the screens you have. Minimized panes stay minimized.
- **A colour per repo.** Each repo gets a light and dark theme pair plus its own background tint, chosen once and kept. Two repos open side by side are kept visibly different.
- **Contrast repair.** Palette slots too faint to read are corrected before they're painted, so a terminal app can't write white on white.
- **Pins.** `seance place <repo> 3x2 --screen 2` tiles that repo now and keeps it there on later runs.
- **Display changes.** Screens are tracked by UUID, so a DisplayLink dock that reconnects is recognised. A layout macOS already put back is left alone.
- **Sessions.** `seance session save` records each pane's repo, folder and Claude Code conversation, and `seance session restore` brings back whatever is missing.
- **Alfred palette.** Type `s` to arrange, focus a repo or restore a conversation.

## Requirements

- macOS. seance drives windows through AppleScript and Accessibility, and Linux Ghostty has neither.
- Ghostty 1.3 or later, running as a single instance.
- Node.js 18 or later.
- Accessibility permission for whatever runs seance: your terminal, and the watcher the first time it moves a window. Grant it in **System Settings > Privacy & Security > Accessibility**. <!-- style-lint: ignore-line ampersand -->
- Optional: Alfred 5.5 or later for the palette, and the `ghostty` CLI on your `PATH` for `seance theme list`.

## Install

<!-- verify -->
```bash
git clone https://github.com/nixor-praxian/seance.git
cd seance
npm install
npm run build
```

Then put `seance` on your `PATH`, and add the two optional pieces:

```bash
npm link                 # a global `seance` that points at this checkout
seance --version         # 2.3.1
seance watch --install   # the background watcher (a launchd agent)
seance alfred install    # the Alfred palette, keyword `s`
```

Without linking, `npm run dev -- <command>` runs any command from the checkout. `npm link` makes the global command follow the checkout, so `git pull && npm run build` is the whole upgrade. After building, reinstall the watcher with `seance watch --install`, because it runs the built CLI.

To remove it all: `seance watch --uninstall`, `npm unlink -g seance`, and delete the seance workflow in Alfred's preferences.

## Quickstart

Open a few Ghostty windows in a few different repos, then:

```bash
seance arrange
```

```text
theme assigned: myapp → Rose Pine
theme assigned: infra → Gruvbox Material
arranged 5/5 pane(s), painted 5 (dark)
  main             3 pane(s)  myapp 2x1, infra 1x1
  external.left    2 pane(s)  docs 1x1, scratch 1x1
```

Each repo got its own colours, its panes were kept together, and the repos were spread across the displays you have. Running it again is safe.

## Everyday use

`arrange` decides the layout for you. `organize` does the same pass but lets you name the grid.

```bash
seance arrange                       # lay out everything
seance arrange --in-place            # tile each display, but move nothing between displays
seance arrange --save desk           # remember which display each repo is on, moving nothing
seance arrange desk                  # put that back later
seance organize 3x2                  # one grid for every display, this run only
seance organize 3x2 --screen 1 --pin # that grid on display 1, kept for next time
seance place myapp 2x2 --screen 1    # tile myapp 2x2 on display 1, and keep it there
seance place myapp auto              # unpin it
seance focus myapp                   # bring myapp's pane to the front
seance screens                       # list displays and their index (from 0)
```

Colours and appearance:

```bash
seance appearance light   # or dark, or auto to follow macOS; also sets Claude Code's theme
seance contrast           # check the theme pairs against the 4.5:1 minimum
seance contrast 7         # raise the bar, or `off` to paint themes as they ship
```

Sessions and Claude Code conversations:

```bash
seance session save              # snapshot as "latest"
seance session restore           # respawn whatever is missing, then organize
seance session restore --repo myapp
seance resume myapp              # reopen myapp's most recent parked conversation
```

Every command, flag and setting is in the [reference](docs/reference.md).

## The watcher

`seance watch --install` starts a launchd agent that checks your panes every two seconds. It does four things:

- paints a new pane in its repo's colours;
- lays out a display arrangement it hasn't seen before, after waiting for the screens to settle;
- leaves a known arrangement alone, so macOS can restore it the way it remembers;
- takes a rolling `auto` snapshot, so `session restore` works even if you never saved.

It never moves windows while you work, and it never squeezes panes onto fewer screens while a dock is still waking up. If you'd rather it never touched geometry, run `seance reflow off`. Its log is `~/.config/seance/watcher.log`.

## The Alfred palette

After `seance alfred install`, type `s` in Alfred:

| Type | What happens |
|---|---|
| `s arrange` | Arrange everything, or pick a saved arrangement |
| `s myapp` | Focus myapp, restore it, or resume one of its conversations by title |
| `s myapp 3x2 1` | Place myapp 3x2 on display 1 |
| `s org 3x2` | Organize with a 3x2 grid |
| `s dark` | Switch appearance |
| `s help` | Open the cheatsheet |

Repo names match by prefix, so `s mya 3x2` works. The full grammar is in the [reference](docs/reference.md#alfred-palette).

## Development

<!-- verify -->
```bash
npm run typecheck
npm test
```

`npm run dev -- <args>` runs the CLI from source. The decision logic lives in pure modules that are tested on any OS. `src/ghostty.ts` is the only file that touches macOS, and changes to it are checked by hand on a real Mac. [How it works](docs/how-it-works.md) explains how seance finds and moves windows.

## More docs

- [Reference](docs/reference.md): every command, the Alfred grammar, the state file and environment variables.
- [How it works](docs/how-it-works.md): how seance identifies repos, places panes, picks colours and finds windows.
- [Troubleshooting](docs/troubleshooting.md): windows that don't move, invisible text, missing panes.
- [Changelog](CHANGELOG.md): what changed in each release.

## License

[MIT](LICENSE)
