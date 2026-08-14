import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SeanceState } from "./types.js";
import { BUILTIN_THEME_PAIRS } from "./themes.js";

const STATE_DIR = process.env.SEANCE_HOME ?? join(homedir(), ".config", "seance");
const STATE_FILE = join(STATE_DIR, "state.json");
const SAVES_DIR = join(STATE_DIR, "saves");
const CLAUDE_SETTINGS = join(
  process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
  "settings.json",
);

export function statePath(): string {
  return STATE_FILE;
}

export function savesDir(): string {
  return SAVES_DIR;
}

export function emptyState(): SeanceState {
  return {
    version: 1,
    groups: {},
    projects: {},
    themes: { ...BUILTIN_THEME_PAIRS },
  };
}

export async function loadState(): Promise<SeanceState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as SeanceState;
    if (parsed.version !== 1) {
      throw new Error(`unsupported state version ${parsed.version}`);
    }
    const parsedThemes = parsed.themes ?? {};
    return {
      ...emptyState(),
      ...parsed,
      groups: parsed.groups ?? {},
      projects: parsed.projects ?? {},
      themes: Object.keys(parsedThemes).length === 0 ? { ...BUILTIN_THEME_PAIRS } : parsedThemes,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw err;
  }
}

/**
 * Fill in the seance 2.0 policy fields on first use. Identity is seeded from
 * legacy repo-named groups (their themeName/background were per-repo choices,
 * keyed by repo when the group was named after one). Catppuccin never enters
 * the assignable ring (enforced by the caller building the ring) — it's a
 * common global Ghostty default, i.e. the "unpainted" look.
 */
export function ensurePolicy(state: SeanceState): void {
  if (!state.identity) {
    const identity: NonNullable<SeanceState["identity"]> = {};
    for (const [name, g] of Object.entries(state.groups)) {
      if (!g.themeName || g.themeName === "Catppuccin") continue;
      identity[name] = {
        pair: g.themeName,
        ...(g.background != null ? { bg: g.background } : {}),
      };
    }
    state.identity = identity;
  }
  state.placement ??= [{ repo: "*", role: "main" }];
  state.layout ??= { minPaneWidth: 384, minPaneHeight: 256 };
  state.layout.minPaneHeight ??= 256;
}

export async function saveState(state: SeanceState): Promise<void> {
  await fs.mkdir(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, STATE_FILE);
}

/**
 * Point Claude Code's own theme at the appearance seance is painting.
 *
 * Claude Code renders anything non-plain — dim status lines, file paths, error
 * banners — from a fixed palette of its own, chosen by this setting rather than
 * by the terminal. Only its default text follows the terminal's foreground. So
 * a light terminal under a dark Claude Code theme leaves every accent colour
 * near-invisible no matter what seance writes to the TTY, which is the failure
 * that made `appearance light` unusable.
 *
 * Any `-ansi` / `-daltonized` variant the user picked is preserved; only the
 * polarity moves. Returns the value written, or null if nothing changed.
 */
export async function syncClaudeCodeTheme(appearance: "dark" | "light"): Promise<string | null> {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await fs.readFile(CLAUDE_SETTINGS, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const current = typeof settings.theme === "string" ? settings.theme : "";
  const suffix = /-(ansi|daltonized)$/.exec(current)?.[0] ?? "";
  const next = `${appearance}${suffix}`;
  if (current === next) return null;
  settings.theme = next;
  const tmp = `${CLAUDE_SETTINGS}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fs.rename(tmp, CLAUDE_SETTINGS);
  return next;
}

export async function withState<T>(fn: (state: SeanceState) => T | Promise<T>): Promise<T> {
  const state = await loadState();
  const result = await fn(state);
  await saveState(state);
  return result;
}
