import type { Rect, LayoutSpec, GridSpec, CustomColumnsSpec } from "./types.js";

export interface LayoutOptions {
  /** Pixel gap between tiles. Default 0. */
  gap?: number;
  /** Outer padding from the screen edge. Default 0. */
  padding?: number;
}

export function isGridSpec(spec: LayoutSpec): spec is GridSpec {
  return (spec as GridSpec).cols !== undefined && typeof (spec as GridSpec).cols === "number";
}

export function isCustomColumnsSpec(spec: LayoutSpec): spec is CustomColumnsSpec {
  return Array.isArray((spec as CustomColumnsSpec).cols);
}

/**
 * Parse a grid string like "2x2", "1x3", "3X4" into a GridSpec.
 * Format: "<cols>x<rows>".
 */
export function parseGrid(input: string): GridSpec {
  const m = /^(\d+)\s*[xX]\s*(\d+)$/.exec(input.trim());
  if (!m) throw new Error(`invalid grid spec "${input}" — expected "<cols>x<rows>" (e.g. 2x2)`);
  const cols = Number(m[1]);
  const rows = Number(m[2]);
  if (cols < 1 || rows < 1) throw new Error(`invalid grid spec "${input}" — cols and rows must be >= 1`);
  return { cols, rows };
}

/**
 * Grow a requested grid until it can hold `count` panes, keeping the requested
 * column count and adding rows.
 *
 * `place` refuses a grid with fewer cells than the repo has panes, so offering
 * the raw request in the Alfred palette produces an item whose only effect is a
 * non-zero exit — which Alfred renders as nothing at all.
 */
export function growGridToFit(grid: GridSpec, count: number): GridSpec {
  if (grid.cols * grid.rows >= count) return grid;
  return { cols: grid.cols, rows: Math.ceil(count / grid.cols) };
}

/**
 * Parse a custom column string like "1,3" → weights [1, 3].
 * Each entry is a relative weight; "1,3" means first column is 25% wide, second is 75%.
 */
export function parseCustomColumns(input: string): number[] {
  const parts = input.split(",").map((s) => s.trim());
  const weights = parts.map((p) => {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`invalid column weight "${p}" — must be a positive number`);
    }
    return n;
  });
  if (weights.length === 0) throw new Error("custom columns must have at least one entry");
  return weights;
}

/**
 * Tile a screen rect into a grid. Returns rects in row-major order
 * (top-left → top-right → next row).
 */
export function tileGrid(screen: Rect, grid: GridSpec, opts: LayoutOptions = {}): Rect[] {
  const gap = opts.gap ?? 0;
  const padding = opts.padding ?? 0;
  const { cols, rows } = grid;

  const inner: Rect = {
    x: screen.x + padding,
    y: screen.y + padding,
    width: screen.width - padding * 2,
    height: screen.height - padding * 2,
  };

  const totalGapX = gap * (cols - 1);
  const totalGapY = gap * (rows - 1);
  const cellW = (inner.width - totalGapX) / cols;
  const cellH = (inner.height - totalGapY) / rows;

  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: roundPx(inner.x + c * (cellW + gap)),
        y: roundPx(inner.y + r * (cellH + gap)),
        width: roundPx(cellW),
        height: roundPx(cellH),
      });
    }
  }
  return out;
}

/**
 * Tile a screen rect into columns of weighted widths, with a uniform number of rows.
 * Row-major order.
 */
export function tileCustomColumns(
  screen: Rect,
  spec: CustomColumnsSpec,
  opts: LayoutOptions = {},
): Rect[] {
  const gap = opts.gap ?? 0;
  const padding = opts.padding ?? 0;
  const rows = spec.rows ?? 1;

  const inner: Rect = {
    x: screen.x + padding,
    y: screen.y + padding,
    width: screen.width - padding * 2,
    height: screen.height - padding * 2,
  };

  const weightSum = spec.cols.reduce((a, b) => a + b, 0);
  const totalGapX = gap * (spec.cols.length - 1);
  const totalGapY = gap * (rows - 1);
  const availW = inner.width - totalGapX;
  const cellH = (inner.height - totalGapY) / rows;

  const colWidths = spec.cols.map((w) => (availW * w) / weightSum);
  const colXs: number[] = [];
  {
    let x = inner.x;
    for (let c = 0; c < spec.cols.length; c++) {
      colXs.push(x);
      x += (colWidths[c] ?? 0) + gap;
    }
  }

  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < spec.cols.length; c++) {
      out.push({
        x: roundPx(colXs[c] ?? 0),
        y: roundPx(inner.y + r * (cellH + gap)),
        width: roundPx(colWidths[c] ?? 0),
        height: roundPx(cellH),
      });
    }
  }
  return out;
}

export function tile(screen: Rect, spec: LayoutSpec, opts?: LayoutOptions): Rect[] {
  if (isGridSpec(spec)) return tileGrid(screen, spec, opts);
  if (isCustomColumnsSpec(spec)) return tileCustomColumns(screen, spec, opts);
  throw new Error("unknown layout spec");
}

/** A screen rect in Cocoa coordinates (bottom-left origin, y-up). */
export interface CocoaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert NSScreen visibleFrames (Cocoa: bottom-left origin, y increases up,
 * one global space anchored at the primary display) into AX / System-Events
 * rects (top-left origin, y increases down).
 *
 * The flip is anchored to the *primary* display's full frame height — the
 * screen whose Cocoa origin is (0,0), which is the one that carries the menu
 * bar. Every screen flips against that same height, which is what gives
 * secondary displays their correct (often negative) AX y. Input order is
 * preserved so callers can index by NSScreen.screens position.
 */
export function cocoaFramesToAx(visibleFrames: CocoaRect[], primaryFrameHeight: number): Rect[] {
  return visibleFrames.map((v) => ({
    x: roundPx(v.x),
    y: roundPx(primaryFrameHeight - (v.y + v.height)),
    width: roundPx(v.width),
    height: roundPx(v.height),
  }));
}

function roundPx(n: number): number {
  return Math.round(n);
}
