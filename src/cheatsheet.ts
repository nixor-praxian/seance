export const CHEATSHEET = `# seance

Panes organize themselves by repo. One verb does everything.

## Everyday

- \`seance organize\` — perceive every pane, color by repo, place by policy, tile, paint. Idempotent, safe any time.
- \`seance organize <NxM> [--screen n] [--pin]\` — tile every pane into that shape for this run. \`--screen\` scopes it to one display; \`--pin\` remembers it.
- \`seance organize auto\` — clear every pinned grid and re-organize.
- \`seance place <repo> <NxM> [--screen n]\` — same, for one repo, and always pinned.
- \`seance place <repo> auto\` — clear that repo's pin.
- \`seance focus <repo>\` — raise and focus that repo's first pane.
- \`seance appearance dark|light|auto\` — pin theme resolution (or follow macOS), repaint everything.
- \`seance screens\` — list displays: index, stable id, size, position, role.

## Sessions

- \`seance session save [name]\` — snapshot each pane as (repo, cwd, claude resume uuid). Default name \`latest\`.
- \`seance session restore [name] [--repo <r>]\` — respawn what's missing, skip what's already live, then organize. Falls back to the watcher's rolling \`auto\` snapshot.
- \`seance session list\` — saved sessions with pane counts and age.
- \`seance resume <repo> [uuid]\` — bring back one dormant Claude conversation (most recent if no uuid).

## Alfred palette — type \`s \`

- \`s org\` — Organize
- \`s org 3x2\` — Organize into a 3x2 everywhere; \`s org 3x2 1\` for display 1 only
- \`s myapp\` — Focus myapp, plus that repo's restores and resumable conversations by title
- \`s myapp 3x2 1\` — Place myapp 3x2 on display 1. Repos prefix-match, so \`s mya 3x2\` works
- \`s myapp auto\` — clear the grid pin
- \`s dark\` — Appearance dark
- \`s save\` / \`s restore\` — snapshot the workspace / respawn missing panes
- \`s help\` (or \`s cheatsheet\`) — this page

Results come from live perception on each keystroke; the brief "Summoning…" is \`ps\`/\`lsof\` running.

## The watcher

\`seance watch --install\` writes a launchd agent and starts it. Every 2s it paints new panes with their repo's colors; every 10s it checks whether the display set changed and re-organizes if so. It never re-tiles otherwise, so it won't yank windows around while you work.

Logs: \`~/.config/seance/watcher.log\`. Remove with \`seance watch --uninstall\`. It runs the built CLI, so \`npm run build\` after changing source (then uninstall/install to restart it).

## How it decides

**1. Perception.** \`ps\` finds every Ghostty child TTY, \`lsof\` resolves each foreground process's cwd, \`repo = basename(cwd)\`. Rediscovered every run, never stored.

**2. Policy** — the only persisted state:

- **identity**: repo → theme pair, assigned on first sight and sticky. No two live repos share one.
- **placement**: ordered rules, repo → display role (\`main\`, \`external.left\`, \`external.right\`), \`*\` wildcard, first match wins. Roles are computed from live geometry, so a three-display policy is still correct on a laptop.
- **layout**: one number, \`minPaneWidth\` (384px) → \`cols = min(n, floor(width / 384))\`.

**3. Actuation.** Windows are branded via their TTYs, captured as Accessibility references first, then moved in one batch. Palettes are written per-window as OSC sequences, so five repos can sit side by side in five palettes.

## When it misbehaves

- **Windows don't move** — grant Accessibility to the terminal you run seance from: System Settings → Privacy & Security → Accessibility.
- **The Alfred keyword does nothing** — re-run \`seance alfred install\`. It bakes your node's PATH into the workflow, which Alfred otherwise runs under a sterile environment.
- **Every repo shows up as \`home\`** — \`lsof\` couldn't read a cwd (sandboxed child process). Those panes still get placed, just under the fallback name.
- **A pane disappeared** — it's alive on another macOS Space, where Accessibility can't see it. Bring it over with Mission Control, then organize. It still gets painted, since OSC crosses Spaces.
- **Terminal text is invisible** — Claude Code renders with its own fixed theme and its own text color, so a light terminal under a dark Claude theme means light-on-light. Pin the terminal to match: \`seance appearance dark\`.

## State

\`~/.config/seance/state.json\` — identity, placement, layout, appearance. Hand-editable; read fresh on every run. Note what's absent: no TTYs, no window ids, no display ids, no coordinates. Nothing that can go stale.
`;
