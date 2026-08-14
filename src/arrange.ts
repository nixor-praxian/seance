import type { Rect, GridSpec } from "./types.js";
import type { PlacementRule, PolicyScreen, Role } from "./policy.js";
import { resolveRole } from "./policy.js";

export interface PaneBudget {
  minPaneWidth: number;
  minPaneHeight: number;
}

export interface FamilyRequest {
  repo: string;
  count: number;
  /** Explicit pin (PlacementRule.grid), applied inside this family's band. */
  grid?: GridSpec;
}

export interface FamilyPlacement {
  repo: string;
  band: Rect;
  grid: GridSpec;
  /** Exactly `count` rects, row-major within the band, last row stretched to fill. */
  cells: Rect[];
  /** False when the band could not honour both floors — the caller surfaces it. */
  readable: boolean;
}

export interface FamilyCount {
  repo: string;
  count: number;
}

export type PlacementNote =
  | { kind: "empty-role"; role: Role; pinnedElsewhere: string[] }
  | { kind: "over-capacity"; role: Role; panes: number; capacity: number };

/**
 * A pane should be as portrait as the display is landscape: 9/16 is the
 * geometric mean of every pane aspect this project has historically tiled to
 * (4x1 and 4x2 on a 1728x1047 laptop, 2x1 on the same, 5x1 on a 1920x1080),
 * to within 0.05%.
 */
const TARGET_ASPECT = 9 / 16;

/**
 * Per-pane penalty for an empty cell. Deliberately not tuned: the empty
 * row/column prune in chooseGrid decides every historical case on its own, and
 * they all survive any weight in [0, 8].
 */
const WASTE_WEIGHT = 1;

/** A family must beat its previous display by this much fill before it moves. */
const HYSTERESIS = 0.15;

const ROLE_ORDER: Role[] = ["main", "external.left", "external.right"];

const EPSILON = 1e-9;

export function gridFits(rect: Rect, grid: GridSpec, budget: PaneBudget): boolean {
  return (
    rect.width / grid.cols >= budget.minPaneWidth &&
    rect.height / grid.rows >= budget.minPaneHeight
  );
}

/**
 * Pick the grid for `n` panes in `rect`. Candidates must leave no structurally
 * empty row or column and must keep every pane above both floors; among those,
 * the one whose panes sit closest to TARGET_ASPECT wins.
 *
 * With no candidate the floors are unsatisfiable, so width is preserved and
 * height surrendered: a terminal below ~49 columns wraps and stops being
 * readable, whereas one below 14 rows merely scrolls.
 */
export function chooseGrid(rect: Rect, n: number, budget: PaneBudget): GridSpec {
  if (n <= 1) return { cols: 1, rows: 1 };

  const landscape = rect.width >= rect.height;
  const aligned = (g: GridSpec): boolean => (landscape ? g.cols >= g.rows : g.rows >= g.cols);

  const candidates: Array<{ cost: number; grid: GridSpec }> = [];
  for (let cols = 1; cols <= n; cols++) {
    for (let rows = 1; rows <= n; rows++) {
      if (cols * rows < n) continue;
      if ((cols - 1) * rows >= n || cols * (rows - 1) >= n) continue;
      const grid = { cols, rows };
      if (!gridFits(rect, grid, budget)) continue;
      const aspect = rect.width / cols / (rect.height / rows);
      const cost =
        Math.abs(Math.log(aspect / TARGET_ASPECT)) + (WASTE_WEIGHT * (cols * rows - n)) / n;
      candidates.push({ cost, grid });
    }
  }

  if (candidates.length === 0) {
    const cols = Math.max(1, Math.min(n, Math.floor(rect.width / budget.minPaneWidth)));
    return { cols, rows: Math.ceil(n / cols) };
  }

  candidates.sort(
    (a, b) =>
      (Math.abs(a.cost - b.cost) < EPSILON ? 0 : a.cost - b.cost) ||
      (aligned(a.grid) === aligned(b.grid) ? 0 : aligned(a.grid) ? -1 : 1) ||
      b.grid.cols - a.grid.cols ||
      b.grid.rows - a.grid.rows,
  );
  return candidates[0]!.grid;
}

/**
 * Tile `rect` into exactly `count` rects, row-major. A short final row stretches
 * to fill the width rather than leaving holes: a hole is dead space no
 * neighbouring family can structurally reach, and stretching only ever widens a
 * pane, so it can never breach minPaneWidth.
 *
 * Cell edges are cumulative rounded offsets, so the cells partition the rect
 * exactly — no seams, no overlap.
 */
export function tileFill(rect: Rect, grid: GridSpec, count: number): Rect[] {
  const ys = edges(rect.y, rect.height, grid.rows);
  const out: Rect[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const remaining = count - r * grid.cols;
    if (remaining <= 0) break;
    const k = Math.min(grid.cols, remaining);
    const xs = edges(rect.x, rect.width, k);
    for (let c = 0; c < k; c++) {
      out.push({
        x: xs[c]!,
        y: ys[r]!,
        width: xs[c + 1]! - xs[c]!,
        height: ys[r + 1]! - ys[r]!,
      });
    }
  }
  return out;
}

/**
 * Split a screen into one contiguous band per family — along the long axis, so
 * a landscape display yields columns and a portrait one yields stacked rows —
 * then tile each family inside its own band. Band extent is proportional to
 * pane count with full perpendicular extent, so every pane gets the same area
 * regardless of which repo it belongs to.
 *
 * Returns one placement per input family, in input order.
 */
export function layoutScreen(
  screen: Rect,
  families: FamilyRequest[],
  budget: PaneBudget,
): FamilyPlacement[] {
  if (families.length === 0) return [];

  if (families.length === 1) {
    const family = families[0]!;
    const pin =
      family.grid && family.grid.cols * family.grid.rows >= family.count ? family.grid : undefined;
    const base = pin ?? chooseGrid(screen, family.count, budget);
    // An oversized pin (2x3 holding one pane) would describe a shape the band
    // doesn't actually have — tileFill stretches to fill either way — so the
    // grid is trimmed to what the count needs. chooseGrid never needs this.
    const cols = Math.min(base.cols, family.count);
    const grid = { cols, rows: Math.ceil(family.count / cols) };
    return [
      {
        repo: family.repo,
        band: screen,
        grid,
        cells: tileFill(screen, grid, family.count),
        readable: gridFits(screen, grid, budget),
      },
    ];
  }

  const axis = splitAxis(screen, budget);
  const origin = axis === "x" ? screen.x : screen.y;
  const extent = axis === "x" ? screen.width : screen.height;
  const minExtent = axis === "x" ? budget.minPaneWidth : budget.minPaneHeight;
  const total = families.reduce((sum, f) => sum + f.count, 0);

  const flat = proportionalEdges(
    origin,
    extent,
    families.map((f) => f.count),
    total,
  );
  const bands = families.map((_, i) => sliceRect(screen, axis, flat[i]!, flat[i + 1]!));
  const flatIsReadable = bands.every((band, i) =>
    gridFits(band, chooseGrid(band, families[i]!.count, budget), budget),
  );
  if (flatIsReadable) {
    return families.flatMap((family, i) => layoutScreen(bands[i]!, [family], budget));
  }

  const at = balancedSplit(families);
  const left = families.slice(0, at);
  const leftCount = left.reduce((sum, f) => sum + f.count, 0);
  const low = minExtent / extent;
  const high = 1 - low;
  const raw = leftCount / total;
  const fraction = low <= high ? Math.min(Math.max(raw, low), high) : 0.5;
  const cut = origin + Math.round(extent * fraction);
  return [
    ...layoutScreen(sliceRect(screen, axis, origin, cut), left, budget),
    ...layoutScreen(sliceRect(screen, axis, cut, origin + extent), families.slice(at), budget),
  ];
}

/**
 * How many readable panes a display holds. Not area: rotating a 1920x1080 to
 * portrait leaves 312px of width that no pane can use, which area accounting
 * hands you for free (both score 21.1) and the floor product does not (20 vs 14).
 */
export function displayCapacity(rect: Rect, budget: PaneBudget): number {
  return Math.max(
    1,
    Math.floor(rect.width / budget.minPaneWidth) * Math.floor(rect.height / budget.minPaneHeight),
  );
}

export function screenKeyForRect(rect: Rect, screens: PolicyScreen[]): string {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hit = screens.find(
    (s) =>
      cx >= s.rect.x &&
      cx < s.rect.x + s.rect.width &&
      cy >= s.rect.y &&
      cy < s.rect.y + s.rect.height,
  );
  const fallback = screens.find((s) => s.isMain) ?? screens[0];
  return (hit ?? fallback)?.key ?? "";
}

/**
 * Assign families to displays. Explicit per-repo rules are honoured absolutely;
 * everything else balances by fill ratio, largest family first.
 *
 * A `"*"` rule is deliberately ignored here. `ensurePolicy` seeds one for every
 * user, so honouring it would make balancing structurally impossible — that
 * catch-all is what `organize` obeys, and declining to obey it is the whole
 * difference between the two verbs.
 */
export function assignFamilies(
  families: FamilyCount[],
  rules: PlacementRule[],
  autoPlacement: Record<string, Role>,
  roles: Map<Role, PolicyScreen>,
  budget: PaneBudget,
): {
  byScreen: Map<string, { role: Role; repos: string[] }>;
  autoPlacement: Record<string, Role>;
  notes: PlacementNote[];
} {
  interface Target {
    role: Role;
    screen: PolicyScreen;
    capacity: number;
    load: number;
    repos: string[];
  }

  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const role of ROLE_ORDER) {
    const screen = roles.get(role);
    if (!screen || seen.has(screen.key)) continue;
    seen.add(screen.key);
    targets.push({
      role,
      screen,
      capacity: displayCapacity(screen.rect, budget),
      load: 0,
      repos: [],
    });
  }
  if (targets.length === 0) {
    return { byScreen: new Map(), autoPlacement: { ...autoPlacement }, notes: [] };
  }

  const order = new Map(families.map((f, i) => [f.repo, i]));
  const pinned = new Map<string, Role>();
  for (const family of families) {
    const rule = rules.find((r) => r.repo === family.repo);
    if (rule) pinned.set(family.repo, rule.role);
  }

  for (const family of families) {
    const role = pinned.get(family.repo);
    if (role === undefined) continue;
    const screen = resolveRole(role, roles);
    const target = targets.find((t) => t.screen.key === screen.key) ?? targets[0]!;
    target.load += family.count;
    target.repos.push(family.repo);
  }

  const nextAuto: Record<string, Role> = { ...autoPlacement };
  const free = families
    .filter((f) => !pinned.has(f.repo))
    .sort((a, b) => b.count - a.count || compareStrings(a.repo, b.repo));

  for (const family of free) {
    const fill = (t: Target): number => (t.load + family.count) / t.capacity;
    let best = targets[0]!;
    for (const t of targets) if (fill(t) < fill(best)) best = t;

    const previousRole = autoPlacement[family.repo];
    const previousScreen = previousRole === undefined ? undefined : roles.get(previousRole);
    const previous = previousScreen
      ? targets.find((t) => t.screen.key === previousScreen.key)
      : undefined;
    const chosen = previous && fill(previous) <= fill(best) + HYSTERESIS ? previous : best;

    chosen.load += family.count;
    chosen.repos.push(family.repo);
    nextAuto[family.repo] = chosen.role;
  }

  const byScreen = new Map<string, { role: Role; repos: string[] }>();
  for (const target of targets) {
    if (target.repos.length === 0) continue;
    const repos = [...target.repos].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    byScreen.set(target.screen.key, { role: target.role, repos });
  }

  const pinnedRepos = [...pinned.keys()].sort(compareStrings);
  const notes: PlacementNote[] = [];
  for (const target of targets) {
    if (target.repos.length === 0) {
      notes.push({ kind: "empty-role", role: target.role, pinnedElsewhere: pinnedRepos });
    }
    if (target.load > target.capacity) {
      notes.push({
        kind: "over-capacity",
        role: target.role,
        panes: target.load,
        capacity: target.capacity,
      });
    }
  }

  return { byScreen, autoPlacement: nextAuto, notes };
}

function splitAxis(rect: Rect, budget: PaneBudget): "x" | "y" {
  const long: "x" | "y" = rect.width >= rect.height ? "x" : "y";
  const short: "x" | "y" = long === "x" ? "y" : "x";
  const holdsTwo = (axis: "x" | "y"): boolean =>
    (axis === "x" ? rect.width : rect.height) >=
    2 * (axis === "x" ? budget.minPaneWidth : budget.minPaneHeight);
  return holdsTwo(long) || !holdsTwo(short) ? long : short;
}

function balancedSplit(families: FamilyRequest[]): number {
  const total = families.reduce((sum, f) => sum + f.count, 0);
  let at = 1;
  let bestDiff = Infinity;
  let accumulated = 0;
  for (let i = 1; i < families.length; i++) {
    accumulated += families[i - 1]!.count;
    const diff = Math.abs(accumulated - (total - accumulated));
    if (diff < bestDiff) {
      bestDiff = diff;
      at = i;
    }
  }
  return at;
}

function sliceRect(rect: Rect, axis: "x" | "y", from: number, to: number): Rect {
  return axis === "x"
    ? { x: from, y: rect.y, width: to - from, height: rect.height }
    : { x: rect.x, y: from, width: rect.width, height: to - from };
}

function edges(origin: number, extent: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round(origin + (extent * i) / count));
  return out;
}

function proportionalEdges(
  origin: number,
  extent: number,
  counts: number[],
  total: number,
): number[] {
  const out = [origin];
  let accumulated = 0;
  for (const count of counts) {
    accumulated += count;
    out.push(Math.round(origin + (extent * accumulated) / total));
  }
  return out;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
