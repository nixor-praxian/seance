# CLAUDE.md — seance project guidance

## What this is

A macOS-only TypeScript CLI for orchestrating Ghostty windows: named groups, screen-proportional grids, save/restore via runnable AppleScript, per-window theme application via OSC palette. See `README.md` for user-facing detail.

## Architecture invariants (don't re-break these)

1. **Window targeting goes through sentinel-via-TTY**, never Ghostty `id` ↔ AX index. Ghostty's window `id` is a tab-group identifier System Events cannot address; AX `AXIdentifier` on Ghostty windows is the literal string `"TerminalWindowRestoration"` (NSWindow autosave name), identical for every window. The two namespaces are disjoint. The only reliable bridge is writing OSC 2 to the window's TTY and matching by title in System Events. This was painfully discovered — don't propose `AXIdentifier`-based shortcuts.

2. **`setWindowBounds` is a batch operation.** Never resize windows one-at-a-time in a loop: each `position` set promotes the moved window to frontmost, so the next iteration's `window 1` is the wrong window. The current implementation captures all AX references first inside a single AppleScript, then applies all rects.

3. **Display geometry comes from `listScreens()` (NSScreen.visibleFrame via JXA), never Finder.** Finder's `bounds of window of desktop` returns the full display including the menu-bar zone, so tiles land under the menu bar. `listScreens()` enumerates *every* display; each screen's Cocoa `visibleFrame` (bottom-left origin) is flipped to AX coordinates (top-left, y-down) by the pure `cocoaFramesToAx` helper in `layouts.ts`, anchored to the **primary** display's full frame height — which is why secondary displays correctly land at negative AX y. Groups target a display by its **stable `CGDirectDisplayID`** (`group.displayId`), **never** the `NSScreen.screens` array index: the array reorders on focus change and the ids re-enumerate on reconnect, so an index would silently tile onto the wrong monitor. `pickScreen` falls back to the main display (with a notice) when a saved `displayId` is no longer connected.

4. **Themes apply per-window via OSC sequences**, not globally via Ghostty config. Editing `~/Library/Application Support/com.mitchellh.ghostty/config` recolors *every* Ghostty window — which defeats the per-group point. `applyPaletteToTty` writes `OSC 4`/`OSC 10`/`OSC 11`/`OSC 12` to each window's TTY. (Opacity is **not** an OSC color — Ghostty only exposes `background-opacity`/`background-blur` as *global* config, so per-pane opacity isn't achievable; per-pane differentiation is color only.)

5. **WindowRef requires `ttyPath`, `slot`, and `cwd`** to be useful for `grid`/`save`. `group add` captures all three. If you add another command that consumes these, gracefully tell the user to re-`group add` when entries are missing them.

6. **Ghostty 1.3.x exposes only one window (its key window) to AppleScript.** `count of windows` returns 1 while System Events sees them all, so `probeWindows` resolves windows via the System-Events title sentinel (AX) alone and `ProbeRow.ghosttyId` is **optional** — never require it (doing so made probe return zero under heavy Claude-Code load). AX only sees the **current Space**; a window stranded on another Space (common after an external display disconnects) stays alive but invisible and must be brought over (Mission Control) before seance can target it. `gather` reports such windows instead of silently skipping them.

## Module boundaries

```
pure (testable on Linux):      layouts.ts, groups.ts, state.ts, themes.ts, save.ts
impure (macOS-only):           ghostty.ts (osascript + JXA + TTY writes + execa)
composition:                   cli.ts (commander wiring)
```

Anything that shells out to `osascript`, writes to `/dev/ttysNNN`, or reads from `/Applications/Ghostty.app/...` belongs in `ghostty.ts`. Don't leak `execa` calls into pure modules.

## Scope boundaries (active)

- **`docs/themes-preview.html` is product-frozen.** It is the source of truth for the 7 curated theme pair names (Catppuccin, Rose Pine, Gruvbox Material, Ayu, Selenized, Modus, Night Owl). Don't reshape `ThemePair`, `resolveTheme`, or `BUILTIN_THEME_PAIRS` without checking with the user.
- The theme catalog (which themes are in the BUILTIN_THEME_PAIRS list) is owned by a separate stream of work that lives in `docs/themes-preview.html`. The *application* path (`theme apply`, OSC palette writing) is owned in `src/cli.ts` / `src/ghostty.ts` / `src/themes.ts` and is fair game.

## Build / test / dev

```bash
npm install
npm run build         # tsc → dist/
npm test              # vitest, all suites (40 tests across 4 files)
npm run typecheck     # strict typecheck, no emit
npm run dev -- <args> # tsx src/cli.ts; tests use the same entry
npm link              # symlink global `seance` → checkout (live edits)
```

TypeScript is strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. Optional properties cannot be assigned `undefined` directly — use spread-with-conditional (`...(x ? { foo: x } : {})`).

## Testing patterns

- **Pure modules:** `vitest` unit tests in `src/<name>.test.ts`. No mocking — they're pure.
- **CLI black-box:** `src/cli.test.ts` spawns `tsx src/cli.ts` in an `mkdtemp` dir with `SEANCE_HOME=<tmpdir>` env injected. No shared state between tests, no Ghostty calls.
- **Anything touching System Events / TTYs / Ghostty AppleScript:** manual verification only. Document the steps in the PR description.

## Coding style preferences (per user, learned)

- Stay in TypeScript. Rust rewrite was considered and explicitly deferred.
- No comments unless the *why* is non-obvious. Identifiers explain *what*.
- Don't add features, refactors, or abstractions beyond what the task requires.
- Don't add error handling for impossible cases. Validate at boundaries only.
- One commit per coherent unit. Single commit is fine for multi-feature work when commits would be artificial.
- Default to acting; ask only when a decision has irreversible consequences or genuinely changes the design.

## Known limitations

- macOS only. Linux Ghostty has no AppleScript dictionary; the AX path doesn't exist.
- Multi-display works (`grid --screen <n>`, `seance screens`), but two macOS realities remain: (a) a window on another **Space** is invisible to Accessibility, so seance can't tile it until it's on the current Space — externals that cycle on/off strand windows this way (`gather` surfaces them); (b) `CGDirectDisplayID` re-enumerates when a display reconnects, so a group's saved `displayId` can go stale (falls back to main with a notice).
- `cwd` for `windows --assign` comes from `lsof` against the foreground PID — may return nothing for sandboxed children (e.g. some Claude Code invocations).
- TTY-based identity dies with the shell. Closing a window invalidates its `ttyPath`; you have to `group add` again from the new shell.

## Recent significant decisions (log)

- **2026-05-24:** Per-window OSC palette is the theming model (not global config swap). Drives `applyPaletteToTty`, reads Ghostty's bundled theme files at `/Applications/Ghostty.app/Contents/Resources/ghostty/themes/<name>`.
- **2026-05-24:** Targeting moved from "Ghostty id → AX index" (broken) to sentinel-via-TTY (works). Captured in invariant 1.
- **2026-05-24:** `save` emits a self-contained runnable AppleScript (gtab-inspired storage model). `restore` runs it via `osascript`; `--rebind` re-probes and updates state.
- **2026-05-24:** `group add` requires the slot/ttyPath/cwd trio. Pre-existing entries from earlier versions need re-adding.
- **2026-06-27:** Multi-display targeting. `listScreens()` enumerates all displays (pure `cocoaFramesToAx` flip, anchored to primary frame height); groups store a stable `CGDirectDisplayID`, not the volatile `NSScreen.screens` index. New: `seance screens`, `grid --screen <n>`, `summon`/`init` honour the saved display. Captured in invariant 3.
- **2026-06-27:** Ghostty 1.3.x exposes only its key window to AppleScript. `probeWindows` reworked to resolve via the AX sentinel alone; `ProbeRow.ghosttyId` made optional. This unblocked `windows --probe`/`--assign`/`init`, which had been returning zero windows under heavy Claude-Code load (first misdiagnosed as a title race). Captured in invariant 6.
- **2026-06-27:** `gather` added — re-tiles the windows reachable on the current Space and reports the rest as stranded (with each one's foreground command, e.g. `claude --resume <uuid>`) instead of failing silently.
- **2026-06-27:** Window cleanup labels show the repo (basename of cwd) instead of the raw tty.
