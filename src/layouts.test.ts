import { describe, it, expect } from "vitest";
import {
  parseGrid,
  parseCustomColumns,
  tileGrid,
  tileCustomColumns,
  tile,
} from "./layouts.js";
import type { Rect } from "./types.js";

const screen: Rect = { x: 0, y: 0, width: 1000, height: 800 };

describe("parseGrid", () => {
  it("parses NxM", () => {
    expect(parseGrid("2x2")).toEqual({ cols: 2, rows: 2 });
    expect(parseGrid("2X4")).toEqual({ cols: 2, rows: 4 });
    expect(parseGrid("  3 x 1  ")).toEqual({ cols: 3, rows: 1 });
  });

  it("rejects bad input", () => {
    expect(() => parseGrid("2")).toThrow();
    expect(() => parseGrid("0x2")).toThrow();
    expect(() => parseGrid("2x0")).toThrow();
    expect(() => parseGrid("abc")).toThrow();
  });
});

describe("parseCustomColumns", () => {
  it("parses weights", () => {
    expect(parseCustomColumns("1,3")).toEqual([1, 3]);
    expect(parseCustomColumns("2, 1, 1")).toEqual([2, 1, 1]);
  });

  it("rejects non-positive weights", () => {
    expect(() => parseCustomColumns("1,0")).toThrow();
    expect(() => parseCustomColumns("-1,2")).toThrow();
    expect(() => parseCustomColumns("abc")).toThrow();
  });
});

describe("tileGrid", () => {
  it("tiles a 2x2 with no gap", () => {
    const rects = tileGrid(screen, { cols: 2, rows: 2 });
    expect(rects).toHaveLength(4);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    expect(rects[1]).toEqual({ x: 500, y: 0, width: 500, height: 400 });
    expect(rects[2]).toEqual({ x: 0, y: 400, width: 500, height: 400 });
    expect(rects[3]).toEqual({ x: 500, y: 400, width: 500, height: 400 });
  });

  it("tiles a 2x4 in row-major order", () => {
    const rects = tileGrid(screen, { cols: 2, rows: 4 });
    expect(rects).toHaveLength(8);
    expect(rects[0]?.y).toBe(0);
    expect(rects[1]?.y).toBe(0);
    expect(rects[2]?.y).toBe(200);
    expect(rects[7]).toEqual({ x: 500, y: 600, width: 500, height: 200 });
  });

  it("respects gap", () => {
    const rects = tileGrid(screen, { cols: 2, rows: 1 }, { gap: 10 });
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 495, height: 800 });
    expect(rects[1]).toEqual({ x: 505, y: 0, width: 495, height: 800 });
  });

  it("respects padding", () => {
    const rects = tileGrid(screen, { cols: 1, rows: 1 }, { padding: 20 });
    expect(rects[0]).toEqual({ x: 20, y: 20, width: 960, height: 760 });
  });

  it("rounds to whole pixels", () => {
    const rects = tileGrid(screen, { cols: 3, rows: 1 });
    expect(rects.every((r) => Number.isInteger(r.x) && Number.isInteger(r.width))).toBe(true);
  });
});

describe("tileCustomColumns", () => {
  it("weights columns proportionally", () => {
    const rects = tileCustomColumns(screen, { cols: [1, 3] });
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 250, height: 800 });
    expect(rects[1]).toEqual({ x: 250, y: 0, width: 750, height: 800 });
  });

  it("supports multiple rows", () => {
    const rects = tileCustomColumns(screen, { cols: [1, 1], rows: 2 });
    expect(rects).toHaveLength(4);
    expect(rects[0]?.height).toBe(400);
    expect(rects[2]?.y).toBe(400);
  });
});

describe("tile dispatcher", () => {
  it("dispatches grid specs", () => {
    expect(tile(screen, { cols: 2, rows: 1 })).toHaveLength(2);
  });

  it("dispatches custom column specs", () => {
    expect(tile(screen, { cols: [1, 1, 1] })).toHaveLength(3);
  });
});
