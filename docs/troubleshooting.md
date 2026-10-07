# Troubleshooting

Organized by what you see.

## Contents

- [Windows don't move](#windows-dont-move)
- [seance sees fewer panes than are open](#seance-sees-fewer-panes-than-are-open)
- [A pane disappeared](#a-pane-disappeared)
- [Every repo shows up as home](#every-repo-shows-up-as-home)
- [Text is invisible or washed out](#text-is-invisible-or-washed-out)
- [A fix looks like it did nothing](#a-fix-looks-like-it-did-nothing)
- [Alfred's s keyword does nothing](#alfreds-s-keyword-does-nothing)
- [The cheatsheet doesn't open](#the-cheatsheet-doesnt-open)
- [Some panes aren't painted](#some-panes-arent-painted)
- [Window titles flash odd symbols](#window-titles-flash-odd-symbols)

## Windows don't move

Whatever launched seance lacks Accessibility permission. That's your terminal for commands you type, and the watcher's Node for the launchd agent; macOS asks the first time each one moves a window. Check **System Settings > Privacy & Security > Accessibility** <!-- style-lint: ignore-line ampersand -->, enable the entry, and run the command again.

## seance sees fewer panes than are open

More than one Ghostty is running, and seance only reads the first. Count them:

<!-- unverified: the app bundle path is outside the repo; it is the pattern ghostty.ts matches -->
```bash
pgrep -f "Ghostty.app/Contents/MacOS/" | wc -l
```

Anything above 1 means a second instance, usually started with `open -n`. Close its windows or quit it. seance itself always opens new panes inside the running instance.

If the count is 1, panes may be seen but not moved: `seance arrange` lists panes on another Space under "stranded on another Space". See [A pane disappeared](#a-pane-disappeared).

## A pane disappeared

It's on another macOS Space, usually left there when a display disconnected. Its shell is still alive, but Accessibility only sees the current Space, so seance can't move it. `seance arrange` lists such panes under "stranded on another Space", with the repo and command of each. Bring them over with Mission Control, then run `seance arrange` again.

## Every repo shows up as home

seance couldn't read the panes' working directories. It calls `/usr/sbin/lsof` by its full path so that Alfred's minimal `PATH` can't hide it. Check that it exists:

```bash
ls -l /usr/sbin/lsof
```

If a stray `home` entry stays in `identity`, delete it from the state file.

## Text is invisible or washed out

There are two separate causes.

**The terminal palette.** Some theme colours sit almost on top of their own background. seance repairs them before painting, to at least 4.5:1. Run `seance contrast` to see what it changes. If you turned the check off, `seance contrast 4.5` turns it back on.

**Claude Code's own colours.** Claude Code draws dim text, paths, banners and diffs in its own colours, picked by `theme` in `~/.claude/settings.json`, which no terminal palette can reach. `seance appearance <dark|light>` sets that key to match the terminal. Then restart Claude Code, because a running session keeps the theme it started with.

## A fix looks like it did nothing

Three usual reasons:

- The session you're looking at started before the change. Claude Code reads its theme once, at startup.
- Claude Code put its old theme back. It rewrites its whole settings file whenever you change anything in `/config`. The watcher sets the theme again within seconds; without the watcher, run `seance appearance` again.
- The watcher is running old code. It runs the built CLI, so run `npm run build`, then `seance watch --install`. If the agent points at a folder that no longer exists, check the path in `~/Library/LaunchAgents/com.seance.watcher.plist`.

## Alfred's s keyword does nothing

Reproduce the palette outside Alfred first:

```bash
seance json query ""
```

If that prints JSON, the problem is the workflow, not seance. Run `seance alfred install` again, which also reloads it. If Alfred syncs its preferences to another folder, the workflow has to go there instead. Find it with:

```bash
defaults read com.runningwithcrayons.Alfred-Preferences syncfolder
```

## The cheatsheet doesn't open

`s help` uses Alfred's Text View, which needs Alfred 5.5 or later. It also needs `seance` on the workflow's `PATH`, so run `seance alfred install` again. `seance cheatsheet` prints the same page in a terminal.

## Some panes aren't painted

A theme pair names a theme Ghostty doesn't ship. Legacy commands stop with this error. `arrange`, `organize` and the watcher skip the pane instead, so the symptom there is `painted N` coming out lower than the pane count. `seance contrast` prints `(theme file not found)` next to any such pair. The names must match files in `/Applications/Ghostty.app/Contents/Resources/ghostty/themes/`, and `seance theme list` shows them.

## Window titles flash odd symbols

That's expected. seance finds a window by briefly setting its title to a marker such as `⎈seance:…`. Busy shells put their own title back right away, and idle windows get their repo name.
