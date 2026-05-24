# Ghostty reference (for seance)

Curated, offline reference of Ghostty behaviour relevant to this project.
Synthesised from <https://ghostty.org/docs> + the raw `.mdx` sources in
[ghostty-org/website](https://github.com/ghostty-org/website/tree/main/docs)
and the action enum in
[`src/cli/ghostty.zig`](https://github.com/ghostty-org/ghostty/blob/main/src/cli/ghostty.zig).
Current as of Ghostty 1.3.1 (May 2026).

> Scope: seance only touches a thin slice of Ghostty — CLI, config file,
> themes, AppleScript dictionary, OSC titles, working-directory reporting.
> Sections below are weighted accordingly. The full VT/CSI/ESC reference
> is summarised at the end with links rather than restated.

---

## 0. Quick map for seance

| seance concern                            | Ghostty surface to use                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| List/enumerate windows                    | AppleScript: `windows` of `application id "com.mitchellh.ghostty"` (each has stable `id` since 1.3.0)    |
| Bring window to front                     | AppleScript: `activate window …` or `focus terminal …`                                                   |
| Move/resize window                        | System Events `process "Ghostty"`. Ghostty's own dictionary has no `position`/`size` setters.            |
| Identify which AX window is which tab     | OSC 2 title sentinel → match in AX. Ghostty's `id` is a tab-group id, **not** addressable in AX.         |
| Capture per-pane TTY                      | `ps` walk under the Ghostty PID (you already do this in `probeWindows`)                                  |
| List available themes                     | `ghostty +list-themes`                                                                                   |
| Apply a theme at runtime                  | **Write to the config file + send SIGUSR2 (Linux) or trigger `reload_config` keybind.** No CLI for this. |
| Apply per-project theme on `cd`           | Shell hook → `seance project theme-for` → edit `config.ghostty` → reload                                 |
| Light/dark variant                        | Set `theme = light:Name,dark:Name`; Ghostty auto-switches with system appearance                         |
| Find shell's cwd                          | OSC 7 emitted by shell integration; or query `working directory` of the terminal via AppleScript         |
| Open a new window from a script (Linux)   | `ghostty +new-window` (uses D-Bus, fast)                                                                 |
| Open a new window from a script (macOS)   | AppleScript `new window` with a `new surface configuration`                                              |

**Heads-up bugs in current seance code** (see §13).

---

## 1. Versions, sources, docs offline

- App bundle id: **`com.mitchellh.ghostty`** (macOS). D-Bus name: **`com.mitchellh.ghostty`** (Linux).
- TERM value: **`xterm-ghostty`** (kept `xterm-…` prefix for compatibility).
- AppleScript support: **introduced in 1.3.0**. Stable per-window `id` property is part of this.
- Config file rename: `config` → `config.ghostty` in 1.2.3 (both still loaded).
- Offline docs are shipped with the app:
  - `Ghostty.app/Contents/Resources/ghostty/docs/` (Markdown + HTML)
  - `Ghostty.app/Contents/Resources/ghostty/themes/` (every built-in theme as a config file)
  - man pages under `$prefix/share/man`
- `ghostty +show-config --default --docs` prints the *entire* default config with
  comments — best single-command reference for option values.
- Source of truth for config keys: [`src/config/Config.zig`](https://github.com/ghostty-org/ghostty/blob/main/src/config/Config.zig).
- Source of truth for keybind actions: [`src/input/Binding.zig`](https://github.com/ghostty-org/ghostty/blob/main/src/input/Binding.zig).
- Source of truth for AppleScript object model: [`macos/Ghostty.sdef`](https://github.com/ghostty-org/ghostty/blob/main/macos/Ghostty.sdef) (`sdef /Applications/Ghostty.app | less`).

---

## 2. CLI: `ghostty +<action>`

Subcommands are invoked with a `+` prefix (e.g. `ghostty +list-themes`).
This is the **complete** list from `src/cli/ghostty.zig` — **there is no
`+set-config`, no `+reload-config`, no `+apply-theme`.**

| Action                  | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `+version`              | Version info. Also bound to `--version`.                                 |
| `+help`                 | Help text. Also `--help` / `-h`.                                         |
| `+list-fonts`           | All fonts visible to Ghostty's font loader.                              |
| `+list-keybinds`        | All current keybinds. `--default` shows shipped defaults.                |
| `+list-themes`          | Lists every theme name. Output is one per line with `(builtin)`/`(user)` suffix. |
| `+list-colors`          | Named X11 color names recognised by Ghostty's color parser.              |
| `+list-actions`         | Every keybind action name (matches the names used by AppleScript `perform action`). |
| `+ssh`                  | Wraps `ssh` for terminfo/env propagation. Implementation behind shell integration. |
| `+ssh-cache`            | Manage cache of remote hosts that have had ghostty terminfo installed.   |
| `+edit-config`          | Open config in the configured editor.                                    |
| `+show-config`          | Print effective config. Useful flags: `--default`, `--docs`, `--changes-only`. |
| `+explain-config`       | Print docs for a single option.                                          |
| `+validate-config`      | Validate a config file.                                                  |
| `+show-face`            | Show which font face Ghostty uses for a codepoint.                       |
| `+crash-report`         | List/view crash reports.                                                 |
| `+boo`                  | Easter egg.                                                              |
| `+new-window`           | **IPC**: tell the running instance to open a window (Linux: D-Bus; macOS: native). |
| `+toggle-quick-terminal`| **IPC**: toggle the drop-down quick terminal in the running instance.    |

**Argument forwarding.** `ghostty -e <cmd…>` runs `<cmd…>` as the initial
command, and implicitly sets:
- `gtk-single-instance=false`
- `quit-after-last-window-closed=true` (no delay)
- `shell-integration=detect` (won't force-inject)

Every config key is also a CLI flag: `ghostty --background=282c34 --font-family="JetBrains Mono"`.

---

## 3. Configuration file

### Locations (loaded in this order; later overrides earlier)

1. `$XDG_CONFIG_HOME/ghostty/config.ghostty`
2. `$XDG_CONFIG_HOME/ghostty/config`        *(legacy name)*
3. macOS only: `$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty`
4. macOS only: `$HOME/Library/Application Support/com.mitchellh.ghostty/config`        *(legacy)*

If `XDG_CONFIG_HOME` is unset, defaults to `$HOME/.config`.
All macOS files load *after* all XDG files.

### Syntax

```ini
# Comments on their own line only.
key = value         # whitespace around = is fine
font-family = JetBrains Mono   # quotes optional
font-family =                  # empty value resets to default

# Repeatable keys append:
keybind = ctrl+z=close_surface
keybind = ctrl+d=new_split:right

# Keys are case-sensitive (always lowercase).
```

### Splitting / overlays

```ini
config-file = some/relative/file        # relative to *this* file
config-file = ?optional/file            # `?` prefix → silent if missing
config-file = /absolute/path
```

**Subtle:** `config-file` directives are processed *after* the rest of the
current file, in declaration order. So values in included files **override**
values declared earlier in the file. (Themes flip this — see §4.)

### Reloading

- Default keybinds: `cmd+shift+,` (macOS), `ctrl+shift+,` (Linux). Action name: `reload_config`.
- Linux + systemd: `systemctl reload --user app-com.mitchellh.ghostty.service`
  — under the hood this sends `SIGUSR2` to the main process.
- **There is no CLI verb for "reload" or "set option at runtime".**
  Live mutations happen *only* through the keybind action, the system
  signal, or AppleScript's `perform action "reload_config"`.

Some options can't be reloaded; some only apply to *new* surfaces. Check
the option's docs (`+explain-config <key>`) when in doubt.

---

## 4. Themes

### What a theme is

A theme is *just another Ghostty config file*. It can set any key, not
only colours. The distinction is purely about load order:

- A file referenced via `theme = …` is loaded **first**; later keys in
  the user config override it. (User wins over theme.)
- A file referenced via `config-file = …` is loaded **last**; it
  overrides whatever the user config set. (Include wins over user.)

### Lookup (when `theme` is not an absolute path)

1. `$XDG_CONFIG_HOME/ghostty/themes/<Name>`
2. `$PREFIX/share/ghostty/themes/<Name>`
   - macOS: `Ghostty.app/Contents/Resources/ghostty/themes/<Name>`

Case-sensitive on case-sensitive filesystems. Theme name cannot contain
path separators (use an absolute path instead).

### Listing

```sh
ghostty +list-themes
```

Output has `(builtin)` / `(user)` annotations after the name. Your
existing `listThemes()` in `src/ghostty.ts:245` already strips those.

Themes are sourced from [iterm2-color-schemes](https://iterm2colorschemes.com)
and synced into the Ghostty repo weekly. To add a built-in: contribute to
iterm2-color-schemes.

### Light/dark mode

```ini
theme = dark:Catppuccin Frappe,light:Catppuccin Latte
```

Order doesn't matter; whitespace trimmed; **both must be set**. Ghostty
auto-switches based on the OS appearance. Known macOS bug: titlebar
tabs style isn't updated on swap.

### Minimal theme file

```ini
palette = 0=#51576d
palette = 1=#e78284
# … through 15
background = #303446
foreground = #c6d0f5
cursor-color = #f2d5cf
cursor-text = #c6d0f5
selection-background = #626880
selection-foreground = #c6d0f5
```

A theme *can* also set fonts, padding, etc. — be wary of untrusted
themes.

### Live theme swaps (relevant to seance)

There is **no `+set-config theme=…` CLI**. To swap a theme at runtime:

1. **Persist the change to the config file on disk**, then
2. **Trigger reload** via either:
   - macOS: AppleScript `tell application id "com.mitchellh.ghostty" to perform action "reload_config" on (focused terminal of selected tab of front window)`
     (action names are documented at `/docs/config/keybind/reference`),
   - Linux: `systemctl reload --user app-com.mitchellh.ghostty.service` *or* simulate the `reload_config` keybind.

Alternative on macOS: AppleScript `perform action` works on a terminal,
and the `reload_config` action is global — running it on any terminal
reloads the whole config. Use this rather than shelling out.

---

## 5. Keybinding system (only what seance needs)

### Trigger syntax

`keybind = trigger=action`. Trigger is `mod+mod+…+key`. Modifiers:

- `shift`
- `ctrl` (`control`)
- `alt` (`opt`, `option`)
- `super` (`cmd`, `command`)

Sequences (leader keys) use `>`:

```ini
keybind = ctrl+a>n=new_window
```

Quote `>` in shell args: `ghostty --keybind='ctrl+a>n=new_window'`.

Prefixes:

- `all:` — apply to every surface (per-surface actions get broadcast)
- `global:` — system-wide (macOS only; needs Accessibility permission)
- `unconsumed:` — also forward the key to the program in the terminal
- `performable:` — only consume the key if the action would actually do something (e.g. `copy_to_clipboard` only when there's a selection)

Prefixes combine: `global:unconsumed:ctrl+a=reload_config`.

### Actions seance is likely to care about

Full reference: [`/docs/config/keybind/reference`](https://ghostty.org/docs/config/keybind/reference) or `ghostty +list-actions`.

| Action                       | Notes                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `reload_config`              | Re-read config files. The way to apply a theme swap at runtime.  |
| `new_window`                 | Open new window.                                                 |
| `new_tab`                    | New tab in the current window.                                   |
| `new_split:right\|down\|left\|up\|auto` | Split current surface. `auto` splits along the larger axis. |
| `goto_split:right\|down\|left\|up\|previous\|next` | Focus a split.                              |
| `goto_window:previous\|next` | Cycle windows.                                                   |
| `toggle_split_zoom`          | Zoom the current split.                                          |
| `equalize_splits`            | Make all splits in the window equal.                             |
| `resize_split:up\|down\|left\|right,<px>` | Resize by pixels. e.g. `resize_split:up,10`.        |
| `reset_window_size`          | Restore default window size (macOS only).                        |
| `toggle_fullscreen`          | Native fullscreen.                                               |
| `toggle_maximize`            | Maximize/restore (no-op on macOS).                               |
| `toggle_window_decorations`  | Linux only.                                                      |
| `toggle_window_float_on_top` | macOS only.                                                      |
| `goto_tab:N`                 | 1-indexed. Clamps to last tab.                                   |
| `move_tab:±N`                | Cyclic.                                                          |
| `prompt_surface_title` / `prompt_tab_title` | Native popup prompts.                             |
| `set_surface_title:<text>`   | Override the surface title (empty string clears).                |
| `set_tab_title:<text>`       | Override the tab title (empty clears).                           |
| `close_surface` | Close the focused **surface** — a split, or the whole tab/window if there are no splits. This is how you "unsplit": close one half, the other expands to fill. Default: `cmd+w` (macOS) / `ctrl+shift+w` (Linux). |
| `close_tab` / `close_window` / `all:close_window` | Coarser close scopes (always close the whole tab/window/all-windows, regardless of splits). |
| `undo` / `redo`              | macOS only. Restores a recently-closed split/tab/window within `undo-timeout`. Use if you `close_surface` the wrong half. |
| `toggle_quick_terminal`      | Drop-down terminal.                                              |
| `toggle_visibility`          | Show/hide all Ghostty windows (macOS).                           |
| `inspector:toggle\|show\|hide` | Terminal inspector.                                            |
| `text:<zig string>`          | Send arbitrary bytes. `text:\x15` sends Ctrl-U.                  |
| `csi:<seq>`                  | Send CSI sequence body. `csi:A` = cursor up.                     |
| `esc:<seq>`                  | Send ESC sequence body.                                          |
| `ignore` / `unbind`          | Black-hole a key / remove a previous binding.                    |

Action arguments are after a `:` (or `,` for multi-arg actions like
`resize_split`). The same action names are accepted by AppleScript's
`perform action`.

---

## 6. AppleScript (macOS)

Available since 1.3.0. Default-on. Disabled with `macos-applescript = false`.

### Object model

```
application → windows → tabs → terminals
```

| Object        | Properties                                                | Elements              |
| ------------- | --------------------------------------------------------- | --------------------- |
| `application` | `name`, `frontmost`, `front window`, `version`            | `windows`, `terminals`|
| `window`      | `id`, `name`, `selected tab`                              | `tabs`, `terminals`   |
| `tab`         | `id`, `name`, `index`, `selected`, `focused terminal`     | `terminals`           |
| `terminal`    | `id`, `name`, `working directory`                         | —                     |

Convenience accessors: `front window`, `selected tab of …`,
`focused terminal of selected tab of front window`.

Query examples (from the docs verbatim):

```applescript
tell application "Ghostty"
    set win to front window
    set tab1 to selected tab of win
    set term1 to focused terminal of tab1
    set allTermsInWin to terminals of win
    set cwdMatches to every terminal whose working directory contains "ghostty"
end tell
```

### Commands

Creation & layout:

| Command                       | Example                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `new surface configuration`   | `set cfg to new surface configuration`                       |
| `new window`                  | `set win to new window with configuration cfg`               |
| `new tab`                     | `set t to new tab in win with configuration cfg`             |
| `split direction <dir>`       | `set t2 to split t1 direction right with configuration cfg`  |

`direction` values: `right`, `left`, `down`, `up`.

Focus / lifecycle:

| Command           | Example                                                |
| ----------------- | ------------------------------------------------------ |
| `focus`           | `focus t1` — focuses terminal + raises its window      |
| `activate window` | `activate window (window 1)`                           |
| `select tab`      | `select tab (tab 2 of window 1)`                       |
| `close`           | `close (terminal 2 of selected tab of window 1)`       |
| `close tab`       | `close tab (tab 2 of window 1)`                        |
| `close window`    | `close window (window 1)`                              |

Input & actions:

| Command               | Example                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `input text`          | `input text "echo hello" to t1` (paste-style; no auto-newline)           |
| `send key`            | `send key "enter" to t1` — supports `action` (`press`/`release`) and `modifiers` (comma-sep: `shift,control,option,command`) |
| `send mouse button`   | `send mouse button left button to t1`                                    |
| `send mouse position` | `send mouse position x 240 y 120 to t1`                                  |
| `send mouse scroll`   | `send mouse scroll x 0 y -8 precision true to t1`                        |
| `perform action`      | `perform action "toggle_fullscreen" on t1` — see §5 for action names     |

### Surface configuration record

Fields:

- `font size` (integer)
- `initial working directory` (POSIX path)
- `command` (string)
- `initial input` (string)
- `wait after command` (bool)
- `environment variables` (list of `KEY=VALUE` strings)

```applescript
tell application "Ghostty"
    set cfg to new surface configuration
    set initial working directory of cfg to POSIX path of (path to home folder) & "src/foo"
    set font size of cfg to 13
    set environment variables of cfg to {"EDITOR=nvim"}
    set win to new window with configuration cfg
end tell
```

### Key gotchas relevant to seance

- **`window.id` is the tab-group id**, not the macOS AX window number.
  System Events sees windows ordered by z-order (frontmost = index 1),
  *not* by Ghostty's internal id. Cross-walking between the two is what
  the OSC 2 sentinel trick in `setWindowBounds` and `probeWindows` is for.
- **No `position`/`size` setters in Ghostty's dictionary.** Use
  System Events on `process "Ghostty"` (you already do this — see
  `src/ghostty.ts:153-194`).
- macOS Automation (TCC) prompts on first cross-app `osascript` use.
  Reset with: `tccutil reset AppleEvents com.<your-bundle>` (or revoke
  in System Settings → Privacy & Security → Automation).
- macOS tiling WMs (Yabai/Aerospace) see tabs as separate windows
  because Ghostty uses native AppKit tabs. Workarounds exist (see
  `/docs/help/macos-tiling-wms`) but you cannot fix this from inside
  AppleScript.

---

## 7. OSC sequences seance touches

All OSC sequences in Ghostty use `ESC ] … ST` or `ESC ] … BEL` (BEL is
the legacy terminator; Ghostty echoes back whatever terminator the
caller used, but `ST` = `ESC \` = `0x1b 0x5c` is preferred).

### OSC 0 / 1 / 2 — window title

```
ESC ] 0 ; <title> ST   # set both icon name + window title (Ghostty: alias of OSC 2)
ESC ] 1 ; <title> ST   # icon name only (Ghostty has no icon name, ignored)
ESC ] 2 ; <title> ST   # set window title
```

Ghostty unconditionally treats `<title>` as **UTF-8**. xterm has
modes for ISO-8859-1 / hex / UTF-8; Ghostty does not honour the
mode (XTSMTITLE). This means writing `\x1b]2;sentinel\x07` to a TTY
is portable across Ghostty versions — which is exactly the trick in
`src/ghostty.ts:setWindowBounds` and `probeWindows`.

> Titles set via the `set_tab_title` / `set_surface_title` keybind
> actions or `prompt_*_title` actions **override** OSC-set titles
> and persist across focus. Plain OSC 2 from the shell is reset
> by the shell on the next prompt redraw.

### OSC 7 — current working directory

```
ESC ] 7 ; file://<host>/<absolute-path> ST
```

Sent by shell integrations (bash/zsh/fish/elvish/nushell) on every
prompt. Ghostty uses it for: working-directory-aware new tabs/splits,
the value of `working directory` in AppleScript, and as part of
window save-state. URI must include the hostname.

### OSC 4 — palette colour query/set

```
ESC ] 4 ; <n> ; <color-spec | ?> ST
```

- `n = 0..255` → ANSI palette index.
- `n = 256..260` → special colours: bold (256), underline (257), blink (258), reverse (259), italic (260). Same as `OSC 5 ; (n-256)`.
- `<color-spec>` → see §10.
- `?` → terminal replies with the current color.

Multiple pairs in one sequence: `OSC 4 ; 1 ; red ; 2 ; green ST`.

### OSC 10 / 11 / 12 — dynamic colours

```
ESC ] 10 ; <fg | ?> ST   # foreground
ESC ] 11 ; <bg | ?> ST   # background
ESC ] 12 ; <cursor | ?> ST   # cursor
```

If multiple `;`-separated colours are given, `n` is incremented per
slot (i.e. `OSC 11 ; red ; blue ST` sets background=red, cursor=blue
— equivalent to OSC 11 then OSC 12).

Ghostty supports **only n=10/11/12**. 13–19 are silently ignored.

### OSC 52 — clipboard

```
ESC ] 52 ; <targets> ; <base64 | ? | invalid> ST
```

- `targets` (string): `c` standard clipboard, `p` primary, `s` selection. Others alias to `c`. Empty → `c`.
- `?` → terminal replies with the clipboard contents (subject to `clipboard-read` config).
- Valid base64 → set the clipboard.
- Invalid base64 → clear the clipboard.

Ghostty allows only one clipboard per sequence currently.
`clipboard-read` / `clipboard-write` config gates this (default
`clipboard-read = ask`, `clipboard-write = ask`).

### OSC 8 — hyperlinks

```
ESC ] 8 ; <params> ; <uri> ST     # begin
ESC ] 8 ; ; ST                    # end
```

Params are `key=value` pairs joined with `:`. Only `id=…` is
recognised (links cells of the same logical hyperlink). `file://`
URIs **must** include hostname or Ghostty refuses them.

### OSC 9 — desktop notification

```
ESC ] 9 ; <title> ST
```

ConEmu's OSC 9 collides with this (uses `OSC 9 ; <n> ; …`); Ghostty
silently routes the ConEmu variants when the title starts with `<digit>;`.

### Other OSCs Ghostty parses but seance probably doesn't need

- **OSC 5** — special colours indexed 0..4 (see OSC 4 high indices).
- **OSC 22** — pointer (mouse cursor) shape.
- **OSC 104** — reset palette colours.
- **OSC 105 / 110–119** — reset special / dynamic colours.
- **OSC 9;n…** — ConEmu extensions (progress bar etc.).

---

## 8. Shell integration

Auto-injected for **bash, elvish, fish, nushell, zsh**. macOS system
bash (`/bin/bash`) is too old — install one via Homebrew or source
manually.

### What it gives you

- OSC 7 cwd reporting → new windows/tabs/splits inherit cwd.
- Prompt marking → `jump_to_prompt` keybind, prompt-aware reflow.
- Don't-confirm-close when sitting at the prompt.
- Cursor turns into a bar at the prompt.
- Triple-click + cmd/ctrl selects last command output.
- Optional: `sudo` wrapper (preserves terminfo), `ssh` wrapper
  (terminfo / env propagation), PATH augmentation.

Toggle individually via `shell-integration-features = cursor, no-cursor, sudo, no-sudo, title, no-title, ssh-env, ssh-terminfo, path`
(comma-list; `no-` prefix disables; `true`/`false` toggle everything).

### Env vars Ghostty sets in child processes

| Var                     | Value                                                            |
| ----------------------- | ---------------------------------------------------------------- |
| `TERM`                  | `xterm-ghostty` (falls back to `xterm-256color` if terminfo absent) |
| `COLORTERM`             | `truecolor`                                                      |
| `TERM_PROGRAM`          | `ghostty`                                                        |
| `TERM_PROGRAM_VERSION`  | full Ghostty version                                             |
| `GHOSTTY_RESOURCES_DIR` | path to the `share/ghostty` dir (used for shell-integration lookup) |
| `GHOSTTY_BIN_DIR`       | path to the `bin` dir if `path` feature is on                    |

**Detecting "am I inside Ghostty?"** — check `GHOSTTY_RESOURCES_DIR`
or `TERM_PROGRAM == "ghostty"`.

### Manual sourcing (when auto-detect fails or shells nest)

```bash
# At the top of ~/.bashrc:
if [ -n "${GHOSTTY_RESOURCES_DIR}" ]; then
    builtin source "${GHOSTTY_RESOURCES_DIR}/shell-integration/bash/ghostty.bash"
fi
```

Per-shell paths:

| Shell    | Path under `$GHOSTTY_RESOURCES_DIR/shell-integration/…`         |
| -------- | --------------------------------------------------------------- |
| bash     | `bash/ghostty.bash`                                             |
| elvish   | `elvish/lib/ghostty-integration.elv`                            |
| fish     | `fish/vendor_conf.d/ghostty-shell-integration.fish`             |
| nushell  | `nushell/vendor/autoload/ghostty.nu`                            |
| zsh      | `zsh/ghostty-integration`                                       |

### SSH

`xterm-ghostty` terminfo isn't on remote hosts. Three remedies:

1. `shell-integration-features = ssh-terminfo` → wraps `ssh` to
   install terminfo on first connect (`infocmp` local + `tic` remote;
   success cached; managed via `ghostty +ssh-cache`).
2. `shell-integration-features = ssh-env` → wraps `ssh`, sets
   `TERM=xterm-256color`, forwards `COLORTERM`, `TERM_PROGRAM`,
   `TERM_PROGRAM_VERSION` via `SendEnv`.
3. `~/.ssh/config` `SetEnv TERM=xterm-256color` (manual; needs OpenSSH 8.7+).

The `ssh` wrapper is a shell function, so it does **not** propagate
into `Makefile` recipes, sub-shells, `mosh`, `rsync -e ssh`,
`gcloud compute ssh`, `git+ssh`, etc.

---

## 9. Process & window model

### Single instance / IPC

| Platform | Mechanism                                                  | "Open new window" call                                  |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| macOS    | Native AppKit; one process per app bundle                  | AppleScript `new window`, or `open -a Ghostty`           |
| Linux    | GTK single-instance (D-Bus name `com.mitchellh.ghostty`)   | `ghostty +new-window` (D-Bus call, very fast)            |

On Linux, single-instance defaults to *on* unless `TERM_PROGRAM` is
non-empty (i.e. you're launching from another terminal) or you pass
any CLI args. Override with `gtk-single-instance = true|false|detect`.

`ghostty -e <cmd>` always disables single-instance for that invocation.

### Window save-state (macOS)

```ini
window-save-state = default | never | always
```

`default` only saves on force-quit or if enabled system-wide. `always`
saves on every quit. Requires shell integration to restore cwds. Linux
ignores this.

### Sizing & positioning

- `window-width` / `window-height` are in **terminal grid cells**; both
  must be set to take effect. Minimum 10×4. Doesn't affect existing
  windows — only newly created ones. Sizes larger than the screen are
  clamped. (Used as a "maximised by default" trick.)
- `window-position-x` / `window-position-y` are **pixels from top-left of
  primary monitor**. macOS only — GTK doesn't allow programmatic
  positioning (X11/Wayland limitation). On macOS this is relative to
  the visible screen area (below the menu bar).
- `window-step-resize` (macOS) snaps resizes to cell increments.
- New tab placement: `window-new-tab-position = current | end`.

> seance moves windows via System Events `position`/`size` — that
> bypasses these config keys entirely and works on macOS. On Linux
> (Wayland especially), the equivalent isn't generally possible from
> outside the compositor.

### Linux cgroups

`linux-cgroup = single-instance` (default) puts each surface in its
own transient systemd scope. Lets `systemd-oom` kill one tab without
killing all of Ghostty. `linux-cgroup-memory-limit` / `…-processes-limit`
to set bounds. `linux-cgroup-hard-fail = true` to refuse surface creation
if cgroup setup fails.

---

## 10. Colour specifications (for theme files, OSC 4/10–12)

Accepted formats:

- **Hex** `#RRGGBB` or `RRGGBB` (1, 2, 3, or 4 hex digits per channel; channels must all be the same width when using `#`).
- **rgb:** `rgb:RR/GG/BB` (1–4 hex digits per channel).
- **rgbi:** `rgbi:0.5/1.0/0.25` (decimal 0..1 per channel).
- **Named** — X11 color name from <https://gitlab.freedesktop.org/xorg/app/rgb>. Case-insensitive. List with `ghostty +list-colors`.

---

## 11. Config keys worth knowing (seance-relevant slice)

> Full list: `ghostty +show-config --default --docs` or
> [the option reference](https://ghostty.org/docs/config/reference).
> ~250 keys total — these are the ones touching project workflow.

| Key                                         | Purpose                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `theme`                                     | Theme name, abs path, or `light:Name,dark:Name`.                                              |
| `background`, `foreground`                  | Hex / X11 name. Overrides any theme value.                                                    |
| `palette = N=#RRGGBB`                       | Set palette index `N`. Repeatable.                                                            |
| `cursor-color`, `cursor-text`               | Cursor & text under cursor.                                                                   |
| `selection-foreground`, `selection-background` | Self-explanatory.                                                                          |
| `window-width`, `window-height`             | Initial size in cells; both required.                                                         |
| `window-position-x`, `window-position-y`    | macOS only.                                                                                   |
| `window-save-state = default\|never\|always`| Restore on relaunch (macOS only).                                                             |
| `window-new-tab-position = current\|end`    | Where new tabs go.                                                                            |
| `window-show-tab-bar = always\|auto\|never` | Tab bar visibility.                                                                           |
| `working-directory = …`                     | Default cwd for new surfaces. `inherit` is the common shell-integration choice.               |
| `window-inherit-working-directory`          | Cross-window inheritance toggle.                                                              |
| `tab-inherit-working-directory`             | New tab inheritance toggle.                                                                   |
| `split-inherit-working-directory`           | New split inheritance toggle.                                                                 |
| `window-inherit-font-size`                  | Per-surface font size persistence.                                                            |
| `command` / `initial-command`               | What to run. `direct:nvim foo` bypasses `/bin/sh -c`; `shell:` forces shell wrap.             |
| `env = KEY=value`                           | Inject env vars. Repeatable.                                                                  |
| `title = …`                                 | Initial window title. Overridden by OSC 2 if `title-report` is on.                            |
| `class = …`                                 | Linux GTK app class. Don't set if you want D-Bus / systemd unit to work — see Linux page.     |
| `confirm-close-surface = true\|false\|always` | Close confirmation behaviour.                                                               |
| `quit-after-last-window-closed`             | macOS: false (mac convention). Linux: true.                                                   |
| `quit-after-last-window-closed-delay`       | Linux only. Time format: `1h30m`, `45s`, `5m`.                                                |
| `shell-integration = none\|detect\|bash\|elvish\|fish\|nushell\|zsh` | Force/disable integration.                          |
| `shell-integration-features = …`            | Comma list, `no-`-prefixed disables.                                                          |
| `macos-applescript = true\|false`           | Toggle AppleScript dictionary.                                                                |
| `macos-titlebar-style`                      | `transparent`, `tabs`, `native`, `hidden`.                                                    |
| `macos-window-buttons`                      | `visible` / `hidden`.                                                                         |
| `macos-non-native-fullscreen`               | Disable system fullscreen animation.                                                          |
| `gtk-single-instance = true\|false\|detect` | Single-instance mode.                                                                         |
| `keybind = trigger=action`                  | Repeatable. See §5.                                                                           |
| `config-file = path`                        | Include. Later values win. `?path` to make optional.                                          |
| `config-default-files = true\|false`        | CLI-only; turn off the XDG file load.                                                         |
| `osc-color-report-format = none\|8-bit\|16-bit` | Reply format for OSC 4/10–12 queries.                                                    |
| `clipboard-read`, `clipboard-write`         | `ask` / `allow` / `deny` for OSC 52.                                                          |
| `title-report = true\|false`                | Whether OSC 2 from shell can change the window title.                                         |

---

## 12. Terminal control sequences (where to look, not what to memorise)

Ghostty implements the standard VT100/VT220/xterm + many modern
extensions. Seance doesn't emit these — programs running inside the
terminal do. For reference:

- **C0**: BEL `0x07`, BS `0x08`, TAB `0x09`, LF `0x0A`, CR `0x0D`.
- **CSI** (`ESC [`): cursor & screen manipulation, modes, SGR.
- **ESC** (`ESC <final>`): `IND`/`RI` (scroll), `DECSC`/`DECRC` (save/restore cursor), `RIS` (reset), `DECKPAM`/`DECKPNM` (keypad mode), `DECALN` (alignment test).
- **OSC** (`ESC ]`): see §7.
- **DCS** (`ESC P`): mostly `XTGETTCAP` for terminfo queries.
- **APC** (`ESC _`): Ghostty supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) here.

Per-sequence docs live under `/docs/vt/{control,esc,csi,osc}/<name>`
or in the offline mirror.

External protocols Ghostty implements per upstream spec:

| Protocol                       | Upstream spec                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| OSC 8 (hyperlinks)             | [VTE/iTerm2 gist](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) |
| OSC 21 (Kitty color stack)     | [Kitty docs](https://sw.kovidgoyal.net/kitty/color-stack/)                          |
| Kitty graphics (APC)           | [Kitty docs](https://sw.kovidgoyal.net/kitty/graphics-protocol/)                    |
| Synchronized output (DCS)      | [Mode 2026](https://gitlab.com/gnachman/iterm2/-/wikis/synchronized-updates-spec)   |
| ConEmu OSC 9;n                 | [ConEmu wiki](https://conemu.github.io/en/AnsiEscapeCodes.html#OSC_Operating_system_commands) |

---

## 13. Gotchas / bugs in current `src/ghostty.ts`

Flagged for follow-up; not fixed in this doc:

1. **`applyTheme` calls `ghostty +set-config theme=…` — that subcommand doesn't exist** (see §2). The Ghostty CLI has no runtime config setter. Real options:
   - Write `theme = …` into the user's `config.ghostty`, then trigger reload via either
     - AppleScript: `tell application id "com.mitchellh.ghostty" to perform action "reload_config" on focused terminal of selected tab of front window`
     - Linux: `systemctl reload --user app-com.mitchellh.ghostty.service`
   - Or keep a project-specific config file and reference it from the user config via `config-file = ?…/seance-active.ghostty`, then rewrite that file + reload.
2. **`listWindows()` falls back to `axindex:<N>`** when Ghostty's dictionary fails. That's fine, but z-order from System Events ≠ creation order from Ghostty — keep the OSC 2 sentinel cross-walk if order matters.
3. **`probeWindows()` walks `ppid == ghosttyPid`** — that works while shell processes are direct children of Ghostty, which is true today. If/when Ghostty wraps shells in a systemd scope on macOS (it doesn't), or routes via `login(1)` on macOS login shells (it currently does direct-exec), this assumption needs revisiting.
4. **`setWindowBounds` uses System Events position/size on `process "Ghostty"`** — correct path. Don't try to do this via Ghostty's own dictionary; it has no setters for window geometry.
5. **macOS login shells** (`/etc/zprofile` etc.) run on every shell start in Ghostty (matches Terminal.app). Surprising on Linux-mental-model users; not a seance bug but worth knowing when debugging "my env isn't right in seance-spawned windows".
6. **Per-project theme via `cd` hook** is feasible because OSC 7 fires on every prompt, so a shell-integration hook can grab the cwd, look up the assigned theme, and trigger the reload mechanism. The slow part is the reload itself (file write + IPC). Consider: pre-generate `seance-active.ghostty` only when the project changes, not every prompt.

---

## 14. Useful one-liners

```sh
# What's the running Ghostty version?
osascript -e 'tell application "Ghostty" to get version'

# Inspect AppleScript dictionary
sdef /Applications/Ghostty.app | less

# Dump the full default config with docs
ghostty +show-config --default --docs | less

# Explain one option
ghostty +explain-config theme

# All keybind actions (matches AppleScript perform action names)
ghostty +list-actions

# All available themes (one per line, with (builtin)/(user) suffix)
ghostty +list-themes

# Reload Ghostty's config (Linux, systemd)
systemctl reload --user app-com.mitchellh.ghostty.service

# Reload Ghostty's config (macOS, via AppleScript)
osascript -e 'tell application id "com.mitchellh.ghostty" to perform action "reload_config" on focused terminal of selected tab of front window'

# Quick window snapshot via System Events (what `listAllWindows` runs)
osascript -e 'tell application "System Events" to tell process "Ghostty" to get {name, position, size} of every window'

# Send OSC 2 title to a TTY
printf '\e]2;hello from seance\a' > /dev/ttys003

# Send OSC 7 cwd to a TTY
printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD" > /dev/ttys003
```

---

## Sources

Raw markdown sources mirror lives at `/tmp/ghostty-docs/` (was used to
build this doc; regenerate with:

```sh
mkdir -p /tmp/ghostty-docs && cd /tmp/ghostty-docs && \
  curl -s https://api.github.com/repos/ghostty-org/website/contents/docs?ref=main \
  | jq -r '.[] | select(.type=="file") | .download_url' | xargs -n1 curl -O
```

— recurses one level; deeper subdirs need a similar pass per folder.)

Always check this against the live site if a behaviour seems off:
<https://ghostty.org/docs>.
