import type { SeanceState, ThemePair } from "./types.js";

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
