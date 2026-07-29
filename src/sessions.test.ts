import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeSessionUuids,
  isClaudeCommand,
  listRepoSessions,
  parseSessionTitle,
  parseSessionTitleFromChunks,
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

describe("parseSessionTitle", () => {
  it("prefers a summary line even when a user line comes first", () => {
    const head = [
      '{"type":"user","message":{"content":"first user message"}}',
      '{"type":"summary","summary":"Curated summary title"}',
    ].join("\n");
    expect(parseSessionTitle(head)).toBe("Curated summary title");
  });

  it("uses a user line with string content", () => {
    expect(
      parseSessionTitle('{"type":"user","message":{"content":"fix the probe race"}}'),
    ).toBe("fix the probe race");
  });

  it("uses the first text block when content is an array", () => {
    const head =
      '{"type":"user","message":{"content":[{"type":"tool_result","content":"x"},{"type":"text","text":"tile the meshuga display"}]}}';
    expect(parseSessionTitle(head)).toBe("tile the meshuga display");
  });

  it("collapses whitespace and truncates to 80 chars with an ellipsis", () => {
    expect(
      parseSessionTitle('{"type":"user","message":{"content":"  fix\\n\\nthe   layout  "}}'),
    ).toBe("fix the layout");
    const long = "a".repeat(100);
    expect(parseSessionTitle(`{"type":"user","message":{"content":"${long}"}}`)).toBe(
      `${"a".repeat(80)}…`,
    );
  });

  it("skips empty and angle-bracket noise user lines", () => {
    const head = [
      '{"type":"user","message":{"content":"<local-command-stdout>ok</local-command-stdout>"}}',
      '{"type":"user","message":{"content":""}}',
      '{"type":"user","message":{"content":"real request"}}',
    ].join("\n");
    expect(parseSessionTitle(head)).toBe("real request");
  });

  it("tolerates a head that ends mid-line", () => {
    const head = '{"type":"user","message":{"content":"before the cut"}}\n{"type":"summ';
    expect(parseSessionTitle(head)).toBe("before the cut");
    expect(parseSessionTitle('{"type":"user","mess')).toBeUndefined();
  });

  it("returns undefined for an empty head", () => {
    expect(parseSessionTitle("")).toBeUndefined();
  });

  it("ranks a path-like user message below a later real sentence", () => {
    const head = [
      '{"type":"user","message":{"content":"/Users/node/Downloads/2026-06-30-report.pdf"}}',
      '{"type":"user","message":{"content":"summarize that report"}}',
    ].join("\n");
    expect(parseSessionTitle(head)).toBe("summarize that report");
    expect(
      parseSessionTitle('{"type":"user","message":{"content":"~/Downloads/x.pdf"}}'),
    ).toBe("~/Downloads/x.pdf");
  });
});

describe("parseSessionTitleFromChunks", () => {
  it("prefers a tail summary over a head user message", () => {
    expect(
      parseSessionTitleFromChunks(
        '{"type":"user","message":{"content":"head user text"}}',
        '{"type":"summary","summary":"Appended tail summary"}',
      ),
    ).toBe("Appended tail summary");
  });

  it("takes the last of several tail summaries", () => {
    const tail = [
      '{"type":"summary","summary":"older summary"}',
      '{"type":"user","message":{"content":"noise"}}',
      '{"type":"summary","summary":"newest summary"}',
    ].join("\n");
    expect(parseSessionTitleFromChunks("", tail)).toBe("newest summary");
  });

  it("tolerates a tail chunk starting mid-line", () => {
    const tail = 'ummary","summary":"cut"}\n{"type":"summary","summary":"Tail summary"}';
    expect(
      parseSessionTitleFromChunks(
        '{"type":"user","message":{"content":"head fallback"}}',
        tail,
      ),
    ).toBe("Tail summary");
  });
});

describe("listRepoSessions", () => {
  const cwd = "/Users/node/GitHub/seance";
  let projectsDir: string;

  beforeAll(async () => {
    projectsDir = await fs.mkdtemp(join(tmpdir(), "seance-repo-sessions-"));
    const dir = join(projectsDir, projectDirNameForCwd(cwd));
    await fs.mkdir(dir);
    const base = Date.now();
    const sessions: Array<[string, number, string]> = [
      [
        "dddd-live",
        base,
        '{"type":"user","message":{"content":"Live pane currently running"}}\n',
      ],
      [
        "cccc-second",
        base - 10_000,
        '{"type":"summary","summary":"Fix the grid layout"}\n{"type":"user","message":{"content":"ignored"}}\n',
      ],
      [
        "bbbb-third",
        base - 20_000,
        '{"type":"user","message":{"content":[{"type":"text","text":"Investigate probe failures"}]}}\n',
      ],
      [
        "aaaa-fourth",
        base - 30_000,
        '{"type":"user","message":{"content":"Refactor the save flow"}}\n',
      ],
      [
        "eeee-tailsum",
        base - 40_000,
        `{"type":"user","message":{"content":"${"x".repeat(200)}"}}\n` +
          '{"type":"summary","summary":"Found in tail"}\n',
      ],
    ];
    for (const [uuid, mtime, head] of sessions) {
      const file = join(dir, `${uuid}.jsonl`);
      await fs.writeFile(file, head, "utf8");
      await fs.utimes(file, new Date(mtime), new Date(mtime));
    }
  });

  afterAll(async () => {
    await fs.rm(projectsDir, { recursive: true, force: true });
  });

  it("skips the live session and returns titled sessions newest-first", async () => {
    const rows = await listRepoSessions(cwd, { skip: 1, limit: 2, projectsDir });
    expect(rows.map((r) => r.uuid)).toEqual(["cccc-second", "bbbb-third"]);
    expect(rows.map((r) => r.title)).toEqual([
      "Fix the grid layout",
      "Investigate probe failures",
    ]);
    expect(rows[0]!.mtimeMs).toBeGreaterThan(rows[1]!.mtimeMs);
  });

  it("stays safe when headBytes cuts a line mid-JSON", async () => {
    const rows = await listRepoSessions(cwd, { limit: 4, projectsDir, headBytes: 64 });
    expect(rows.map((r) => r.uuid)).toEqual([
      "dddd-live",
      "cccc-second",
      "bbbb-third",
      "aaaa-fourth",
    ]);
    expect(rows[1]!.title).toBe("Fix the grid layout");
    expect(rows[2]!.title).toBeUndefined();
    expect(rows[3]!.title).toBe("Refactor the save flow");
  });

  it("finds a summary appended past headBytes via the tail read", async () => {
    const rows = await listRepoSessions(cwd, {
      skip: 4,
      limit: 1,
      projectsDir,
      headBytes: 64,
    });
    expect(rows.map((r) => r.uuid)).toEqual(["eeee-tailsum"]);
    expect(rows[0]!.title).toBe("Found in tail");
  });

  it("returns [] when the project dir does not exist", async () => {
    expect(await listRepoSessions("/no/such/cwd", { projectsDir })).toEqual([]);
  });
});
