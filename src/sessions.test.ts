import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeSessionUuids,
  isClaudeCommand,
  pickSessionUuids,
  projectDirNameForCwd,
} from "./sessions.js";

describe("projectDirNameForCwd", () => {
  it("replaces every slash with a dash", () => {
    expect(projectDirNameForCwd("/Users/node/GitHub/seance")).toBe("-Users-node-GitHub-seance");
  });

  it("replaces dots as well as slashes", () => {
    expect(projectDirNameForCwd("/a/b.c/d")).toBe("-a-b-c-d");
  });
});

describe("isClaudeCommand", () => {
  it("matches a claude invocation with args", () => {
    expect(isClaudeCommand("claude --resume x")).toBe(true);
  });

  it("matches a bare claude", () => {
    expect(isClaudeCommand("claude")).toBe(true);
  });

  it("matches a login-shell claude with leading dash", () => {
    expect(isClaudeCommand("-claude --resume x")).toBe(true);
  });

  it("matches an absolute-path claude", () => {
    expect(isClaudeCommand("/Users/x/.local/bin/claude --foo")).toBe(true);
  });

  it("rejects a login shell", () => {
    expect(isClaudeCommand("-/bin/zsh")).toBe(false);
  });

  it("rejects commands with claude only in an argument", () => {
    expect(isClaudeCommand("vim claude.md")).toBe(false);
  });

  it("rejects prefixed lookalikes", () => {
    expect(isClaudeCommand("claudette --x")).toBe(false);
  });
});

describe("pickSessionUuids", () => {
  const files = [
    { uuid: "aaa", mtimeMs: 100 },
    { uuid: "ccc", mtimeMs: 300 },
    { uuid: "bbb", mtimeMs: 200 },
  ];

  it("orders newest-first by mtime", () => {
    expect(pickSessionUuids(files, 3)).toEqual(["ccc", "bbb", "aaa"]);
  });

  it("clamps count to the number of files", () => {
    expect(pickSessionUuids(files, 10)).toEqual(["ccc", "bbb", "aaa"]);
    expect(pickSessionUuids(files, 1)).toEqual(["ccc"]);
  });

  it("breaks mtime ties by uuid", () => {
    const tied = [
      { uuid: "zzz", mtimeMs: 100 },
      { uuid: "aaa", mtimeMs: 100 },
      { uuid: "mmm", mtimeMs: 100 },
    ];
    expect(pickSessionUuids(tied, 3)).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("returns [] for empty input or non-positive count", () => {
    expect(pickSessionUuids([], 3)).toEqual([]);
    expect(pickSessionUuids(files, 0)).toEqual([]);
    expect(pickSessionUuids(files, -1)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const copy = files.map((f) => ({ ...f }));
    pickSessionUuids(files, 3);
    expect(files).toEqual(copy);
  });
});

describe("activeSessionUuids", () => {
  const cwd = "/Users/node/GitHub/seance";
  let projectsDir: string;

  beforeAll(async () => {
    projectsDir = await fs.mkdtemp(join(tmpdir(), "seance-sessions-"));
    const dir = join(projectsDir, projectDirNameForCwd(cwd));
    await fs.mkdir(dir);
    const base = Date.now();
    const sessions: Array<[string, number]> = [
      ["11111111-old", base - 30_000],
      ["22222222-mid", base - 20_000],
      ["33333333-new", base - 10_000],
    ];
    for (const [uuid, mtime] of sessions) {
      const file = join(dir, `${uuid}.jsonl`);
      await fs.writeFile(file, "{}\n", "utf8");
      await fs.utimes(file, new Date(mtime), new Date(mtime));
    }
    await fs.writeFile(join(dir, "notes.txt"), "ignore me\n", "utf8");
  });

  afterAll(async () => {
    await fs.rm(projectsDir, { recursive: true, force: true });
  });

  it("returns the newest count uuids, newest-first", async () => {
    expect(await activeSessionUuids(cwd, 2, projectsDir)).toEqual([
      "33333333-new",
      "22222222-mid",
    ]);
  });

  it("ignores non-jsonl files and clamps count", async () => {
    expect(await activeSessionUuids(cwd, 10, projectsDir)).toEqual([
      "33333333-new",
      "22222222-mid",
      "11111111-old",
    ]);
  });

  it("returns [] when the project dir does not exist", async () => {
    expect(await activeSessionUuids("/no/such/cwd", 2, projectsDir)).toEqual([]);
  });
});
