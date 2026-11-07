import type { Rect, GridSpec } from "./types.js";
import type { PlacementRule, PolicyScreen, Role } from "./policy.js";
import { ruleScreen } from "./policy.js";

export interface PaneBudget {
  minPaneWidth: number;
  minPaneHeight: number;
}

export interface FamilyRequest {
  repo: string;
  count: number;
  /** Explicit pin (PlacementRule.grid), passed only on the display the pin was made for. */
  grid?: GridSpec;
}

export interface ScreenLayout {
  grid: GridSpec;
  /** False when the grid could not honour both floors; the caller surfaces it. */
  readable: boolean;
  /** One entry per input family, in input order, each holding exactly `count` cells. */
  families: Array<{ repo: string; cells: Rect[] }>;
}

export interface FamilyCount {
  repo: string;
  count: number;
}

/** `role` is the display's role, or `display <n>` for one beyond the three roles. */
export type PlacementNote =
  | { kind: "empty-role"; role: string; pinnedElsewhere: string[] }
  | { kind: "over-capacity"; role: string; panes: number; capacity: number };

/** A family must beat its previous display by this much fill before it moves. */
const HYSTERESIS = 0.15;

const ROLE_ORDER: Role[] = ["main", "external.left", "external.right"];

export function gridFits(rect: Rect, grid: GridSpec, budget: PaneBudget): boolean {
  return (
    rect.width / grid.cols >= budget.minPaneWidth &&
    rect.height / grid.rows >= budget.minPaneHeight
  );
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
 * Columns first: as many as the display holds at minPaneWidth, then a new row.
 * Rows are balanced afterwards, so 5 panes on a four-column display are 3 + 2,
 * not 4 + 1 with one pane stretched across the whole width.
 */
export function columnsFirst(rect: Rect, n: number, budget: PaneBudget): GridSpec {
  if (n <= 1) return { cols: 1, rows: 1 };
  const fit = Math.max(1, Math.min(n, Math.floor(rect.width / budget.minPaneWidth)));
  const rows = Math.ceil(n / fit);
  return { cols: Math.ceil(n / rows), rows };
}

/**
 * One column-first grid for every pane on the display, with each family's
 * panes contiguous in reading order. Splitting the display into a block per
 * family first is what gave one repo full-height columns and its neighbour a
 * half-height row.
 *
 * A pinned grid is honoured only when its family has the display to itself,
 * and trimmed to the pane count. A pin smaller than the count is ignored.
 */
export function layoutScreen(
  screen: Rect,
  families: FamilyRequest[],
  budget: PaneBudget,
): ScreenLayout {
  const total = families.reduce((sum, f) => sum + f.count, 0);
  const only = families.length === 1 ? families[0]! : undefined;
  const pin = only?.grid && only.grid.cols * only.grid.rows >= total ? only.grid : undefined;
  const grid = pin
    ? { cols: Math.min(pin.cols, total), rows: Math.ceil(total / Math.min(pin.cols, total)) }
    : columnsFirst(screen, total, budget);
  const cells = tileFill(screen, grid, total);
  let at = 0;
  return {
    grid,
    readable: gridFits(screen, grid, budget),
    families: families.map((f) => {
      const own = cells.slice(at, at + f.count);
      at += f.count;
      return { repo: f.repo, cells: own };
    }),
  };
}

/** The display a rule's grid was made for. A grid is a shape for one display, not for any. */
export function pinHome(rule: PlacementRule, roles: Map<Role, PolicyScreen>): string | undefined {
  return rule.display ?? roles.get(rule.role)?.key;
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
 * everything else balances by fill ratio, largest family first, over every
 * connected display (`screens`; the three roles alone when omitted).
 *
 * A display that holds a pinned repo is reserved for pinned repos: pinning
 * mercury to a screen means "mercury's screen", and balancing the rest onto it
 * because it looked emptiest is exactly what the pin was for. Only when every
 * display holds a pin does balancing fall back to all of them.
 *
 * A `"*"` rule is deliberately ignored here. `ensurePolicy` seeds one for every
 * user, so honouring it would make balancing structurally impossible — that
 * catch-all is what `organize` obeys, and declining to obey it is the whole
 * difference between the two verbs.
 *
 * `autoPlacement` remembers a role where the display has one, since a role is
 * re-derived from live geometry, and the display key (UUID) otherwise.
 */
export function assignFamilies(
  families: FamilyCount[],
  rules: PlacementRule[],
  autoPlacement: Record<string, string>,
  roles: Map<Role, PolicyScreen>,
  budget: PaneBudget,
  screens: PolicyScreen[] = [],
): {
  byScreen: Map<string, { role: string; repos: string[] }>;
  autoPlacement: Record<string, string>;
  notes: PlacementNote[];
} {
  interface Target {
    label: string;
    memo: string;
    screen: PolicyScreen;
    capacity: number;
    load: number;
    repos: string[];
    reserved: boolean;
  }

  const targets: Target[] = [];
  const add = (screen: PolicyScreen, label: string, memo: string): void => {
    if (targets.some((t) => t.screen.key === screen.key)) return;
    targets.push({
      label,
      memo,
      screen,
      capacity: displayCapacity(screen.rect, budget),
      load: 0,
      repos: [],
      reserved: false,
    });
  };
  for (const role of ROLE_ORDER) {
    const screen = roles.get(role);
    if (screen) add(screen, role, role);
  }
  screens.forEach((screen, i) => add(screen, `display ${i}`, screen.key));
  if (targets.length === 0) {
    return { byScreen: new Map(), autoPlacement: { ...autoPlacement }, notes: [] };
  }

  const order = new Map(families.map((f, i) => [f.repo, i]));
  const pinned = new Map<string, PlacementRule>();
  for (const family of families) {
    const rule = rules.find((r) => r.repo === family.repo);
    if (rule) pinned.set(family.repo, rule);
  }

  for (const family of families) {
    const rule = pinned.get(family.repo);
    if (rule === undefined) continue;
    const screen = ruleScreen(rule, roles, screens);
    const target = targets.find((t) => t.screen.key === screen.key) ?? targets[0]!;
    target.load += family.count;
    target.repos.push(family.repo);
    target.reserved = true;
  }

  const open = targets.some((t) => !t.reserved) ? targets.filter((t) => !t.reserved) : targets;
  const remembered = (memo: string | undefined): Target | undefined => {
    if (memo === undefined) return undefined;
    const screen = roles.get(memo as Role) ?? screens.find((s) => s.key === memo);
    return screen ? open.find((t) => t.screen.key === screen.key) : undefined;
  };

  const nextAuto: Record<string, string> = { ...autoPlacement };
  const free = families
    .filter((f) => !pinned.has(f.repo))
    .sort((a, b) => b.count - a.count || compareStrings(a.repo, b.repo));

  for (const family of free) {
    const fill = (t: Target): number => (t.load + family.count) / t.capacity;
    let best = open[0]!;
    for (const t of open) if (fill(t) < fill(best)) best = t;

    const previous = remembered(autoPlacement[family.repo]);
    const chosen = previous && fill(previous) <= fill(best) + HYSTERESIS ? previous : best;

    chosen.load += family.count;
    chosen.repos.push(family.repo);
    nextAuto[family.repo] = chosen.memo;
  }

  const byScreen = new Map<string, { role: string; repos: string[] }>();
  for (const target of targets) {
    if (target.repos.length === 0) continue;
    const repos = [...target.repos].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    byScreen.set(target.screen.key, { role: target.label, repos });
  }

  const pinnedRepos = [...pinned.keys()].sort(compareStrings);
  const notes: PlacementNote[] = [];
  for (const target of targets) {
    if (target.repos.length === 0) {
      notes.push({ kind: "empty-role", role: target.label, pinnedElsewhere: pinnedRepos });
    }
    if (target.load > target.capacity) {
      notes.push({
        kind: "over-capacity",
        role: target.label,
        panes: target.load,
        capacity: target.capacity,
      });
    }
  }

  return { byScreen, autoPlacement: nextAuto, notes };
}

function edges(origin: number, extent: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round(origin + (extent * i) / count));
  return out;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
