# seance 2.0 — the summonable terminal workspace

*2026-07-26. Direction: a crossover between a launcher, a shortcut manager,
and Ghostty — summonable, self-maintaining. The original binding-heavy CLI
model is acknowledged as a mistake; this document is the reversal.*

## The diagnosis

seance 1.x has memory but no perception. It stores **bindings** — tty paths,
display ids, slot numbers — and every one of those facts decays: shells die,
macOS recycles tty numbers onto other repos' panes, display ids re-enumerate on
reconnect. Observed end state: 29 dead-or-recycled window refs across 15
groups, and a `theme apply` that would have painted the wrong repo's pane.
State-as-bindings rots. State-as-policy doesn't.

## Three inversions

### 1. Bindings → Perception

Identity is computed at every act, never stored: enumerate Ghostty child ttys
(`ps`), resolve pid → cwd (`lsof`), repo = basename(cwd). A pane *is* its
repo. Groups become computed equivalence classes of live panes; `group add`
is deleted. Drift is impossible by construction.

AX is touched only at act time, via the existing sentinel-via-TTY bridge
(invariant 1 — unchanged).

### 2. Coordinates → Policy

The only persistent state:

```jsonc
{
  "identity": {
    // sticky repo → theme pair; auto-assigned on first sighting, manual pins win
    "zephyr":    "Gruvbox Material",
    "mercury": { "pair": "Rose Pine", "bg": { "dark": "#2e4636", "light": "#eef4e8" } }
  },
  "placement": [
    // ordered rules on display ROLES, computed from live geometry each time:
    // main = isMain; externals sorted by x → external.left / external.right.
    // Never an NSScreen index, never a CGDirectDisplayID.
    ["mercury", "external.left"],
    ["zephyr",    "external.right"],
    ["*",       "main"]
  ],
  "layout": { "minPaneWidth": 384 },
  "appearance": "dark"   // unchanged: must match Claude Code's fixed theme
}
```

- **Auto-grid:** `cols = min(n, ⌊screenWidth / minPaneWidth⌋)`,
  `rows = ⌈n / cols⌉`. Reproduces every historical hand-picked layout:
  5×1 on 1920px externals, 4×1/4×2 on the 1728px laptop.
- **Profiles for free:** rules referencing absent roles fall through to
  `main`. One screen or three, same policy — docked vs nomad is not a mode.
- **Color assignment:** ring = registered theme pairs **minus Catppuccin**
  (the global Ghostty default = the "unpainted" look; no repo may wear it).
  Collision-free among live repos, sticky once assigned (persisted so colors
  never shuffle between days), manual pins always win. Ring overflow →
  deterministic background tints on a shared base pair.
- **Within a display:** panes sorted so same-repo panes are adjacent —
  contiguous color blocks, recognizability at a glance.

### 3. Typed commands → Summon

One idempotent verb: **`seance organize`** = perceive → assign colors →
place → tile → paint. Safe at any moment, from CLI, hotkey, palette, or
watcher event. Everything else is refinement (`summon <repo>`, `gather`,
`theme`, sessions).

Surfaces, in order of build:

1. **Alfred 5 workflow** (installed; the palette). Script Filter over a new
   `seance json query "<q>"` mode → fuzzy actions: empty query = Organize /
   Gather / Save session; `zeu` = Summon zephyr / Theme / Focus next pane.
   Ships in-repo (`alfred/`), installed via `seance alfred install`.
2. **Shortcut manager:** Alfred hotkeys mapped to seance verbs
   (⌥1…⌥9 = summon nth repo, ⌥O = organize). Declared in seance config,
   compiled into the workflow.
3. **Watcher daemon** (launchd, `com.seance.watcher`): polls `ps` ~2s
   (cheap, zero AX). New pane → auto-painted with its repo color within a
   beat. Display set change → debounced `organize` reflow. It never re-tiles
   spontaneously otherwise — no window yanking mid-thought.
4. **Sessions v2:** a session = the set of (repo, cwd, command) — including
   `claude --resume <uuid>` captured per pane — restorable regardless of
   machine state. Replaces window-bound save/restore.

Ghostty 1.3.1 facts (recon 2026-07-26): `global:` keybinds and
`toggle_quick_terminal` supported; no per-quick-terminal command config. A
quick-terminal TUI palette remains a possible second surface later; Alfred is
the primary.

## What survives untouched

The actuator layer and all CLAUDE.md invariants: sentinel-via-TTY targeting,
batched AX bounds-setting, per-pane OSC palette writes, NSScreen
visibleFrame geometry with the Cocoa→AX flip, appearance-must-match-Claude.
They keep doing the pushing; they stop deciding what to push.

## Roadmap

| Phase | Deliverable | Kills |
|---|---|---|
| 1 | `policy.ts` (pure, tested) + perception in `ghostty.ts` + `seance organize` + state v2 migration | drift, `group add`, stale display ids |
| 2 | Alfred workflow + `seance json` protocol | the CLI as primary surface |
| 3 | watcher daemon: auto-paint, display-change reflow | ever typing `theme apply` again |
| 4 | Alfred hotkey chords + repo-keyed sessions | stranded-session grief |

Module boundaries unchanged: perception (ps/lsof/osascript) lives in
`ghostty.ts`; `policy.ts` is pure and Linux-testable; `cli.ts` composes.

## Locked defaults (veto anytime)

- Palette host: **Alfred 5** (installed; muscle memory; TS↔JSON glue-free).
- Watcher autonomy: **auto-paint always; auto-tile only on display events.**
