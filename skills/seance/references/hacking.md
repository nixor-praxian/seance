# Modifying seance

Read before editing `~/GitHub/seance`. These are the things that cost real time to rediscover.

## Contents

- Build and restart, or the fix is not live
- Invariants that must not be re-derived
- Where code belongs
- Testing
- Verifying anything that touches Accessibility

## Build and restart, or the fix is not live

The launchd watcher runs `dist/cli.js`, not `src/`, and a long-lived node process does not
reload. After changing source:

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.seance.watcher
```

Skipping either step produces a fix that tests green and changes nothing on screen. Confirm with
`pgrep -fl "cli.js watch"` and check the pid actually changed.

The Alfred workflow is a *copy* under `~/Library/Application Support/Alfred/...`. Changing
`alfred/seance-workflow/info.plist` in the repo does nothing until `seance alfred install`.

## Invariants that must not be re-derived

`CLAUDE.md` in the repo is authoritative and detailed. The four that get re-proposed most:

1. **Window targeting is sentinel-via-TTY.** Write OSC 2 to a window's TTY, match the title in
   System Events. Ghostty's window `id` is a tab-group id System Events cannot address, and
   `AXIdentifier` is the literal string `"TerminalWindowRestoration"` on *every* window. Do not
   propose an `AXIdentifier` shortcut.

2. **`setWindowBounds` is a batch operation.** Setting a window's position promotes it to
   frontmost, so a per-window loop targets the wrong window from the second iteration on. Capture
   every Accessibility reference first, then apply all rects.

3. **Exactly one Ghostty instance — never `open -n`.** Spawning goes through Ghostty's scripting
   dictionary. `ghosttyPid()` takes the *first* matching process, so with two instances perception
   silently sees only one instance's panes. When pane counts look wrong, count instances before
   suspecting the perception code:
   `pgrep -f "Ghostty.app/Contents/MacOS/" | wc -l`

4. **Minimized panes must be excluded before `setWindowBounds`, not after.** That function focuses
   each target to migrate it across Spaces, and focusing a minimized window restores it from the
   Dock. Both `arrange` and `organize` call `splitByVisibility` for this reason.

## Where code belongs

```
pure, testable anywhere:   layouts.ts groups.ts state.ts themes.ts contrast.ts
                           save.ts policy.ts arrange.ts sessions.ts
macOS-only side effects:   ghostty.ts   (osascript, JXA, TTY writes, execa)
composition:               cli.ts       (commander wiring)
```

Anything shelling out to `osascript`, writing to `/dev/ttysNNN`, or reading Ghostty's bundle
belongs in `ghostty.ts`. Keep `execa` out of the pure modules.

TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — optional
properties cannot be assigned `undefined`, so use spread-with-conditional:
`...(x ? { foo: x } : {})`.

## Testing

- Pure modules: `vitest` unit tests in `src/<name>.test.ts`, no mocking.
- CLI: black-box in `src/cli.test.ts`, spawning `tsx src/cli.ts` in an `mkdtemp` dir with
  `SEANCE_HOME` injected. These run against the real machine's Ghostty for perception, so never
  assert on live repos or pane counts — they are not deterministic.
- Logic that only reaches the user through an untestable path (perception, Accessibility) should
  be extracted into a pure function and tested there. `growGridToFit` in `layouts.ts` exists for
  exactly this reason.

`npm run typecheck && npm test` before every commit.

## Verifying anything that touches Accessibility

There is no automated coverage for System Events, TTY writes or window geometry — it is manual
only, and the manual test usually means rearranging the user's desk. Do not claim such a change is
verified because the suite passed. State plainly which parts are unverified and what the manual
check would be.

Two preconditions make manual verification meaningless if unmet: more than one Ghostty instance
running, and a stale `dist/`.
