import { describe, it, expect } from "vitest";
import {
  columnsFirst,
  pinHome,
  tileFill,
  layoutScreen,
  displayCapacity,
  screenKeyForRect,
  assignFamilies,
} from "./arrange.js";
import type { PaneBudget, FamilyRequest, FamilyCount } from "./arrange.js";
import type { PlacementRule, PolicyScreen, Role } from "./policy.js";
import type { Rect } from "./types.js";

const BUDGET: PaneBudget = { minPaneWidth: 384, minPaneHeight: 256 };

const LAPTOP: Rect = { x: 0, y: 0, width: 1728, height: 1047 };
const EXT: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const PORTRAIT: Rect = { x: 0, y: 0, width: 1080, height: 1920 };

function fam(repo: string, count: number, grid?: { cols: number; rows: number }): FamilyRequest {
  return { repo, count, ...(grid ? { grid } : {}) };
}

function area(r: Rect): number {
  return r.width * r.height;
}

function sortRects(rects: Rect[]): Rect[] {
  return [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

describe("columnsFirst", () => {
  it("gives one column per pane while each stays above the width floor", () => {
    expect(columnsFirst(LAPTOP, 1, BUDGET)).toEqual({ cols: 1, rows: 1 });
    expect(columnsFirst(LAPTOP, 2, BUDGET)).toEqual({ cols: 2, rows: 1 });
    expect(columnsFirst(LAPTOP, 3, BUDGET)).toEqual({ cols: 3, rows: 1 });
    expect(columnsFirst(LAPTOP, 4, BUDGET)).toEqual({ cols: 4, rows: 1 });
    expect(columnsFirst(EXT, 5, BUDGET)).toEqual({ cols: 5, rows: 1 });
  });

  it("wraps to a new row once another column would breach the floor, balancing the rows", () => {
    expect(columnsFirst(LAPTOP, 5, BUDGET)).toEqual({ cols: 3, rows: 2 });
    expect(columnsFirst(LAPTOP, 8, BUDGET)).toEqual({ cols: 4, rows: 2 });
    expect(columnsFirst(LAPTOP, 9, BUDGET)).toEqual({ cols: 3, rows: 3 });
    expect(columnsFirst(EXT, 6, BUDGET)).toEqual({ cols: 3, rows: 2 });
  });

  it("never makes a column narrower than the floor", () => {
    for (const rect of [LAPTOP, EXT, PORTRAIT]) {
      for (let n = 1; n <= 30; n++) {
        const grid = columnsFirst(rect, n, BUDGET);
        expect(grid.cols * grid.rows).toBeGreaterThanOrEqual(n);
        expect((grid.cols - 1) * grid.rows).toBeLessThan(n);
        expect(rect.width / grid.cols).toBeGreaterThanOrEqual(BUDGET.minPaneWidth);
      }
    }
  });

  it("falls back to a single column on a rect narrower than one pane", () => {
    expect(columnsFirst({ x: 0, y: 0, width: 300, height: 800 }, 3, BUDGET)).toEqual({
      cols: 1,
      rows: 3,
    });
  });
});

describe("tileFill", () => {
  const BOX: Rect = { x: 0, y: 0, width: 1000, height: 800 };

  it("partitions the rect exactly when the grid is full", () => {
    const cells = tileFill(BOX, { cols: 3, rows: 2 }, 6);
    expect(cells).toHaveLength(6);
    expect(cells.reduce((sum, c) => sum + area(c), 0)).toBe(area(BOX));
    expect(cells.every((c) => Number.isInteger(c.x) && Number.isInteger(c.width))).toBe(true);
  });

  it("stretches a short final row to fill the width", () => {
    const cells = tileFill(BOX, { cols: 3, rows: 2 }, 5);
    expect(cells).toHaveLength(5);
    expect(cells[3]).toEqual({ x: 0, y: 400, width: 500, height: 400 });
    expect(cells[4]).toEqual({ x: 500, y: 400, width: 500, height: 400 });
  });

  it("returns the rect itself for a single pane", () => {
    expect(tileFill(BOX, { cols: 1, rows: 1 }, 1)).toEqual([BOX]);
  });

  it("never overlaps and always covers the whole rect", () => {
    for (const [cols, rows, count] of [
      [1, 1, 1],
      [2, 2, 3],
      [4, 2, 7],
      [3, 3, 8],
      [5, 1, 5],
      [2, 3, 6],
    ] as const) {
      const cells = tileFill(BOX, { cols, rows }, count);
      expect(cells).toHaveLength(count);
      expect(cells.reduce((sum, c) => sum + area(c), 0)).toBe(area(BOX));
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          expect(overlaps(cells[i]!, cells[j]!)).toBe(false);
        }
      }
    }
  });
});

describe("layoutScreen", () => {
  const cellsOf = (layout: ReturnType<typeof layoutScreen>): Rect[] =>
    layout.families.flatMap((f) => f.cells);

  it("tiles all of a display's panes as one grid, whatever the family split", () => {
    const layout = layoutScreen(LAPTOP, [fam("zeus", 2), fam("party", 2)], BUDGET);
    expect(layout.grid).toEqual({ cols: 4, rows: 1 });
    expect(cellsOf(layout)).toEqual(tileFill(LAPTOP, { cols: 4, rows: 1 }, 4));
    expect(new Set(cellsOf(layout).map((c) => c.height))).toEqual(new Set([LAPTOP.height]));
  });

  it("wraps five panes on a laptop to 3 + 2 instead of a column block beside a row block", () => {
    const layout = layoutScreen(LAPTOP, [fam("a", 2), fam("b", 2), fam("c", 1)], BUDGET);
    expect(layout.grid).toEqual({ cols: 3, rows: 2 });
    expect(layout.readable).toBe(true);
    for (const cell of cellsOf(layout)) {
      expect(cell.width).toBeGreaterThanOrEqual(BUDGET.minPaneWidth);
    }
  });

  it("keeps each family contiguous in reading order and preserves order and counts", () => {
    const families = [fam("a", 3), fam("b", 2), fam("c", 1)];
    const layout = layoutScreen(LAPTOP, families, BUDGET);
    expect(layout.families.map((f) => f.repo)).toEqual(["a", "b", "c"]);
    expect(layout.families.map((f) => f.cells.length)).toEqual([3, 2, 1]);
    expect(cellsOf(layout)).toEqual(tileFill(LAPTOP, layout.grid, 6));
  });

  it("covers the screen without overlap", () => {
    for (const rect of [LAPTOP, EXT, PORTRAIT]) {
      const cells = cellsOf(layoutScreen(rect, [fam("a", 3), fam("b", 4)], BUDGET));
      expect(cells.reduce((sum, c) => sum + area(c), 0)).toBe(area(rect));
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          expect(overlaps(cells[i]!, cells[j]!)).toBe(false);
        }
      }
    }
  });

  it("honours a pin when its family has the display to itself and ignores one too small", () => {
    const pinned = layoutScreen(LAPTOP, [fam("a", 4, { cols: 2, rows: 2 })], BUDGET);
    expect(pinned.grid).toEqual({ cols: 2, rows: 2 });

    const ignored = layoutScreen(LAPTOP, [fam("a", 4, { cols: 1, rows: 2 })], BUDGET);
    expect(ignored.grid).toEqual({ cols: 4, rows: 1 });
  });

  it("ignores pins when families share the display", () => {
    const layout = layoutScreen(LAPTOP, [fam("a", 2, { cols: 1, rows: 2 }), fam("b", 2)], BUDGET);
    expect(layout.grid).toEqual({ cols: 4, rows: 1 });
  });

  it("trims a pin the family has outgrown to the shape it actually gets", () => {
    const one = layoutScreen(LAPTOP, [fam("a", 1, { cols: 2, rows: 3 })], BUDGET);
    expect(one.grid).toEqual({ cols: 1, rows: 1 });
    expect(cellsOf(one)).toEqual([LAPTOP]);

    const three = layoutScreen(LAPTOP, [fam("a", 3, { cols: 2, rows: 3 })], BUDGET);
    expect(three.grid).toEqual({ cols: 2, rows: 2 });
  });

  it("flags an unreadable grid instead of throwing", () => {
    const layout = layoutScreen(EXT, [fam("a", 25)], BUDGET);
    expect(layout.grid).toEqual({ cols: 5, rows: 5 });
    expect(layout.readable).toBe(false);
  });

  it("handles the empty and single-pane cases", () => {
    expect(layoutScreen(LAPTOP, [], BUDGET).families).toEqual([]);
    expect(cellsOf(layoutScreen(LAPTOP, [fam("a", 1)], BUDGET))).toEqual([LAPTOP]);
  });

  it("is deterministic and does not mutate its input", () => {
    const families = [fam("a", 3), fam("b", 2)];
    const snapshot = JSON.parse(JSON.stringify(families)) as FamilyRequest[];
    expect(layoutScreen(LAPTOP, families, BUDGET)).toEqual(layoutScreen(LAPTOP, families, BUDGET));
    expect(families).toEqual(snapshot);
  });
});

describe("pinHome", () => {
  const laptop: PolicyScreen = { key: "LAPTOP", rect: LAPTOP, isMain: true };
  const roles = new Map<Role, PolicyScreen>([["main", laptop]]);

  it("is the display the pin was saved on, even while that display is gone", () => {
    expect(pinHome({ repo: "zeus", role: "external.right", display: "EXT-UUID" }, roles)).toBe(
      "EXT-UUID",
    );
  });

  it("is the role's display when no display was saved, and nothing when the role is absent", () => {
    expect(pinHome({ repo: "a", role: "main" }, roles)).toBe("LAPTOP");
    expect(pinHome({ repo: "a", role: "external.left" }, roles)).toBeUndefined();
  });
});

describe("displayCapacity", () => {
  it("counts readable panes, not area", () => {
    expect(displayCapacity(EXT, BUDGET)).toBe(20);
    expect(displayCapacity(LAPTOP, BUDGET)).toBe(16);
    expect(displayCapacity(PORTRAIT, BUDGET)).toBe(14);
    expect(displayCapacity({ x: 0, y: 0, width: 300, height: 300 }, BUDGET)).toBe(1);
  });

  it("rates a rotated display lower than the same panel landscape", () => {
    expect(area(PORTRAIT)).toBe(area(EXT));
    expect(displayCapacity(PORTRAIT, BUDGET)).toBeLessThan(displayCapacity(EXT, BUDGET));
  });
});

describe("screenKeyForRect", () => {
  const screens: PolicyScreen[] = [
    { key: "main", rect: LAPTOP, isMain: true },
    { key: "left", rect: { x: -1037, y: -1080, width: 1920, height: 1080 }, isMain: false },
  ];

  it("matches by centre point, including a negative-y external", () => {
    expect(screenKeyForRect({ x: 100, y: 100, width: 400, height: 400 }, screens)).toBe("main");
    expect(screenKeyForRect({ x: -900, y: -900, width: 400, height: 400 }, screens)).toBe("left");
  });

  it("falls back to the main screen when nothing contains the rect", () => {
    expect(screenKeyForRect({ x: 9000, y: 9000, width: 10, height: 10 }, screens)).toBe("main");
  });
});

describe("assignFamilies", () => {
  const main: PolicyScreen = { key: "m", rect: LAPTOP, isMain: true };
  const left: PolicyScreen = {
    key: "l",
    rect: { x: -1037, y: -1080, width: 1920, height: 1080 },
    isMain: false,
  };
  const right: PolicyScreen = {
    key: "r",
    rect: { x: 885, y: -1080, width: 1920, height: 1080 },
    isMain: false,
  };
  const roles = new Map<Role, PolicyScreen>([
    ["main", main],
    ["external.left", left],
    ["external.right", right],
  ]);

  function counts(...pairs: Array<[string, number]>): FamilyCount[] {
    return pairs.map(([repo, count]) => ({ repo, count }));
  }

  const LIVE_RIG = counts(
    ["mercury", 3],
    ["zephyr", 2],
    ["seance", 4],
    ["maple", 2],
    ["kestrel", 1],
    ["home", 1],
  );
  const PINS: PlacementRule[] = [
    { repo: "mercury", role: "external.left" },
    { repo: "zephyr", role: "external.left" },
    { repo: "seance", role: "external.left" },
    { repo: "*", role: "main" },
  ];

  it("honours explicit pins and balances the rest by fill ratio", () => {
    const { byScreen } = assignFamilies(LIVE_RIG, PINS, {}, roles, BUDGET);
    expect(byScreen.get("l")!.repos).toEqual(["mercury", "zephyr", "seance"]);
    expect(byScreen.get("r")!.repos).toEqual(["maple"]);
    expect(byScreen.get("m")!.repos).toEqual(["kestrel", "home"]);
  });

  it("ignores the catch-all rule so unpinned repos can balance", () => {
    const { byScreen } = assignFamilies(
      counts(["a", 1], ["b", 1], ["c", 1]),
      [{ repo: "*", role: "main" }],
      {},
      roles,
      BUDGET,
    );
    expect(byScreen.size).toBe(3);
  });

  it("places the largest family first", () => {
    const twoScreens = new Map<Role, PolicyScreen>([
      ["main", main],
      ["external.left", left],
    ]);
    const { byScreen } = assignFamilies(
      counts(["a", 1], ["b", 1], ["c", 5]),
      [],
      {},
      twoScreens,
      BUDGET,
    );
    const withC = [...byScreen.values()].find((v) => v.repos.includes("c"))!;
    expect(withC.repos).toEqual(["c"]);
  });

  it("is idempotent when its own output is fed back in", () => {
    const first = assignFamilies(LIVE_RIG, PINS, {}, roles, BUDGET);
    const second = assignFamilies(LIVE_RIG, PINS, first.autoPlacement, roles, BUDGET);
    expect(second.byScreen).toEqual(first.byScreen);
    expect(second.autoPlacement).toEqual(first.autoPlacement);
  });

  it("keeps a family on its previous display within the hysteresis band", () => {
    const families = counts(["a", 2], ["b", 2]);
    const sticky = assignFamilies(families, [], { a: "external.right" }, roles, BUDGET);
    expect(sticky.autoPlacement.a).toBe("external.right");
  });

  it("moves a family when its previous display is decisively worse", () => {
    const families = counts(["big", 18], ["a", 1]);
    const pinned: PlacementRule[] = [{ repo: "big", role: "external.right" }];
    const moved = assignFamilies(families, pinned, { a: "external.right" }, roles, BUDGET);
    expect(moved.autoPlacement.a).not.toBe("external.right");
  });

  it("keeps an over-tall pinned grid from leaving a band half empty", () => {
    const cells = layoutScreen(LAPTOP, [fam("a", 6, { cols: 2, rows: 4 })], BUDGET).families.flatMap(
      (p) => p.cells,
    );
    expect(cells.reduce((sum, c) => sum + area(c), 0)).toBe(area(LAPTOP));
  });

  it("drops a remembered role whose display went away", () => {
    const onlyMain = new Map<Role, PolicyScreen>([["main", main]]);
    const { byScreen, autoPlacement } = assignFamilies(
      counts(["a", 2]),
      [],
      { a: "external.right" },
      onlyMain,
      BUDGET,
    );
    expect(byScreen.get("m")!.repos).toEqual(["a"]);
    expect(autoPlacement.a).toBe("main");
  });

  it("resolves a pin naming an absent role rather than throwing", () => {
    const onlyMain = new Map<Role, PolicyScreen>([["main", main]]);
    const { byScreen } = assignFamilies(
      counts(["a", 2]),
      [{ repo: "a", role: "external.left" }],
      {},
      onlyMain,
      BUDGET,
    );
    expect(byScreen.get("m")!.repos).toEqual(["a"]);
  });

  it("reports a display left empty by pins without overriding them", () => {
    const { byScreen, notes } = assignFamilies(
      counts(["mercury", 3], ["zephyr", 2], ["seance", 4]),
      PINS,
      {},
      roles,
      BUDGET,
    );
    expect(byScreen.size).toBe(1);
    expect(notes).toContainEqual({
      kind: "empty-role",
      role: "external.right",
      pinnedElsewhere: ["mercury", "seance", "zephyr"],
    });
    expect(notes).toContainEqual({
      kind: "empty-role",
      role: "main",
      pinnedElsewhere: ["mercury", "seance", "zephyr"],
    });
  });

  it("reports a display loaded past capacity", () => {
    const { notes } = assignFamilies(
      counts(["a", 25]),
      [{ repo: "a", role: "external.left" }],
      {},
      roles,
      BUDGET,
    );
    expect(notes).toContainEqual({
      kind: "over-capacity",
      role: "external.left",
      panes: 25,
      capacity: 20,
    });
  });

  it("counts a display once when two roles resolve to it", () => {
    const oneExternal = new Map<Role, PolicyScreen>([
      ["main", main],
      ["external.left", left],
    ]);
    const { byScreen } = assignFamilies(counts(["a", 1]), [], {}, oneExternal, BUDGET);
    expect([...byScreen.keys()]).toHaveLength(1);
  });

  it("uses every display, and keeps a pinned repo's display to pinned repos", () => {
    const top = (key: string, x: number): PolicyScreen => ({
      key,
      rect: { x, y: -2160, width: 1920, height: 1080 },
      isMain: false,
    });
    const topLeft = top("tl", -1037);
    const topRight = top("tr", 883);
    const all = [main, topRight, topLeft, left, right];
    const rules: PlacementRule[] = [
      { repo: "mercury", role: "external.left" },
      { repo: "zephyr", role: "external.right" },
      { repo: "*", role: "main" },
    ];
    const { byScreen } = assignFamilies(
      counts(["mercury", 2], ["zephyr", 2], ["a", 3], ["b", 2], ["c", 2], ["d", 1], ["e", 1]),
      rules,
      {},
      roles,
      BUDGET,
      all,
    );
    expect(byScreen.get("l")!.repos).toEqual(["mercury"]);
    expect(byScreen.get("r")!.repos).toEqual(["zephyr"]);
    for (const key of ["m", "tl", "tr"]) expect(byScreen.get(key)?.repos.length).toBeGreaterThan(0);
  });

  it("pins a repo to a display no role reaches", () => {
    const fifth: PolicyScreen = {
      key: "UUID-5",
      rect: { x: 3000, y: 0, width: 1920, height: 1080 },
      isMain: false,
    };
    const { byScreen } = assignFamilies(
      counts(["a", 1], ["b", 1]),
      [{ repo: "a", role: "main", display: "UUID-5" }],
      {},
      roles,
      BUDGET,
      [main, left, right, fifth],
    );
    expect(byScreen.get("UUID-5")).toEqual({ role: "display 3", repos: ["a"] });
  });

  it("remembers a display without a role by its key", () => {
    const fifth: PolicyScreen = {
      key: "UUID-5",
      rect: { x: 3000, y: 0, width: 1920, height: 1080 },
      isMain: false,
    };
    const { autoPlacement } = assignFamilies(
      counts(["a", 2], ["b", 2]),
      [],
      { a: "UUID-5" },
      roles,
      BUDGET,
      [main, left, right, fifth],
    );
    expect(autoPlacement.a).toBe("UUID-5");
  });

  it("does not mutate its inputs", () => {
    const families = counts(["a", 1], ["b", 2]);
    const rules: PlacementRule[] = [{ repo: "a", role: "main" }];
    const auto: Record<string, string> = { b: "external.left" };
    const snapshot = JSON.stringify({ families, rules, auto });
    assignFamilies(families, rules, auto, roles, BUDGET);
    expect(JSON.stringify({ families, rules, auto })).toBe(snapshot);
  });
});
