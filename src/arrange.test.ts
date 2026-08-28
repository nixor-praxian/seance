import { describe, it, expect } from "vitest";
import {
  chooseGrid,
  gridFits,
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

describe("chooseGrid", () => {
  it("reproduces the historical layouts", () => {
    expect(chooseGrid(LAPTOP, 4, BUDGET)).toEqual({ cols: 4, rows: 1 });
    expect(chooseGrid(LAPTOP, 8, BUDGET)).toEqual({ cols: 4, rows: 2 });
    expect(chooseGrid(LAPTOP, 2, BUDGET)).toEqual({ cols: 2, rows: 1 });
    expect(chooseGrid(EXT, 5, BUDGET)).toEqual({ cols: 5, rows: 1 });
  });

  it("prefers an exact fit over a closer aspect with an empty column", () => {
    expect(chooseGrid(LAPTOP, 6, BUDGET)).toEqual({ cols: 3, rows: 2 });
    expect(chooseGrid(EXT, 7, BUDGET)).toEqual({ cols: 4, rows: 2 });
  });

  it("fills columns first while they stay above the width floor", () => {
    expect(chooseGrid(EXT, 1, BUDGET)).toEqual({ cols: 1, rows: 1 });
    expect(chooseGrid(EXT, 3, BUDGET)).toEqual({ cols: 3, rows: 1 });
    expect(chooseGrid(EXT, 4, BUDGET)).toEqual({ cols: 4, rows: 1 });
  });

  it("stacks rows on a portrait display instead of making slivers", () => {
    expect(chooseGrid(PORTRAIT, 2, BUDGET)).toEqual({ cols: 1, rows: 2 });
    expect(chooseGrid(PORTRAIT, 4, BUDGET)).toEqual({ cols: 2, rows: 2 });
    expect(chooseGrid(PORTRAIT, 5, BUDGET)).toEqual({ cols: 2, rows: 3 });
    expect(chooseGrid(PORTRAIT, 8, BUDGET)).toEqual({ cols: 2, rows: 4 });
  });

  it("never leaves a structurally empty row or column", () => {
    for (const rect of [LAPTOP, EXT, PORTRAIT]) {
      for (let n = 1; n <= 20; n++) {
        const { cols, rows } = chooseGrid(rect, n, BUDGET);
        expect(cols * rows).toBeGreaterThanOrEqual(n);
        if (gridFits(rect, { cols, rows }, BUDGET)) {
          expect((cols - 1) * rows).toBeLessThan(n);
          expect(cols * (rows - 1)).toBeLessThan(n);
        }
      }
    }
  });

  it("keeps every pane above both floors while the display can", () => {
    for (const rect of [LAPTOP, EXT, PORTRAIT]) {
      const capacity = displayCapacity(rect, BUDGET);
      for (let n = 1; n <= capacity; n++) {
        const grid = chooseGrid(rect, n, BUDGET);
        expect(gridFits(rect, grid, BUDGET)).toBe(true);
      }
    }
  });

  it("preserves width and surrenders height past capacity", () => {
    expect(chooseGrid(EXT, 25, BUDGET)).toEqual({ cols: 5, rows: 5 });
    expect(gridFits(EXT, { cols: 5, rows: 5 }, BUDGET)).toBe(false);
    expect(gridFits(EXT, { cols: 5, rows: 4 }, BUDGET)).toBe(true);
  });

  it("falls back to a single column on a rect narrower than one pane", () => {
    expect(chooseGrid({ x: 0, y: 0, width: 300, height: 800 }, 3, BUDGET)).toEqual({
      cols: 1,
      rows: 3,
    });
  });

  it("is deterministic and does not mutate its input", () => {
    const rect = { ...LAPTOP };
    expect(chooseGrid(rect, 7, BUDGET)).toEqual(chooseGrid(rect, 7, BUDGET));
    expect(rect).toEqual(LAPTOP);
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
  it("gives repo cohesion for free — two families of four are the historical 4x2", () => {
    const placements = layoutScreen(LAPTOP, [fam("a", 4), fam("b", 4)], BUDGET);
    expect(placements.map((p) => p.grid)).toEqual([
      { cols: 2, rows: 2 },
      { cols: 2, rows: 2 },
    ]);
    const cells = placements.flatMap((p) => p.cells);
    expect(sortRects(cells)).toEqual(sortRects(tileFill(LAPTOP, { cols: 4, rows: 2 }, 8)));
  });

  it("matches the historical 4x1 and 5x1 whatever the family split", () => {
    const laptop = layoutScreen(LAPTOP, [fam("a", 1), fam("b", 1), fam("c", 2)], BUDGET);
    expect(sortRects(laptop.flatMap((p) => p.cells))).toEqual(
      sortRects(tileFill(LAPTOP, { cols: 4, rows: 1 }, 4)),
    );

    for (const families of [
      [fam("a", 1), fam("b", 4)],
      [fam("a", 2), fam("b", 2), fam("c", 1)],
    ]) {
      const ext = layoutScreen(EXT, families, BUDGET);
      expect(sortRects(ext.flatMap((p) => p.cells))).toEqual(
        sortRects(tileFill(EXT, { cols: 5, rows: 1 }, 5)),
      );
    }
  });

  it("keeps every family inside one band that its cells exactly fill", () => {
    const corpus: FamilyRequest[][] = [
      [fam("a", 3), fam("b", 2), fam("c", 1)],
      [fam("a", 1), fam("b", 1)],
      [fam("a", 5), fam("b", 1), fam("c", 2), fam("d", 1)],
      [fam("a", 2), fam("b", 2), fam("c", 2), fam("d", 2)],
    ];
    for (const families of corpus) {
      for (const rect of [LAPTOP, EXT, PORTRAIT]) {
        for (const placement of layoutScreen(rect, families, BUDGET)) {
          const xs = placement.cells.map((c) => c.x);
          const ys = placement.cells.map((c) => c.y);
          const right = Math.max(...placement.cells.map((c) => c.x + c.width));
          const bottom = Math.max(...placement.cells.map((c) => c.y + c.height));
          expect({
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: right - Math.min(...xs),
            height: bottom - Math.min(...ys),
          }).toEqual(placement.band);
          expect(placement.cells.reduce((sum, c) => sum + area(c), 0)).toBe(area(placement.band));
        }
      }
    }
  });

  it("covers the screen without overlap and preserves family order and counts", () => {
    const families = [fam("a", 3), fam("b", 2), fam("c", 1)];
    const placements = layoutScreen(LAPTOP, families, BUDGET);
    expect(placements.map((p) => p.repo)).toEqual(["a", "b", "c"]);
    expect(placements.map((p) => p.cells.length)).toEqual([3, 2, 1]);

    const cells = placements.flatMap((p) => p.cells);
    expect(cells.reduce((sum, c) => sum + area(c), 0)).toBe(area(LAPTOP));
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(overlaps(cells[i]!, cells[j]!)).toBe(false);
      }
    }
  });

  it("gives every pane the same area regardless of repo", () => {
    const cells = layoutScreen(EXT, [fam("a", 1), fam("b", 4)], BUDGET).flatMap((p) => p.cells);
    expect(new Set(cells.map((c) => `${c.width}x${c.height}`)).size).toBe(1);
  });

  it("is a no-op at one family", () => {
    const [placement] = layoutScreen(LAPTOP, [fam("a", 4)], BUDGET);
    expect(placement!.band).toEqual(LAPTOP);
    expect(placement!.grid).toEqual({ cols: 4, rows: 1 });
  });

  it("stacks bands top to bottom on a portrait display", () => {
    const placements = layoutScreen(
      PORTRAIT,
      [fam("a", 1), fam("b", 1), fam("c", 1), fam("d", 1), fam("e", 1)],
      BUDGET,
    );
    expect(placements).toHaveLength(5);
    for (const p of placements) {
      expect(p.band.x).toBe(0);
      expect(p.band.width).toBe(1080);
      expect(p.band.height).toBe(384);
    }
    expect(placements.map((p) => p.band.y)).toEqual([0, 384, 768, 1152, 1536]);
  });

  it("recurses into a band grid when the long axis cannot hold every family", () => {
    const placements = layoutScreen(
      LAPTOP,
      ["a", "b", "c", "d", "e", "f"].map((r) => fam(r, 1)),
      BUDGET,
    );
    expect(placements).toHaveLength(6);
    expect(new Set(placements.map((p) => p.band.x)).size).toBe(2);
    expect(new Set(placements.map((p) => p.band.y)).size).toBe(3);
    for (const p of placements) {
      expect(p.band.width).toBe(864);
      expect(p.band.height).toBe(349);
    }
  });

  it("clamps bands to the floors when there are more families than fit", () => {
    const placements = layoutScreen(
      LAPTOP,
      ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((r) => fam(r, 1)),
      BUDGET,
    );
    expect(placements).toHaveLength(9);
    for (const p of placements) {
      expect(p.band.width).toBeGreaterThanOrEqual(384);
      expect(p.band.height).toBeGreaterThanOrEqual(256);
    }
  });

  it("honours a pinned grid inside the family's band and ignores one too small", () => {
    const pinned = layoutScreen(LAPTOP, [fam("a", 2), fam("b", 4, { cols: 2, rows: 2 })], BUDGET);
    expect(pinned[1]!.grid).toEqual({ cols: 2, rows: 2 });

    const ignored = layoutScreen(LAPTOP, [fam("a", 4, { cols: 1, rows: 2 })], BUDGET);
    expect(ignored[0]!.grid).toEqual({ cols: 4, rows: 1 });
  });

  it("trims a pin the family has outgrown to the shape it actually gets", () => {
    const [one] = layoutScreen(LAPTOP, [fam("a", 1, { cols: 2, rows: 3 })], BUDGET);
    expect(one!.grid).toEqual({ cols: 1, rows: 1 });
    expect(one!.cells).toEqual([LAPTOP]);

    const three = layoutScreen(LAPTOP, [fam("a", 3, { cols: 2, rows: 3 })], BUDGET);
    expect(three[0]!.grid).toEqual({ cols: 2, rows: 2 });
  });

  it("flags an unreadable band instead of throwing", () => {
    const [placement] = layoutScreen(EXT, [fam("a", 25)], BUDGET);
    expect(placement!.grid).toEqual({ cols: 5, rows: 5 });
    expect(placement!.readable).toBe(false);
  });

  it("handles the empty and single-pane cases", () => {
    expect(layoutScreen(LAPTOP, [], BUDGET)).toEqual([]);
    expect(layoutScreen(LAPTOP, [fam("a", 1)], BUDGET)[0]!.cells).toEqual([LAPTOP]);
  });

  it("is deterministic and does not mutate its input", () => {
    const families = [fam("a", 3), fam("b", 2)];
    const snapshot = JSON.parse(JSON.stringify(families)) as FamilyRequest[];
    expect(layoutScreen(LAPTOP, families, BUDGET)).toEqual(layoutScreen(LAPTOP, families, BUDGET));
    expect(families).toEqual(snapshot);
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
    ["meridian", 2],
    ["karafe", 1],
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
    expect(byScreen.get("r")!.repos).toEqual(["meridian"]);
    expect(byScreen.get("m")!.repos).toEqual(["karafe", "home"]);
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
    const cells = layoutScreen(LAPTOP, [fam("a", 6, { cols: 2, rows: 4 })], BUDGET).flatMap(
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

  it("does not mutate its inputs", () => {
    const families = counts(["a", 1], ["b", 2]);
    const rules: PlacementRule[] = [{ repo: "a", role: "main" }];
    const auto: Record<string, Role> = { b: "external.left" };
    const snapshot = JSON.stringify({ families, rules, auto });
    assignFamilies(families, rules, auto, roles, BUDGET);
    expect(JSON.stringify({ families, rules, auto })).toBe(snapshot);
  });
});
