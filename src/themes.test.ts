import { describe, it, expect } from "vitest";
import { BUILTIN_THEME_PAIRS, parseThemePalette, resolveTheme } from "./themes.js";

describe("BUILTIN_THEME_PAIRS", () => {
  it("contains the 7 curated pairs with exact dark/light names", () => {
    expect(BUILTIN_THEME_PAIRS).toEqual({
      Catppuccin: { dark: "Catppuccin Mocha", light: "Catppuccin Latte" },
      "Rose Pine": { dark: "Rose Pine", light: "Rose Pine Dawn" },
      "Gruvbox Material": { dark: "Gruvbox Material Dark", light: "Gruvbox Material Light" },
      Ayu: { dark: "Ayu Mirage", light: "Ayu Light" },
      Selenized: { dark: "Selenized Dark", light: "Selenized Light" },
      Modus: { dark: "Modus Vivendi", light: "Modus Operandi" },
      "Night Owl": { dark: "Night Owl", light: "Night Owlish Light" },
    });
  });
});

describe("resolveTheme", () => {
  it("returns the requested appearance variant", () => {
    expect(resolveTheme({ dark: "D", light: "L" }, "dark")).toBe("D");
    expect(resolveTheme({ dark: "D", light: "L" }, "light")).toBe("L");
  });
});

describe("parseThemePalette", () => {
  const SAMPLE = `
palette = 0=#26233a
palette = 1=#eb6f92
palette = 2=#31748f
palette = 3=#f6c177
palette = 4=#9ccfd8
palette = 5=#c4a7e7
palette = 6=#ebbcba
palette = 7=#e0def4
palette = 8=#6e6a86
palette = 9=#eb6f92
palette = 10=#31748f
palette = 11=#f6c177
palette = 12=#9ccfd8
palette = 13=#c4a7e7
palette = 14=#ebbcba
palette = 15=#e0def4
background = #191724
foreground = #e0def4
cursor-color = #abc123
`;

  it("parses a full 16-color palette + bg/fg/cursor", () => {
    const p = parseThemePalette(SAMPLE);
    expect(p.background).toBe("#191724");
    expect(p.foreground).toBe("#e0def4");
    expect(p.cursor).toBe("#abc123");
    expect(p.ansi).toHaveLength(16);
    expect(p.ansi[0]).toBe("#26233a");
    expect(p.ansi[15]).toBe("#e0def4");
  });

  it("falls back cursor → foreground when cursor-color is absent", () => {
    const withoutCursor = SAMPLE.replace(/cursor-color = #abc123\n?/, "");
    const p = parseThemePalette(withoutCursor);
    expect(p.cursor).toBe(p.foreground);
  });

  it("normalizes rgb:rr/gg/bb to #rrggbb", () => {
    const withRgb = SAMPLE.replace("background = #191724", "background = rgb:AA/BB/CC");
    const p = parseThemePalette(withRgb);
    expect(p.background).toBe("#aabbcc");
  });

  it("throws on missing palette index", () => {
    const bad = SAMPLE.replace(/palette = 7=#e0def4\n?/, "");
    expect(() => parseThemePalette(bad)).toThrow(/missing index 7/);
  });

  it("throws on missing background", () => {
    const bad = SAMPLE.replace(/background = #191724\n?/, "");
    expect(() => parseThemePalette(bad)).toThrow(/background/);
  });
});
