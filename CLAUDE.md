# CLAUDE.md — seance project guidance

## What this is

A macOS-only TypeScript CLI for orchestrating Ghostty windows: named groups, screen-proportional grids, save/restore via runnable AppleScript, per-window theme application via OSC palette. See `README.md` for user-facing detail.

## Architecture invariants (don't re-break these)

1. **Window targeting goes through sentinel-via-TTY**, never Ghostty `id` ↔ AX index. Ghostty's window `id` is a tab-group identifier System Events cannot address; AX `AXIdentifier` on Ghostty windows is the literal string `"TerminalWindowRestoration"` (NSWindow autosave name), identical for every window. The two namespaces are disjoint. The only reliable bridge is writing OSC 2 to the window's TTY and matching by title in System Events. This was painfully discovered — don't propose `AXIdentifier`-based shortcuts.

2. **`setWindowBounds` is a batch operation.** Never resize windows one-at-a-time in a loop: each `position` set promotes the moved window to frontmost, so the next iteration's `window 1` is the wrong window. The current implementation captures all AX references first inside a single AppleScript, then applies all rects.

3. **`mainScreenFrame()` uses `NSScreen.visibleFrame` via JXA**, never Finder's `bounds of window of desktop`. Finder returns the full display including the menu-bar zone, so tiles end up under the menu bar.

4. **Themes apply per-window via OSC sequences**, not globally via Ghostty config. Editing `~/Library/Application Support/com.mitchellh.ghostty/config` recolors *every* Ghostty window — which defeats the per-group point. `applyPaletteToTty` writes `OSC 4`/`OSC 10`/`OSC 11`/`OSC 12` to each window's TTY.

5. **WindowRef requires `ttyPath`, `slot`, and `cwd`** to be useful for `grid`/`save`. `group add` captures all three. If you add another command that consumes these, gracefully tell the user to re-`group add` when entries are missing them.

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
npm test              # vitest, all suites (~37 tests across 4 files)
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
- Single display. `mainScreenFrame()` returns only the main screen; multi-display tiling is on the roadmap.
- `cwd` for `windows --assign` comes from `lsof` against the foreground PID — may return nothing for sandboxed children (e.g. some Claude Code invocations).
- TTY-based identity dies with the shell. Closing a window invalidates its `ttyPath`; you have to `group add` again from the new shell.

## Recent significant decisions (log)

- **2026-05-24:** Per-window OSC palette is the theming model (not global config swap). Drives `applyPaletteToTty`, reads Ghostty's bundled theme files at `/Applications/Ghostty.app/Contents/Resources/ghostty/themes/<name>`.
- **2026-05-24:** Targeting moved from "Ghostty id → AX index" (broken) to sentinel-via-TTY (works). Captured in invariant 1.
- **2026-05-24:** `save` emits a self-contained runnable AppleScript (gtab-inspired storage model). `restore` runs it via `osascript`; `--rebind` re-probes and updates state.
- **2026-05-24:** `group add` requires the slot/ttyPath/cwd trio. Pre-existing entries from earlier versions need re-adding.
