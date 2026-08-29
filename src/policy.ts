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
 * Who keeps a pair when several live repos wear it. Pinned always wins;
 * otherwise the incumbent does. Ordering by name alone let a transient repo
 * evict an established one purely by sorting earlier — observed as `seance`
 * losing its colour to a wandering `mnemosyne` pane on consecutive passes.
 */
function pickKeeper(colliders: string[], identity: Record<string, IdentityEntry>): string {
  const pinned = colliders.find((repo) => identity[repo]?.pinned);
  if (pinned) return pinned;
  const age = (repo: string): string => identity[repo]?.assignedAt ?? "";
  let best = colliders[0]!;
  for (const repo of colliders) {
    if (age(repo) < age(best) || (age(repo) === age(best) && repo < best)) best = repo;
  }
  return best;
}

export function assignThemes(
  liveRepos: string[],
  identity: Record<string, IdentityEntry>,
  ring: string[],
  now: string = new Date().toISOString(),
): {
  identity: Record<string, IdentityEntry>;
  changes: Array<{ repo: string; pair: string; reason: "new" | "collision" }>;
} {
  const live = [...new Set(liveRepos)].sort();
  const result: Record<string, IdentityEntry> = { ...identity };
  const changes: Array<{ repo: string; pair: string; reason: "new" | "collision" }> = [];

  const wearers = new Map<string, string[]>();
  for (const repo of live) {
    const entry = identity[repo];
    if (!entry) continue;
    const worn = wearers.get(entry.pair);
    if (worn) worn.push(repo);
    else wearers.set(entry.pair, [repo]);
  }

  const losers = new Set<string>();
  for (const colliders of wearers.values()) {
    if (colliders.length < 2) continue;
    const keeper = pickKeeper(colliders, identity);
    for (const repo of colliders) if (repo !== keeper) losers.add(repo);
  }

  const pairsInIdentity = new Set<string>(Object.values(identity).map((e) => e.pair));
  const pairsWornByLive = new Set<string>();
  for (const repo of live) {
    const entry = identity[repo];
    if (entry && !losers.has(repo)) pairsWornByLive.add(entry.pair);
  }

  let assignIndex = 0;
  for (const repo of live) {
    const existing = identity[repo];
    if (existing && !losers.has(repo)) continue;
    const free =
      ring.find((p) => !pairsInIdentity.has(p)) ?? ring.find((p) => !pairsWornByLive.has(p));
    // With nothing free, the old code handed back a pair someone else was
    // already wearing. That leaves this repo a collision loser on the next
    // pass, and the pass after, forever — one real watcher log accumulated
    // 31,025 identical reassignments of a single repo this way, each one a
    // state write. A duplicate colour is stable; an endlessly reassigned one
    // is not, so an established repo keeps what it has.
    if (free === undefined && existing) continue;
    const pick = free ?? ring[assignIndex % ring.length]!;
    const bg = existing?.bg;
    result[repo] = {
      pair: pick,
      ...(bg !== undefined ? { bg } : {}),
      assignedAt: now,
    };
    pairsInIdentity.add(pick);
    pairsWornByLive.add(pick);
    changes.push({ repo, pair: pick, reason: existing ? "collision" : "new" });
    assignIndex++;
  }

  return { identity: result, changes };
}
