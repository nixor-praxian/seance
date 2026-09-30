import { describe, it, expect } from "vitest";
import {
  repoOf,
  reflowDecision,
  liveShades,
  selectPaneProcesses,
  worktreeMainRoot,
  computeRoles,
  resolveRole,
  placePanes,
  autoGrid,
  assignThemes,
} from "./policy.js";
import type { LivePane, PolicyScreen, Role, IdentityEntry } from "./policy.js";

const home = "/Users/dev";

function screen(key: string, x: number, isMain = false): PolicyScreen {
  return { key, rect: { x, y: 0, width: 1920, height: 1080 }, isMain };
}

function pane(ttyPath: string, cwd: string): LivePane {
  return { ttyPath, cwd };
}

describe("repoOf", () => {
  it("returns the basename, stripping trailing slashes", () => {
    expect(repoOf("/Users/dev/GitHub/seance", home)).toBe("seance");
    expect(repoOf("/Users/dev/GitHub/seance/", home)).toBe("seance");
    expect(repoOf("/Users/dev/GitHub/seance///", home)).toBe("seance");
  });

  it("maps home to \"home\" and empty or \"/\" to \"root\"", () => {
    expect(repoOf("/Users/dev", home)).toBe("home");
    expect(repoOf("/Users/dev/", home)).toBe("home");
    expect(repoOf("", home)).toBe("root");
    expect(repoOf("/", home)).toBe("root");
  });
});

describe("computeRoles", () => {
  it("assigns main to the isMain screen regardless of position", () => {
    const ext = screen("ext", -1920);
    const laptop = screen("laptop", 0, true);
    expect(computeRoles([ext, laptop]).get("main")).toBe(laptop);
  });

  it("falls back to the first screen when none is main", () => {
    const a = screen("a", 100);
    const b = screen("b", 0);
    expect(computeRoles([a, b]).get("main")).toBe(a);
  });

  it("sorts externals by x ascending and ignores externals beyond the second", () => {
    const laptop = screen("laptop", 0, true);
    const left = screen("left", -1920);
    const right = screen("right", 1728);
    const far = screen("far", 3648);
    const roles = computeRoles([laptop, right, far, left]);
    expect(roles.get("external.left")).toBe(left);
    expect(roles.get("external.right")).toBe(right);
    expect(roles.size).toBe(3);
  });

  it("gives a single external external.left", () => {
    const laptop = screen("laptop", 0, true);
    const ext = screen("ext", 1728);
    const roles = computeRoles([laptop, ext]);
    expect(roles.get("external.left")).toBe(ext);
    expect(roles.has("external.right")).toBe(false);
  });

  it("returns an empty map for no screens", () => {
    expect(computeRoles([]).size).toBe(0);
  });
});

describe("resolveRole", () => {
  const laptop = screen("laptop", 0, true);
  const left = screen("left", -1920);

  it("returns the exact match, and right falls back to left", () => {
    const roles = computeRoles([laptop, left]);
    expect(resolveRole("external.left", roles)).toBe(left);
    expect(resolveRole("external.right", roles)).toBe(left);
  });

  it("left falls back to right when only right exists", () => {
    const right = screen("right", 1728);
    const roles = new Map<Role, PolicyScreen>([
      ["main", laptop],
      ["external.right", right],
    ]);
    expect(resolveRole("external.left", roles)).toBe(right);
  });

  it("externals fall back to main when no externals exist", () => {
    const roles = computeRoles([laptop]);
    expect(resolveRole("external.left", roles)).toBe(laptop);
    expect(resolveRole("external.right", roles)).toBe(laptop);
  });

  it("main falls back to the first map value when missing", () => {
    const roles = new Map<Role, PolicyScreen>([["external.left", left]]);
    expect(resolveRole("main", roles)).toBe(left);
    expect(resolveRole("external.right", roles)).toBe(left);
  });
});

describe("placePanes", () => {
  const laptop = screen("laptop", 0, true);
  const left = screen("disp1", -1920);
  const right = screen("disp2", 1728);
  const roles = computeRoles([laptop, left, right]);

  it("routes repos to screens by exact rule", () => {
    const out = placePanes(
      [
        pane("/dev/ttys001", "/Users/dev/GitHub/mercury"),
        pane("/dev/ttys002", "/Users/dev/GitHub/zephyr"),
      ],
      [
        { repo: "mercury", role: "external.left" },
        { repo: "zephyr", role: "external.right" },
      ],
      roles,
      home,
    );
    expect(out.get("disp1")?.map((p) => p.ttyPath)).toEqual(["/dev/ttys001"]);
    expect(out.get("disp2")?.map((p) => p.ttyPath)).toEqual(["/dev/ttys002"]);
  });

  it("routes unmatched repos through the wildcard rule", () => {
    const out = placePanes(
      [pane("/dev/ttys001", "/Users/dev/GitHub/anything")],
      [
        { repo: "mercury", role: "external.left" },
        { repo: "*", role: "external.right" },
      ],
      roles,
      home,
    );
    expect(out.get("disp2")?.map((p) => p.ttyPath)).toEqual(["/dev/ttys001"]);
  });

  it("defaults to main when no rule matches", () => {
    const out = placePanes(
      [pane("/dev/ttys001", "/Users/dev/GitHub/other")],
      [{ repo: "mercury", role: "external.left" }],
      roles,
      home,
    );
    expect(out.get("laptop")?.map((p) => p.ttyPath)).toEqual(["/dev/ttys001"]);
  });

  it("degrades an unresolvable role via resolveRole", () => {
    const mainOnly = computeRoles([laptop]);
    const out = placePanes(
      [pane("/dev/ttys001", "/Users/dev/GitHub/mercury")],
      [{ repo: "mercury", role: "external.right" }],
      mainOnly,
      home,
    );
    expect(out.get("laptop")?.map((p) => p.ttyPath)).toEqual(["/dev/ttys001"]);
  });

  it("orders panes by rule index, then repo, then tty, keeping same-repo panes adjacent", () => {
    const out = placePanes(
      [
        pane("/dev/ttys009", "/Users/dev/GitHub/beta"),
        pane("/dev/ttys002", "/Users/dev/GitHub/zeta"),
        pane("/dev/ttys008", "/Users/dev/GitHub/alpha"),
        pane("/dev/ttys001", "/Users/dev/GitHub/zeta"),
        pane("/dev/ttys003", "/Users/dev/GitHub/alpha"),
      ],
      [
        { repo: "zeta", role: "main" },
        { repo: "*", role: "main" },
      ],
      roles,
      home,
    );
    expect(out.get("laptop")?.map((p) => p.ttyPath)).toEqual([
      "/dev/ttys001",
      "/dev/ttys002",
      "/dev/ttys003",
      "/dev/ttys008",
      "/dev/ttys009",
    ]);
  });
});

describe("autoGrid", () => {
  it("matches the anchor cases", () => {
    expect(autoGrid(5, 1920, 384)).toEqual({ cols: 5, rows: 1 });
    expect(autoGrid(6, 1728, 384)).toEqual({ cols: 4, rows: 2 });
    expect(autoGrid(4, 1728, 384)).toEqual({ cols: 4, rows: 1 });
    expect(autoGrid(1, 1920, 384)).toEqual({ cols: 1, rows: 1 });
  });

  it("handles n=0 and clamps to one column on narrow screens", () => {
    expect(autoGrid(0, 1920, 384)).toEqual({ cols: 1, rows: 1 });
    expect(autoGrid(3, 300, 384)).toEqual({ cols: 1, rows: 3 });
  });
});

describe("assignThemes", () => {
  const ring = ["catppuccin", "rose-pine", "gruvbox", "ayu"];
  const NOW = "2026-01-01T00:00:00.000Z";

  it("assigns new repos in alphabetical order from the ring, deduped", () => {
    const { identity, changes } = assignThemes(["b", "a", "a"], {}, ring, NOW);
    expect(changes).toEqual([
      { repo: "a", pair: "catppuccin", reason: "new" },
      { repo: "b", pair: "rose-pine", reason: "new" },
    ]);
    expect(identity).toEqual({
      a: { pair: "catppuccin", assignedAt: NOW },
      b: { pair: "rose-pine", assignedAt: NOW },
    });
  });

  it("keeps existing entries sticky when there is no live collision", () => {
    const input: Record<string, IdentityEntry> = {
      a: { pair: "gruvbox" },
      offline: { pair: "gruvbox" },
    };
    const { identity, changes } = assignThemes(["a"], input, ring);
    expect(changes).toEqual([]);
    expect(identity["a"]).toEqual({ pair: "gruvbox" });
    expect(identity["offline"]).toEqual({ pair: "gruvbox" });
  });

  it("never recolours an established repo when it collides with another live one", () => {
    // Rewriting the loser's pair on every collision made a repo's colour depend
    // on which other repos happened to be open. Identity is write-once; live duplicates are
    // separated by liveShades at paint time instead.
    const input: Record<string, IdentityEntry> = {
      a: { pair: "catppuccin", bg: "#111111" },
      b: { pair: "catppuccin", pinned: true },
      established: { pair: "rose-pine", assignedAt: "2026-01-01T00:00:00.000Z" },
      aardvark: { pair: "rose-pine", assignedAt: "2026-06-01T00:00:00.000Z" },
    };
    const { identity, changes } = assignThemes(["a", "b", "aardvark", "established"], input, ring, NOW);
    expect(changes).toEqual([]);
    expect(identity).toEqual(input);
  });

  it("prefers pairs unused by anyone over pairs worn by non-live repos", () => {
    const input: Record<string, IdentityEntry> = { offline: { pair: "catppuccin" } };
    const { identity } = assignThemes(["a"], input, ring, NOW);
    expect(identity["a"]).toEqual({ pair: "rose-pine", assignedAt: NOW });
  });

  it("falls back to pairs worn only by non-live repos when all pairs are in identity", () => {
    const input: Record<string, IdentityEntry> = { offline: { pair: "catppuccin" } };
    const { identity, changes } = assignThemes(["a"], input, ["catppuccin"], NOW);
    expect(identity["a"]).toEqual({ pair: "catppuccin", assignedAt: NOW });
    expect(changes).toEqual([{ repo: "a", pair: "catppuccin", reason: "new" }]);
  });

  it("round-robins in assignment order once the ring is exhausted", () => {
    const { identity, changes } = assignThemes(["a", "b", "c"], {}, ["p1", "p2"], NOW);
    expect(identity).toEqual({
      a: { pair: "p1", assignedAt: NOW },
      b: { pair: "p2", assignedAt: NOW },
      c: { pair: "p1", assignedAt: NOW },
    });
    expect(changes.map((c) => c.reason)).toEqual(["new", "new", "new"]);
  });

  it("settles instead of reassigning forever once the ring is exhausted", () => {
    // The old fallback handed a loser a pair someone else already wore, so it
    // was a loser again next pass, and every pass after, forever.
    const first = assignThemes(["a", "b", "c"], {}, ["p1", "p2"], NOW);
    const second = assignThemes(["a", "b", "c"], first.identity, ["p1", "p2"], "2026-02-02T00:00:00.000Z");
    expect(second.changes).toEqual([]);
    expect(second.identity).toEqual(first.identity);
  });

  it("gives throwaway worktrees no identity, and reclaims any they hold", () => {
    const input: Record<string, IdentityEntry> = {
      real: { pair: "catppuccin" },
      temp_git_1787562654917_matjmd: { pair: "rose-pine" },
    };
    const { identity, changes } = assignThemes(
      ["real", "temp_git_1787562654917_matjmd", "temp_git_9_abc"],
      input,
      ring,
      NOW,
    );
    expect(Object.keys(identity).sort()).toEqual(["real"]);
    expect(changes).toEqual([]);
  });

  it("leaves a real repo whose name merely resembles a worktree alone", () => {
    const { identity } = assignThemes(["temp_gitignore", "temp_git_x"], {}, ring, NOW);
    expect(Object.keys(identity).sort()).toEqual(["temp_git_x", "temp_gitignore"]);
  });

  it("gives a new repo a pair no live repo wears, preferring the least-worn", () => {
    const input: Record<string, IdentityEntry> = {
      live1: { pair: "catppuccin" },
      off1: { pair: "rose-pine" },
      off2: { pair: "rose-pine" },
      off3: { pair: "gruvbox" },
      off4: { pair: "ayu" },
      off5: { pair: "ayu" },
    };
    const { identity } = assignThemes(["live1", "new"], input, ring, NOW);
    expect(identity["new"]).toEqual({ pair: "gruvbox", assignedAt: NOW });
  });

  it("passes non-live entries through untouched", () => {
    const input: Record<string, IdentityEntry> = {
      offline: { pair: "ayu", bg: { dark: "#000000", light: "#ffffff" }, pinned: true },
    };
    const { identity, changes } = assignThemes([], input, ring);
    expect(changes).toEqual([]);
    expect(identity["offline"]).toEqual(input["offline"]);
  });

  it("does not mutate its inputs and returns a new identity object", () => {
    const liveRepos = ["b", "a"];
    const input: Record<string, IdentityEntry> = {
      a: { pair: "catppuccin" },
      b: { pair: "catppuccin" },
    };
    const liveSnapshot = structuredClone(liveRepos);
    const inputSnapshot = structuredClone(input);
    const ringSnapshot = structuredClone(ring);
    const out = assignThemes(liveRepos, input, ring);
    expect(liveRepos).toEqual(liveSnapshot);
    expect(input).toEqual(inputSnapshot);
    expect(ring).toEqual(ringSnapshot);
    expect(out.identity).not.toBe(input);
  });

  it("is deterministic: same input twice yields deep-equal output", () => {
    const input: Record<string, IdentityEntry> = {
      a: { pair: "catppuccin" },
      b: { pair: "catppuccin", pinned: true },
      offline: { pair: "rose-pine" },
    };
    const live = ["c", "a", "b", "d"];
    expect(assignThemes(live, input, ring, NOW)).toEqual(assignThemes(live, input, ring, NOW));
  });
});

describe("liveShades", () => {
  it("gives every live repo shade 0 while their pairs are distinct", () => {
    const identity: Record<string, IdentityEntry> = { a: { pair: "p1" }, b: { pair: "p2" } };
    expect(liveShades(["a", "b"], identity)).toEqual(new Map([["a", 0], ["b", 0]]));
  });

  it("separates live repos sharing a pair: pinned, then incumbent, then name keeps shade 0", () => {
    const identity: Record<string, IdentityEntry> = {
      young: { pair: "p1", assignedAt: "2026-06-01T00:00:00.000Z" },
      old: { pair: "p1", assignedAt: "2026-01-01T00:00:00.000Z" },
      pinned: { pair: "p1", pinned: true, assignedAt: "2026-09-01T00:00:00.000Z" },
      offline: { pair: "p1" },
    };
    expect(liveShades(["young", "old", "pinned"], identity)).toEqual(
      new Map([["pinned", 0], ["old", 1], ["young", 2]]),
    );
  });
});

describe("selectPaneProcesses", () => {
  const GHOSTTY = 100;
  const proc = (pid: number, ppid: number, tty: string, command: string) => ({ pid, ppid, tty, command });

  it("takes identity from the pane's shell, not its newest process", () => {
    // The newest process on a busy Claude pane is a transient child (a Bash
    // tool call, caffeinate, an MCP server). When it exited between ps and
    // lsof the pane had no cwd and read as "home", and was repainted each time.
    const panes = selectPaneProcesses(
      [
        proc(200, GHOSTTY, "ttys001", "/usr/bin/login -flp dev"),
        proc(201, 200, "ttys001", "-/bin/zsh"),
        proc(300, 201, "ttys001", "claude --resume abc"),
        proc(900, 300, "ttys001", "caffeinate -i -t 300"),
      ],
      GHOSTTY,
    );
    expect(panes).toEqual([{ tty: "ttys001", shellPid: 201, command: "claude --resume abc" }]);
  });

  it("reports the shell itself when nothing runs in the foreground", () => {
    const panes = selectPaneProcesses(
      [proc(200, GHOSTTY, "ttys002", "/usr/bin/login"), proc(201, 200, "ttys002", "-/bin/zsh")],
      GHOSTTY,
    );
    expect(panes).toEqual([{ tty: "ttys002", shellPid: 201, command: "-/bin/zsh" }]);
  });

  it("survives PID wraparound: the login process may carry the highest pid", () => {
    const panes = selectPaneProcesses(
      [proc(99990, GHOSTTY, "ttys003", "/usr/bin/login"), proc(12, 99990, "ttys003", "-/bin/zsh")],
      GHOSTTY,
    );
    expect(panes).toEqual([{ tty: "ttys003", shellPid: 12, command: "-/bin/zsh" }]);
  });

  it("ignores processes that belong to another app's terminals", () => {
    expect(selectPaneProcesses([proc(5, 4, "ttys009", "-/bin/zsh")], GHOSTTY)).toEqual([]);
  });
});

describe("worktreeMainRoot", () => {
  it("maps a linked worktree to the repo that owns it", () => {
    expect(worktreeMainRoot("gitdir: /Users/dev/GitHub/seance/.git/worktrees/wt3\n")).toBe(
      "/Users/dev/GitHub/seance",
    );
  });

  it("leaves submodules and anything else alone", () => {
    expect(worktreeMainRoot("gitdir: ../.git/modules/vendor")).toBeUndefined();
    expect(worktreeMainRoot("garbage")).toBeUndefined();
  });
});

describe("reflowDecision", () => {
  const five = "a:0|b:1|c:2|d:3|e:4";
  const two = "a:0|b:1";

  it("never reflows onto fewer displays than before", () => {
    // A dock replug brings screens back in stages (1, 3, 2, 3, 5). The
    // laptop-plus-one stage held long enough to settle, was unknown, and the
    // watcher packed 16 panes onto two screens; the full set then came back
    // as known and was left alone, so the packing stuck.
    expect(reflowDecision({ settled: two, previous: five, known: false, mode: "new" })).toBe("shrunk");
    expect(reflowDecision({ settled: two, previous: five, known: false, mode: "always" })).toBe("shrunk");
  });

  it("leaves a known arrangement to macOS in new mode, and reflows an unknown larger one", () => {
    expect(reflowDecision({ settled: five, previous: two, known: true, mode: "new" })).toBe("known");
    expect(reflowDecision({ settled: five, previous: two, known: false, mode: "new" })).toBe("reflow");
    expect(reflowDecision({ settled: five, previous: two, known: true, mode: "always" })).toBe("reflow");
  });

  it("does nothing when the displays settle back to the previous shape", () => {
    expect(reflowDecision({ settled: five, previous: five, known: false, mode: "always" })).toBe("unchanged");
  });
});
