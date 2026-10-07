# Changelog

Everything that's changed in seance, newest first. The long version of each
release lives in [`docs/releases/`](docs/releases/).

## 2.3.1 (7 Oct 2026)

`seance appearance light` now repaints your panes on the spot. It used to set
the new appearance and then repaint only the old 1.x groups, so your repos kept
their dark colours until the watcher came round or you ran `arrange`.

The watcher's rolling `auto` snapshot now really runs every five minutes. It
counted loop passes instead of time, and each pass shells out to `ps`, `lsof`
and `osascript` on top of its two-second sleep, so "five minutes" stretched to
however long 150 passes took.

Restart the watcher (`seance watch --install`) to pick it up.

## 2.3.0 (7 Oct 2026)

Repos keep their colour now. A busy pane could flip colour over and over,
because seance was asking the wrong process where the pane lived: usually some
short-lived child of Claude Code that had already exited by the time anyone
checked. It now asks the shell, which doesn't wander off mid-question.

Colours are also handed out once and kept, so a repo looks the same next month
as it does today. And each repo gets its own background tint, because it turns
out most dark themes are the same dark grey wearing different accents.

`arrange` finally uses every screen when externals are stacked in a grid,
instead of piling panes onto one. `place --screen` pins a repo to that exact display, even a
fifth one. Replugging a dock no longer crams everything onto whichever two
screens woke up first. New `arrange --in-place` tiles each display without
moving panes between them. And `seance --version` has stopped claiming to be
0.0.1.

Restart the watcher (`seance watch --install`) to pick it up.
[Full notes](docs/releases/2.3.0.md)

## 2.2.6 (30 Aug 2026)

`arrange` could report every pane placed while one sat untouched across two
tiles. seance now checks where each window actually landed and tries again if
it missed. Windows that Ghostty grows past their tile get nudged back onto
their own screen instead of hanging off the bottom onto the next one.
Throwaway git worktrees no longer get a colour of their own.
[Full notes](docs/releases/2.2.6.md)

## 2.2.5 (29 Aug 2026)

seance could reassign a repo's colour on every watcher pass, forever, writing
the state file each time. It stops now, and when two repos want the same theme,
whoever had it first keeps it.
[Full notes](docs/releases/2.2.5.md)

## 2.2.4 (29 Aug 2026)

A DisplayLink monitor gets a brand-new ID every time it's plugged in, so seance
thought every replug was a stranger. Displays are now recognised by UUID, the
same way macOS remembers them. Also new: seance ships a [Claude Code
skill](skills/), so Claude can drive it for you.
[Full notes](docs/releases/2.2.4.md)

## 2.2.3 (29 Aug 2026)

Come back to a familiar desk and macOS puts every window back exactly where it
was. seance used to undo that with a fresh layout. It now leaves an
arrangement alone once it has laid it out. `seance reflow` gains a third
setting: `new` (the default), `always` or `off`, and `on` still means `new`.
The Alfred palette also got smarter about grids and stopped failing silently.
[Full notes](docs/releases/2.2.3.md)

## 2.2.2 (28 Aug 2026)

Plugging in one display used to trigger three full re-tiles in a row. The
watcher now waits for the screens to settle and tiles once. If you'd rather it
never touched your windows on a display change, `seance reflow off`.
[Full notes](docs/releases/2.2.2.md)

## 2.2.1 (28 Aug 2026)

Minimized panes stay minimized. Plugging in a display used to drag every one
of them back out of the Dock.
[Full notes](docs/releases/2.2.1.md)

This release also carried a month of features that had shipped without a
version number of their own:

- `seance arrange`, which picks the grid and the screen split for you.
- Light mode you can actually read. Every palette goes through a contrast
  check (`seance contrast`, 4.5:1 by default), and Claude Code's own theme now
  follows `seance appearance`.
- A cheatsheet inside Alfred (`s help`), and `seance organize 3x2 --pin` for
  when you know exactly the shape you want.

## 2.2.0 (29 Jul 2026)

Bring back just one repo with `session restore --repo`. `seance resume <repo>`
reopens a parked Claude conversation, and the palette lists them by title. A
rolling auto-snapshot means there's always something to restore.

## 2.1.0 (27 Jul 2026)

Workspaces survive a reboot. `session save` remembers which Claude
conversation was running in each pane, and `session restore` brings them back.

## 2.0.0 (27 Jul 2026)

seance stops asking you to register windows and starts looking at them.
`organize` tiles every pane by repo across your displays, `place` remembers
which repo goes on which screen, the Alfred palette lives behind `s`, and a
watcher re-tiles and repaints when displays come and go. Also the first public
release.

## Before 2.0 (May to July 2026)

Named groups, grids, per-window themes, save and restore, multi-display
support, `gather` and per-group backgrounds. The git history has the details.
