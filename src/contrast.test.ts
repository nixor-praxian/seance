import { describe, it, expect } from "vitest";
import {
  DEFAULT_MIN_CONTRAST,
  contrastRatio,
  contrastRepairs,
  enforceContrast,
  readableAgainst,
  relativeLuminance,
} from "./contrast.js";
import type { ThemePalette } from "./themes.js";

function palette(over: Partial<ThemePalette> = {}): ThemePalette {
  return {
    background: "#ffffff",
    foreground: "#000000",
    cursor: "#000000",
    ansi: new Array(16).fill("#000000") as string[],
    ...over,
  };
}

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a color on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#3b82f6", "#3b82f6")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1e66f5", "#eff1f5")).toBeCloseTo(
      contrastRatio("#eff1f5", "#1e66f5"),
      10,
    );
  });

  it("agrees with published luminances", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2158, 3);
  });
});

describe("readableAgainst", () => {
  it("leaves a color that already passes untouched", () => {
    expect(readableAgainst("#000000", "#ffffff", 4.5)).toBe("#000000");
    expect(readableAgainst("#1e66f5", "#ffffff", 4.5)).toBe("#1e66f5");
  });

  it("repairs white on white to something readable", () => {
    const fixed = readableAgainst("#f9f9f9", "#fafafa", 4.5);
    expect(contrastRatio(fixed, "#fafafa")).toBeGreaterThanOrEqual(4.5);
  });

  it("repairs black on black to something readable", () => {
    const fixed = readableAgainst("#000000", "#011627", 4.5);
    expect(contrastRatio(fixed, "#011627")).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens against a light background and lightens against a dark one", () => {
    const onLight = readableAgainst("#eea02d", "#eff1f5", 4.5);
    const onDark = readableAgainst("#45475a", "#1e1e2e", 4.5);
    expect(relativeLuminance(onLight)).toBeLessThan(relativeLuminance("#eea02d"));
    expect(relativeLuminance(onDark)).toBeGreaterThan(relativeLuminance("#45475a"));
  });

  it("preserves hue rather than collapsing to grey", () => {
    const fixed = readableAgainst("#eea02d", "#eff1f5", 4.5);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fixed.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(g!);
    expect(g!).toBeGreaterThan(b!);
  });

  it("gives up chroma only when lightness alone cannot reach the ratio", () => {
    // Pure yellow tops out around 1.07:1 against white at full chroma.
    const fixed = readableAgainst("#ffff00", "#ffffff", 4.5);
    expect(contrastRatio(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("moves toward whichever pole a mid-grey background allows", () => {
    const fixed = readableAgainst("#767676", "#767676", 4.5);
    expect(contrastRatio(fixed, "#767676")).toBeGreaterThanOrEqual(4.5);
  });

  it("returns the best available when the ratio is unreachable", () => {
    // Nothing clears 21:1 against mid-grey; take the furthest pole, don't throw.
    const fixed = readableAgainst("#808080", "#808080", 21);
    expect(["#000000", "#ffffff"]).toContain(fixed);
  });

  it("passes through non-hex values untouched", () => {
    expect(readableAgainst("inherit", "#ffffff", 4.5)).toBe("inherit");
    expect(readableAgainst("#ffffff", "cell-background", 4.5)).toBe("#ffffff");
  });
});

describe("enforceContrast", () => {
  it("brings every slot up to the minimum ratio", () => {
    const p = palette({
      background: "#fafafa",
      foreground: "#f0f0f0",
      cursor: "#f5f5f5",
      ansi: new Array(16).fill("#f9f9f9") as string[],
    });
    const fixed = enforceContrast(p);
    for (const c of [...fixed.ansi, fixed.foreground, fixed.cursor]) {
      expect(contrastRatio(c, "#fafafa")).toBeGreaterThanOrEqual(DEFAULT_MIN_CONTRAST);
    }
  });

  it("measures against the override background, not the theme's own", () => {
    // #d1d1d1 passes against near-black but fails against the light override.
    const p = palette({ background: "#000000", ansi: new Array(16).fill("#d1d1d1") as string[] });
    const fixed = enforceContrast(p, { background: "#f8f9fa" });
    expect(fixed.background).toBe("#f8f9fa");
    for (const c of fixed.ansi) {
      expect(contrastRatio(c, "#f8f9fa")).toBeGreaterThanOrEqual(DEFAULT_MIN_CONTRAST);
    }
  });

  it("still adopts the override background when repair is disabled", () => {
    const p = palette({ background: "#000000", ansi: new Array(16).fill("#111111") as string[] });
    const fixed = enforceContrast(p, { background: "#f8f9fa", minRatio: 0 });
    expect(fixed.background).toBe("#f8f9fa");
    expect(fixed.ansi).toEqual(p.ansi);
  });

  it("keeps 16 ansi slots", () => {
    expect(enforceContrast(palette()).ansi).toHaveLength(16);
  });

  it("is idempotent", () => {
    const p = palette({
      background: "#eff1f5",
      foreground: "#4c4f69",
      ansi: new Array(16).fill("#bcc0cc") as string[],
    });
    const once = enforceContrast(p);
    expect(enforceContrast(once)).toEqual(once);
  });
});

describe("contrastRepairs", () => {
  it("reports only the slots that moved, with before/after ratios", () => {
    const p = palette({
      background: "#ffffff",
      foreground: "#000000",
      cursor: "#000000",
      ansi: new Array(16).fill("#000000").map((c, i) => (i === 7 ? "#a6a6a6" : c)) as string[],
    });
    const repairs = contrastRepairs(p);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]!.slot).toBe(7);
    expect(repairs[0]!.ratioBefore).toBeLessThan(DEFAULT_MIN_CONTRAST);
    expect(repairs[0]!.ratioAfter).toBeGreaterThanOrEqual(DEFAULT_MIN_CONTRAST);
  });

  it("is empty for a palette that already passes", () => {
    expect(contrastRepairs(palette())).toEqual([]);
  });
});
