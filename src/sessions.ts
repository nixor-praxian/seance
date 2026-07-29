import { open, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
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

export interface RepoSessionInfo {
  uuid: string;
  mtimeMs: number;
  title?: string;
}

function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateTitle(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function userLineText(record: Record<string, unknown>): string {
  const message = record.message;
  if (typeof message !== "object" || message === null) return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      return candidate.text;
    }
  }
  return "";
}

function parseLine(line: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  return parsed as Record<string, unknown>;
}

function summaryText(record: Record<string, unknown>): string | undefined {
  if (record.type !== "summary" || typeof record.summary !== "string") return undefined;
  const title = normalizeTitle(record.summary);
  return title || undefined;
}

function lastSummaryInChunk(chunk: string): string | undefined {
  let found: string | undefined;
  for (const line of chunk.split("\n")) {
    const record = parseLine(line);
    if (!record) continue;
    const title = summaryText(record);
    if (title !== undefined) found = title;
  }
  return found;
}

export function parseSessionTitleFromChunks(head: string, tail: string): string | undefined {
  const tailSummary = lastSummaryInChunk(tail);
  if (tailSummary !== undefined) return truncateTitle(tailSummary);
  let nonPathUser: string | undefined;
  let pathUser: string | undefined;
  for (const line of head.split("\n")) {
    const record = parseLine(line);
    if (!record) continue;
    const summary = summaryText(record);
    if (summary !== undefined) return truncateTitle(summary);
    if (record.type !== "user") continue;
    const text = normalizeTitle(userLineText(record));
    if (!text || text.startsWith("<")) continue;
    if (text.startsWith("/") || text.startsWith("~/")) {
      if (pathUser === undefined) pathUser = text;
    } else if (nonPathUser === undefined) {
      nonPathUser = text;
    }
  }
  const title = nonPathUser ?? pathUser;
  return title === undefined ? undefined : truncateTitle(title);
}

export function parseSessionTitle(head: string): string | undefined {
  return parseSessionTitleFromChunks(head, "");
}

async function readChunk(handle: FileHandle, offset: number, length: number): Promise<string> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  return buffer.toString("utf8", 0, bytesRead);
}

async function readHeadTail(
  path: string,
  headBytes: number,
): Promise<{ head: string; tail: string }> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const head = await readChunk(handle, 0, headBytes);
    const tailOffset = Math.max(0, size - headBytes);
    if (tailOffset === 0) return { head, tail: head };
    const chunk = await readChunk(handle, tailOffset, headBytes);
    const firstNewline = chunk.indexOf("\n");
    return { head, tail: firstNewline === -1 ? "" : chunk.slice(firstNewline + 1) };
  } finally {
    await handle.close();
  }
}

export async function listRepoSessions(
  cwd: string,
  opts?: { skip?: number; limit?: number; projectsDir?: string; headBytes?: number },
): Promise<RepoSessionInfo[]> {
  const skip = opts?.skip ?? 0;
  const limit = opts?.limit ?? 4;
  const headBytes = opts?.headBytes ?? 32768;
  const base = opts?.projectsDir ?? `${homedir()}/.claude/projects`;
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
  const mtimeByUuid = new Map(files.map((f) => [f.uuid, f.mtimeMs]));
  const picked = pickSessionUuids(files, skip + limit).slice(skip);
  return Promise.all(
    picked.map(async (uuid) => {
      const { head, tail } = await readHeadTail(`${dir}/${uuid}.jsonl`, headBytes);
      const title = parseSessionTitleFromChunks(head, tail);
      return {
        uuid,
        mtimeMs: mtimeByUuid.get(uuid)!,
        ...(title !== undefined ? { title } : {}),
      };
    }),
  );
}
