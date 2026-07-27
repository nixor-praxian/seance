import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";

export interface SessionPane {
  repo: string;
  cwd: string;
  /** Claude session uuid to resume. Absent = plain shell pane. */
  resume?: string;
}

export interface SessionSnapshot {
  name: string;
  savedAt: string;
  panes: SessionPane[];
}

export function projectDirNameForCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

export function isClaudeCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0];
  if (!first) return false;
  const token = first.startsWith("-") ? first.slice(1) : first;
  return token === "claude" || token.endsWith("/claude");
}

export function pickSessionUuids(
  files: Array<{ uuid: string; mtimeMs: number }>,
  count: number,
): string[] {
  if (count <= 0) return [];
  return [...files]
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.uuid.localeCompare(b.uuid))
    .slice(0, count)
    .map((f) => f.uuid);
}

export async function activeSessionUuids(
  cwd: string,
  count: number,
  projectsDir?: string,
): Promise<string[]> {
  const base = projectsDir ?? `${homedir()}/.claude/projects`;
  const dir = `${base}/${projectDirNameForCwd(cwd)}`;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files = await Promise.all(
    entries
      .filter((name) => name.endsWith(".jsonl"))
      .map(async (name) => {
        const info = await stat(`${dir}/${name}`);
        return { uuid: name.slice(0, -".jsonl".length), mtimeMs: info.mtimeMs };
      }),
  );
  return pickSessionUuids(files, count);
}
