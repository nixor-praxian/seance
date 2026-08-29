export const CHEATSHEET = `# seance

Panes organize themselves by repo. One verb does everything.

## Everyday

- \`seance arrange\` — you figure it out: group every on-screen pane by repo, spread the repos across every display, shape each block to suit that display, paint. Skips minimized panes. Takes no grid.
- \`seance arrange <name>\` — apply a saved arrangement. \`seance arrange --save <name>\` records where the windows are now, moving nothing.
- \`seance organize\` — I want *this shape*: perceive every pane, color by repo, place by policy, tile, paint. Idempotent, safe any time. Skips minimized panes too.
- \`seance organize <NxM> [--screen n] [--pin]\` — tile every pane into that shape for this run. \`--screen\` scopes it to one display; \`--pin\` remembers it.
- \`seance organize auto\` — clear every pinned grid and re-organize.
- \`seance place <repo> <NxM> [--screen n]\` — same, for one repo, and always pinned.
- \`seance place <repo> auto\` — clear that repo's pin.
- \`seance focus <repo>\` — raise and focus that repo's first pane.
- \`seance appearance dark|light|auto\` — pin theme resolution (or follow macOS), repaint everything.
- \`seance reflow always|new|off\` — how the watcher reacts when you plug a display in. \`new\` (default) only re-tiles arrangements it hasn't seen; \`always\` re-tiles every time; \`off\` never touches geometry.
- \`seance screens\` — list displays: index, id, UUID, size, position, role. The id changes on reconnect; the UUID doesn't.

## Sessions

- \`seance session save [name]\` — snapshot each pane as (repo, cwd, claude resume uuid). Default name \`latest\`.
- \`seance session restore [name] [--repo <r>]\` — respawn what's missing, skip what's already live, then organize. Falls back to the watcher's rolling \`auto\` snapshot.
- \`seance session list\` — saved sessions with pane counts and age.
- \`seance resume <repo> [uuid]\` — bring back one dormant Claude conversation (most recent if no uuid).

## Alfred palette — type \`s \`

- \`s arrange\` — Arrange, plus every saved arrangement; \`s arrange save weekend\` freezes the current split
- \`s org\` — Organize
- \`s org 3x2\` — Organize into a 3x2 everywhere; \`s org 3x2 1\` for display 1 only
- \`s myapp\` — Focus myapp, plus that repo's restores and resumable conversations by title
- \`s myapp 3x2 1\` — Place myapp 3x2 on display 1. Repos prefix-match, so \`s mya 3x2\` works
- \`s organize myapp\` — Organize that one repo into an auto grid. A leading \`organize\`/\`place\`/\`arrange\` **scopes** the rest of the query, so \`s org mya\` finds the repo too
- \`s myapp auto\` — clear the grid pin
- \`s dark\` — Appearance dark
- \`s save\` / \`s restore\` — snapshot the workspace / respawn missing panes
- \`s help\` (or \`s cheatsheet\`) — this page

Results come from live perception on each keystroke; the brief "Summoning…" is \`ps\`/\`lsof\` running.

## The watcher

\`seance watch --install\` writes a launchd agent and starts it. Every 2s it paints new panes with their repo's colors and checks whether the display set changed. On a change it waits for the geometry to *settle* — macOS emits several transitions while it negotiates a new display — then acts on the shape that actually stuck. An arrangement it has already laid out is **left alone**: macOS restores window positions itself for a configuration it knows, and that restore is your real layout. A new arrangement gets one organize and is then remembered. It never re-tiles otherwise, and never moves a minimized pane. \`seance reflow always|off\` changes this.

Logs: \`~/.config/seance/watcher.log\`. Remove with \`seance watch --uninstall\`. It runs the built CLI, so \`npm run build\` after changing source (then uninstall/install to restart it).

## How it decides

**1. Perception.** \`ps\` finds every Ghostty child TTY, \`lsof\` resolves each foreground process's cwd, \`repo = basename(cwd)\`. Rediscovered every run, never stored.

**2. Policy** — the only persisted state:

- **identity**: repo → theme pair, assigned on first sight and sticky. No two live repos share one.
- **placement**: ordered rules, repo → display role (\`main\`, \`external.left\`, \`external.right\`), \`*\` wildcard, first match wins. Roles are computed from live geometry, so a three-display policy is still correct on a laptop. \`arrange\` obeys per-repo rules but ignores \`*\`, otherwise the seeded catch-all would leave it nothing to balance.
- **layout**: \`minPaneWidth\` (384px) and \`minPaneHeight\` (256px). \`organize\` uses the width alone (\`cols = min(n, floor(width / 384))\`); \`arrange\` uses both, picking the shape whose panes sit closest to 9:16 — a pane should be as portrait as the display is landscape, which is what makes a rotated display stack rows instead of slicing slivers.

**3. Actuation.** Windows are branded via their TTYs, captured as Accessibility references first, then moved in one batch. Palettes are written per-window as OSC sequences, so five repos can sit side by side in five palettes.

## When it misbehaves

- **Plugging in a display rearranged everything** — the watcher only re-tiles arrangements it hasn't laid out before, so this should happen once per new setup and never again. If it keeps happening: \`seance reflow off\`. If you *want* a re-tile every time: \`seance reflow always\`.
- **Windows don't move** — grant Accessibility to the terminal you run seance from: System Settings → Privacy & Security → Accessibility.
- **The Alfred keyword does nothing** — re-run \`seance alfred install\`. It bakes your node's PATH into the workflow, which Alfred otherwise runs under a sterile environment.
- **Every repo shows up as \`home\`** — \`lsof\` couldn't read a cwd (sandboxed child process). Those panes still get placed, just under the fallback name.
- **A pane disappeared** — it's alive on another macOS Space, where Accessibility can't see it. Bring it over with Mission Control, then organize. It still gets painted, since OSC crosses Spaces.
- **Terminal text is invisible** — Claude Code renders with its own fixed theme and its own text color, so a light terminal under a dark Claude theme means light-on-light. Pin the terminal to match: \`seance appearance dark\`.

## State

\`~/.config/seance/state.json\` — identity, placement, layout, appearance. Hand-editable; read fresh on every run. Note what's absent: no TTYs, no window ids, no display ids, no coordinates. Nothing that can go stale.
`;
