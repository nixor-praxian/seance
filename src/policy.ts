import type { Rect, GridSpec } from "./types.js";

export interface LivePane {
  ttyPath: string;
  cwd: string;
  command?: string;
}

export interface PolicyScreen {
  key: string;
  rect: Rect;
  isMain: boolean;
}

export type Role = "main" | "external.left" | "external.right";

export interface PlacementRule {
  repo: string;
  role: Role;
  /** Explicit grid pin (`seance place`). Absent = auto-grid from minPaneWidth. */
  grid?: GridSpec;
}

export interface IdentityEntry {
  pair: string;
  bg?: string | { dark: string; light: string };
  pinned?: boolean;
  /**
   * When this repo was given this pair. Decides who keeps a colour in a
   * collision: the incumbent, not whoever sorts first. Absent on entries
   * written before this existed, which are treated as the oldest.
   */
  assignedAt?: string;
  /**
   * Background hue added so this repo stands apart from the repos open beside
   * it when it was first seen; `null` keeps the theme's own background. Chosen
   * once, like `pair`. A `bg` override takes precedence.
   */
  tint?: number | null;
}

export function repoOf(cwd: string, home: string): string {
  const stripped = cwd.replace(/\/+$/, "");
  if (stripped === "") return "root";
  if (stripped === home) return "home";
  return stripped.slice(stripped.lastIndexOf("/") + 1);
}

export function computeRoles(screens: PolicyScreen[]): Map<Role, PolicyScreen> {
  const roles = new Map<Role, PolicyScreen>();
  const main = screens.find((s) => s.isMain) ?? screens[0];
  if (!main) return roles;
  roles.set("main", main);
  const externals = screens.filter((s) => s !== main).sort((a, b) => a.rect.x - b.rect.x);
  const [left, right] = externals;
  if (left) roles.set("external.left", left);
  if (right) roles.set("external.right", right);
  return roles;
}

export function resolveRole(role: Role, roles: Map<Role, PolicyScreen>): PolicyScreen {
  const exact = roles.get(role);
  if (exact) return exact;
  if (role !== "main") {
    const other = roles.get(role === "external.left" ? "external.right" : "external.left");
    if (other) return other;
  }
  const main = roles.get("main");
  if (main) return main;
  return roles.values().next().value!;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function placePanes(
  panes: LivePane[],
  rules: PlacementRule[],
  roles: Map<Role, PolicyScreen>,
  home: string,
): Map<string, LivePane[]> {
  const placed = panes.map((pane) => {
    const repo = repoOf(pane.cwd, home);
    const matchIndex = rules.findIndex((r) => r.repo === repo || r.repo === "*");
    const role: Role = matchIndex === -1 ? "main" : rules[matchIndex]!.role;
    return {
      pane,
      repo,
      ruleIndex: matchIndex === -1 ? rules.length : matchIndex,
      screenKey: resolveRole(role, roles).key,
    };
  });
  placed.sort(
    (a, b) =>
      a.ruleIndex - b.ruleIndex ||
      compareStrings(a.repo, b.repo) ||
      compareStrings(a.pane.ttyPath, b.pane.ttyPath),
  );
  const grouped = new Map<string, LivePane[]>();
  for (const { screenKey, pane } of placed) {
    const list = grouped.get(screenKey);
    if (list) list.push(pane);
    else grouped.set(screenKey, [pane]);
  }
  return grouped;
}

export function autoGrid(n: number, screenWidth: number, minPaneWidth: number): GridSpec {
  if (n === 0) return { cols: 1, rows: 1 };
  const cols = Math.max(1, Math.min(n, Math.floor(screenWidth / minPaneWidth)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
}

/**
 * Which of several live repos wearing one pair keeps it unshaded. Pinned
 * first, then the incumbent, then name: a transient repo must never take the
 * plain colour from an established one just by sorting earlier.
 */
function keeperOrder(identity: Record<string, IdentityEntry>) {
  const age = (repo: string): string => identity[repo]?.assignedAt ?? "";
  return (a: string, b: string): number => {
    const pinned = Number(!!identity[b]?.pinned) - Number(!!identity[a]?.pinned);
    if (pinned !== 0) return pinned;
    return compareStrings(age(a), age(b)) || compareStrings(a, b);
  };
}

/**
 * Shade per live repo, separating live repos that share a pair without
 * touching anyone's stored identity. Shade 0 is the pair as registered.
 */
export function liveShades(liveRepos: string[], identity: Record<string, IdentityEntry>): Map<string, number> {
  const byPair = new Map<string, string[]>();
  for (const repo of new Set(liveRepos)) {
    const entry = identity[repo];
    if (!entry) continue;
    byPair.set(entry.pair, [...(byPair.get(entry.pair) ?? []), repo]);
  }
  const shades = new Map<string, number>();
  for (const wearers of byPair.values()) {
    wearers.sort(keeperOrder(identity)).forEach((repo, i) => shades.set(repo, i));
  }
  return shades;
}

export interface PaneProcess {
  pid: number;
  ppid: number;
  tty: string;
  command: string;
}

/**
 * Per Ghostty pane: the shell `login` started, whose cwd is the pane's
 * identity for its whole life, and the shell's foreground command. Never the
 * newest process on the tty: that is usually a transient child that may be
 * gone before its cwd can be read, and after PID wraparound it can be `login`
 * itself, which is root-owned and has no readable cwd.
 */
export function selectPaneProcesses(
  procs: PaneProcess[],
  ghosttyPid: number,
): Array<{ tty: string; shellPid: number; command: string }> {
  const out: Array<{ tty: string; shellPid: number; command: string }> = [];
  for (const login of procs) {
    if (login.ppid !== ghosttyPid || !/^ttys\d+/.test(login.tty)) continue;
    const shell = procs.find((p) => p.ppid === login.pid && p.tty === login.tty);
    if (!shell) continue;
    const foreground = procs
      .filter((p) => p.ppid === shell.pid && p.tty === shell.tty)
      .reduce<PaneProcess | undefined>((a, p) => (!a || p.pid > a.pid ? p : a), undefined);
    out.push({ tty: login.tty, shellPid: shell.pid, command: (foreground ?? shell).command });
  }
  return out.sort((a, b) => compareStrings(a.tty, b.tty));
}

/** The repo owning a linked worktree, from the worktree's `.git` file. */
export function worktreeMainRoot(gitFile: string): string | undefined {
  const m = /^gitdir:\s*(.+?)\/\.git\/worktrees\/[^/]+\s*$/.exec(gitFile.trim());
  return m?.[1];
}

/**
 * Throwaway working directories that must never earn a lasting identity.
 *
 * Agent worktrees are created one per run under a unique name, so an entry for
 * one is dead the moment it is written, and every one of them held
 * a pair hostage in a ring that real repos were competing for.
 *
 * Deliberately narrow: it matches the generated shape exactly, so a real repo
 * that merely starts with the same letters is untouched.
 */
export function isEphemeralRepo(repo: string): boolean {
  return /^temp_git_\d+_[a-z0-9]+$/i.test(repo);
}

export function assignThemes(
  liveRepos: string[],
  identity: Record<string, IdentityEntry>,
  ring: string[],
  now: string = new Date().toISOString(),
): {
  identity: Record<string, IdentityEntry>;
  changes: Array<{ repo: string; pair: string; reason: "new" }>;
} {
  const live = [...new Set(liveRepos)].filter((r) => !isEphemeralRepo(r)).sort();
  const result: Record<string, IdentityEntry> = { ...identity };
  // Drop any that were recorded before they were recognised as throwaway, so
  // the pairs they were holding return to the ring.
  for (const repo of Object.keys(result)) {
    if (isEphemeralRepo(repo)) delete result[repo];
  }
  const changes: Array<{ repo: string; pair: string; reason: "new" }> = [];

  // Write-once: a repo keeps the pair it was first given, whoever else is
  // open. Rewriting a collision loser made colour depend on the company a
  // repo kept, which is the one thing a per-repo colour must not do.
  const wornByLive = new Set<string>();
  const wearers = new Map<string, number>();
  for (const [repo, entry] of Object.entries(result)) {
    wearers.set(entry.pair, (wearers.get(entry.pair) ?? 0) + 1);
    if (live.includes(repo)) wornByLive.add(entry.pair);
  }

  for (const repo of live) {
    if (result[repo]) continue;
    const candidates = ring.some((p) => !wornByLive.has(p)) ? ring.filter((p) => !wornByLive.has(p)) : ring;
    const pick = candidates.reduce((best, p) => ((wearers.get(p) ?? 0) < (wearers.get(best) ?? 0) ? p : best));
    result[repo] = { pair: pick, assignedAt: now };
    wornByLive.add(pick);
    wearers.set(pick, (wearers.get(pick) ?? 0) + 1);
    changes.push({ repo, pair: pick, reason: "new" });
  }

  return { identity: result, changes };
}

export type ReflowDecision = "unchanged" | "shrunk" | "known" | "reflow";

/**
 * What the watcher does once the display set has settled. Losing displays is
 * never a reason to re-tile: it is almost always transient (a replug, sleep,
 * a dock renegotiating), and a reflow onto the survivors outlives it, because
 * the full set then returns as a known arrangement and is left alone.
 * Signatures are `|`-joined, one entry per display.
 */
export function reflowDecision(input: {
  settled: string;
  previous: string;
  known: boolean;
  mode: "new" | "always";
}): ReflowDecision {
  if (input.settled === input.previous) return "unchanged";
  if (input.settled.split("|").length < input.previous.split("|").length) return "shrunk";
  if (input.mode === "new" && input.known) return "known";
  return "reflow";
}
