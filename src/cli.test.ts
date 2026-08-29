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
    // CLAUDE_CONFIG_DIR is redirected into the sandbox so `appearance` can
    // never rewrite the developer's real ~/.claude/settings.json.
    env: { ...process.env, SEANCE_HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "claude") },
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

  it("cheatsheet prints the how-to-use markdown", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["cheatsheet"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("# seance");
      expect(r.stdout).toContain("## Alfred palette");
      expect(r.stdout).toContain("`seance organize`");
    });
  });

  it("organize --pin without a grid explains itself", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["organize", "--pin"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("need a grid");
    });
  });

  it("organize rejects a malformed grid", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["organize", "3by2"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("invalid grid spec");
    });
  });

  async function writeClaudeSettings(dir: string, settings: unknown): Promise<string> {
    const path = join(dir, "claude", "settings.json");
    await fs.mkdir(join(dir, "claude"), { recursive: true });
    await fs.writeFile(path, JSON.stringify(settings, null, 2), "utf8");
    return path;
  }

  async function readClaudeSettings(dir: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(join(dir, "claude", "settings.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it("appearance points Claude Code's own theme at the same polarity", async () => {
    await withSeanceDir(async (dir) => {
      await writeClaudeSettings(dir, { theme: "dark", env: { FOO: "bar" } });
      const r = await runSeance(["appearance", "light"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Claude Code theme = light");
      const settings = await readClaudeSettings(dir);
      expect(settings.theme).toBe("light");
      expect(settings.env).toEqual({ FOO: "bar" });
    });
  });

  it("appearance preserves an accessibility theme variant", async () => {
    await withSeanceDir(async (dir) => {
      await writeClaudeSettings(dir, { theme: "dark-daltonized" });
      await runSeance(["appearance", "light"], dir);
      expect((await readClaudeSettings(dir)).theme).toBe("light-daltonized");
    });
  });

  it("appearance stays quiet when Claude Code has no settings file", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["appearance", "dark"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("appearance = dark");
      expect(r.stdout).not.toContain("Claude Code theme");
    });
  });

  it("contrast persists a minimum ratio and accepts off", async () => {
    await withSeanceDir(async (dir) => {
      const set = await runSeance(["contrast", "7"], dir);
      expect(set.exitCode).toBe(0);
      expect(set.stdout).toContain("min contrast = 7:1");
      expect((await readState(dir) as { minContrast?: number }).minContrast).toBe(7);

      const off = await runSeance(["contrast", "off"], dir);
      expect(off.stdout).toContain("off (themes painted verbatim)");
      expect((await readState(dir) as { minContrast?: number }).minContrast).toBe(0);
    });
  });

  type ReflowState = { reflowMode?: string; watchReflow?: boolean };

  it("reflow defaults to new and persists every mode", async () => {
    await withSeanceDir(async (dir) => {
      const initial = await runSeance(["reflow"], dir);
      expect(initial.exitCode).toBe(0);
      expect(initial.stdout).toContain("reflow on display change = new");

      const off = await runSeance(["reflow", "off"], dir);
      expect(off.stdout).toContain("reflow on display change = off");
      expect(off.stdout).toContain("still paints panes");
      expect((await readState(dir) as ReflowState).reflowMode).toBe("off");

      const always = await runSeance(["reflow", "ALWAYS"], dir);
      expect(always.stdout).toContain("reflow on display change = always");
      expect((await readState(dir) as ReflowState).reflowMode).toBe("always");

      const back = await runSeance(["reflow", "new"], dir);
      expect(back.stdout).toContain("reflow on display change = new");
      expect((await readState(dir) as ReflowState).reflowMode).toBe("new");
    });
  });

  it("reflow accepts the retired \"on\" spelling as new", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["reflow", "on"], dir);
      expect(r.stdout).toContain("reflow on display change = new");
      expect((await readState(dir) as ReflowState).reflowMode).toBe("new");
    });
  });

  it("migrates the retired watchReflow:false to reflow off", async () => {
    await withSeanceDir(async (dir) => {
      await writeState(dir, { watchReflow: false });

      // Read-only: the migration applies on load, so the setting reports
      // correctly while state.json still holds the legacy key.
      const read = await runSeance(["reflow"], dir);
      expect(read.stdout).toContain("reflow on display change = off");

      // Any write flushes it: reflowMode replaces watchReflow on disk.
      await runSeance(["contrast", "7"], dir);
      const after = (await readState(dir)) as ReflowState;
      expect(after.reflowMode).toBe("off");
      expect(after.watchReflow).toBeUndefined();
    });
  });

  it("reflow rejects an unknown mode", async () => {
    await withSeanceDir(async (dir) => {
      const bad = await runSeance(["reflow", "sometimes"], dir);
      expect(bad.exitCode).not.toBe(0);
      expect(bad.stderr).toContain('reflow takes "always", "new" or "off"');
    });
  });

  it("contrast rejects a nonsense ratio", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["contrast", "banana"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("between 0 and 21");
    });
  });

  // These exercise only the paths that resolve before `arrange` perceives
  // anything, so no AppleScript or TTY is touched.
  async function writeState(dir: string, state: Record<string, unknown>): Promise<void> {
    await fs.writeFile(
      join(dir, "state.json"),
      JSON.stringify({ version: 1, groups: {}, projects: {}, themes: {}, ...state }, null, 2),
      "utf8",
    );
  }

  const SEEDED = {
    arrangements: { focus: [{ repo: "zephyr", role: "main" }] },
  };

  it("arrange rejects an unknown arrangement and lists what is saved", async () => {
    await withSeanceDir(async (dir) => {
      const empty = await runSeance(["arrange", "nope"], dir);
      expect(empty.exitCode).not.toBe(0);
      expect(empty.stderr).toContain('no arrangement "nope"');
      expect(empty.stderr).toContain("Saved: none");

      await writeState(dir, SEEDED);
      const seeded = await runSeance(["arrange", "nope"], dir);
      expect(seeded.stderr).toContain("Saved: focus");
    });
  });

  it("arrange rejects a name alongside --save", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["arrange", "foo", "--save", "bar"], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("seance arrange --save <name>");
    });
  });

  it("json query offers Arrange and every saved arrangement", async () => {
    await withSeanceDir(async (dir) => {
      await writeState(dir, SEEDED);
      const r = await runSeance(["json", "query", "arrange"], dir);
      expect(r.exitCode).toBe(0);
      const args = (JSON.parse(r.stdout) as { items: Array<{ arg: string }> }).items.map(
        (i) => i.arg,
      );
      expect(args).toContain("arrange");
      expect(args).toContain("arrange focus");
    });
  });

  it("json query scopes a leading verb instead of matching it literally", async () => {
    await withSeanceDir(async (dir) => {
      await writeState(dir, SEEDED);
      // "organize dark" previously matched no item title and read "organize"
      // as the repo token, so Alfred was handed an empty list.
      const r = await runSeance(["json", "query", "organize dark"], dir);
      expect(r.exitCode).toBe(0);
      const items = (JSON.parse(r.stdout) as { items: Array<{ title: string }> }).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.map((i) => i.title)).toContain("Appearance dark");
    });
  });

  it("json query keeps a saved arrangement reachable through its verb", async () => {
    await withSeanceDir(async (dir) => {
      await writeState(dir, SEEDED);
      const r = await runSeance(["json", "query", "arrange focus"], dir);
      const args = (JSON.parse(r.stdout) as { items: Array<{ arg: string }> }).items.map(
        (i) => i.arg,
      );
      expect(args).toContain("arrange focus");
    });
  });

  it("json query turns \"arrange save X\" into the --save invocation", async () => {
    await withSeanceDir(async (dir) => {
      const r = await runSeance(["json", "query", "arrange save weekend"], dir);
      const items = (JSON.parse(r.stdout) as { items: Array<{ arg: string }> }).items;
      expect(items[0]!.arg).toBe("arrange --save weekend");
    });
  });
});
