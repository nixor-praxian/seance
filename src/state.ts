import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SeanceState } from "./types.js";

const STATE_DIR = process.env.SEANCE_HOME ?? join(homedir(), ".config", "seance");
const STATE_FILE = join(STATE_DIR, "state.json");
const SAVES_DIR = join(STATE_DIR, "saves");

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
    themes: {},
  };
}

export async function loadState(): Promise<SeanceState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as SeanceState;
    if (parsed.version !== 1) {
      throw new Error(`unsupported state version ${parsed.version}`);
    }
    return {
      ...emptyState(),
      ...parsed,
      groups: parsed.groups ?? {},
      projects: parsed.projects ?? {},
      themes: parsed.themes ?? {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw err;
  }
}

export async function saveState(state: SeanceState): Promise<void> {
  await fs.mkdir(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, STATE_FILE);
}

export async function withState<T>(fn: (state: SeanceState) => T | Promise<T>): Promise<T> {
  const state = await loadState();
  const result = await fn(state);
  await saveState(state);
  return result;
}
