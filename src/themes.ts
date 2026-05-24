import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { SeanceState, ThemePair } from "./types.js";

/**
 * The 7 curated Ghostty theme pairs frozen in docs/themes-preview.html.
 * Seeded into state.themes on first load if the user has no themes registered.
 */
export const BUILTIN_THEME_PAIRS: Record<string, ThemePair> = {
  Catppuccin: { dark: "Catppuccin Mocha", light: "Catppuccin Latte" },
  "Rose Pine": { dark: "Rose Pine", light: "Rose Pine Dawn" },
  "Gruvbox Material": { dark: "Gruvbox Material Dark", light: "Gruvbox Material Light" },
  Ayu: { dark: "Ayu Mirage", light: "Ayu Light" },
  Selenized: { dark: "Selenized Dark", light: "Selenized Light" },
  Modus: { dark: "Modus Vivendi", light: "Modus Operandi" },
  "Night Owl": { dark: "Night Owl", light: "Night Owlish Light" },
};

export interface ThemePalette {
  background: string;
  foreground: string;
  cursor: string;
  /** 16 ANSI colors, indexed 0..15. */
  ansi: string[];
}

const GHOSTTY_THEMES_DIR = "/Applications/Ghostty.app/Contents/Resources/ghostty/themes";

export function themeFilePath(themeName: string): string {
  return join(GHOSTTY_THEMES_DIR, themeName);
}

/**
 * Parse a Ghostty theme file's text content into a palette.
 *
 * Pure function — takes the file content as a string. Accepts `#rrggbb` and
 * `rgb:rr/gg/bb` notations; emits canonical `#rrggbb`. Throws if any of the
 * 16 palette indices is missing or background/foreground is absent.
 */
export function parseThemePalette(content: string): ThemePalette {
  const ansi: (string | undefined)[] = new Array(16);
  let background: string | undefined;
  let foreground: string | undefined;
  let cursor: string | undefined;

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (key === "background") background = normalizeColor(value);
    else if (key === "foreground") foreground = normalizeColor(value);
    else if (key === "cursor-color") cursor = normalizeColor(value);
    else if (key === "palette") {
      const palEq = value.indexOf("=");
      if (palEq < 0) continue;
      const idx = Number(value.slice(0, palEq).trim());
      if (!Number.isInteger(idx) || idx < 0 || idx > 15) continue;
      ansi[idx] = normalizeColor(value.slice(palEq + 1).trim());
    }
  }

  for (let i = 0; i < 16; i++) {
    if (!ansi[i]) throw new Error(`theme palette missing index ${i}`);
  }
  if (!background) throw new Error("theme missing `background`");
  if (!foreground) throw new Error("theme missing `foreground`");

  return {
    background,
    foreground,
    cursor: cursor ?? foreground,
    ansi: ansi as string[],
  };
}

export async function parseThemeFile(path: string): Promise<ThemePalette> {
  const content = await fs.readFile(path, "utf8");
  return parseThemePalette(content);
}

function normalizeColor(s: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  const rgbMatch = /^rgb:([0-9a-fA-F]{2})\/([0-9a-fA-F]{2})\/([0-9a-fA-F]{2})$/.exec(s);
  if (rgbMatch) return `#${rgbMatch[1]!.toLowerCase()}${rgbMatch[2]!.toLowerCase()}${rgbMatch[3]!.toLowerCase()}`;
  return s;
}

export function registerTheme(state: SeanceState, name: string, pair: ThemePair): void {
  state.themes[name] = pair;
}

export function getTheme(state: SeanceState, name: string): ThemePair | undefined {
  return state.themes[name];
}

export function listThemePairs(state: SeanceState): Array<{ name: string; pair: ThemePair }> {
  return Object.entries(state.themes)
    .map(([name, pair]) => ({ name, pair }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type Appearance = "light" | "dark";

/**
 * Pick the right concrete Ghostty theme name from a registered pair.
 * Falls back to the dark variant if the requested appearance is missing.
 */
export function resolveTheme(pair: ThemePair, appearance: Appearance): string {
  return pair[appearance] ?? pair.dark ?? pair.light;
}
