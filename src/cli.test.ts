import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLI_SRC = resolve(HERE, "cli.ts");
const ENTRY = resolve(HERE, "..", "node_modules", ".bin", "tsx");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function withSeanceDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "seance-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runSeance(
  args: string[],
  dir: string,
  opts: { input?: string } = {},
): Promise<RunResult> {
  const result = await execa(ENTRY, [CLI_SRC, ...args], {
    env: { ...process.env, SEANCE_HOME: dir },
    reject: false,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.exitCode ?? 0,
  };
}

async function readState(dir: string): Promise<unknown> {
  const raw = await fs.readFile(join(dir, "state.json"), "utf8");
  return JSON.parse(raw);
}

describe("seance CLI (black-box, SEANCE_HOME isolated)", () => {
  it("where prints the state path inside SEANCE_HOME", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["where"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe(join(dir, "state.json"));
    });
  });

  it("group list on empty state shows (no groups)", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["group", "list"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("(no groups)");
    });
  });

  it("group new creates an empty group on disk", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["group", "new", "demo"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('created group "demo"');
      const state = (await readState(dir)) as {
        groups: Record<string, { windows: unknown[] }>;
      };
      expect(state.groups.demo).toBeDefined();
      expect(state.groups.demo!.windows).toEqual([]);
    });
  });

  it("group new is idempotent-rejecting (second create fails)", async () => {
    await withSeanceDir(async (dir) => {
      await runSeance(["group", "new", "demo"], dir);
      const r = await runSeance(["group", "new", "demo"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("already exists");
    });
  });

  it("group rm deletes a group", async () => {
    await withSeanceDir(async (dir) => {
      await runSeance(["group", "new", "demo"], dir);
      const r = await runSeance(["group", "rm", "demo"], dir);
      expect(r.exitCode).toBe(0);
      const state = (await readState(dir)) as { groups: Record<string, unknown> };
      expect(state.groups.demo).toBeUndefined();
    });
  });

  it("group show errors for unknown group", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["group", "show", "ghost"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.toLowerCase()).toContain('no group "ghost"');
    });
  });

  it("save errors when no windows have slot+tty+cwd", async () => {
    await withSeanceDir(async (dir) => {
      await runSeance(["group", "new", "empty"], dir);
      const r = await runSeance(["save", "empty"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("slot+tty+cwd");
    });
  });

  it("restore errors with explicit search paths when missing", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["restore", "missing"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("no saved script");
      expect(r.stderr).toContain(join(dir, "saves", "missing.applescript"));
    });
  });

  it("does not touch state.json until something is persisted", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["group", "list"], dir);
      expect(r.exitCode).toBe(0);
      await expect(fs.access(join(dir, "state.json"))).rejects.toThrow();
    });
  });

  it("theme list-pairs shows the 7 builtin pairs on a fresh state", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["theme", "list-pairs"], dir);
      expect(r.exitCode).toBe(0);
      for (const name of [
        "Catppuccin",
        "Rose Pine",
        "Gruvbox Material",
        "Ayu",
        "Selenized",
        "Modus",
        "Night Owl",
      ]) {
        expect(r.stdout).toContain(name);
      }
    });
  });

  it("theme apply errors gracefully when the group has no themeName", async () => {
    await withSeanceDir(async (dir) => {
      await runSeance(["group", "new", "demo"], dir);
      const r = await runSeance(["theme", "apply", "demo"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("no theme set");
    });
  });

  it("theme register persists a new pair", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(
        ["theme", "register", "cobalt", "--dark", "Cobalt2", "--light", "Cobalt Neon"],
        dir,
      );
      expect(r.exitCode).toBe(0);
      const list = await runSeance(["theme", "list-pairs"], dir);
      expect(list.stdout).toContain("cobalt");
      expect(list.stdout).toContain("Cobalt2");
      expect(list.stdout).toContain("Cobalt Neon");
    });
  });
});
