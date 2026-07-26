import { describe, it, expect } from "vitest";
import {
  repoOf,
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

  it("assigns new repos in alphabetical order from the ring, deduped", () => {
    const { identity, changes } = assignThemes(["b", "a", "a"], {}, ring);
    expect(changes).toEqual([
      { repo: "a", pair: "catppuccin", reason: "new" },
      { repo: "b", pair: "rose-pine", reason: "new" },
    ]);
    expect(identity).toEqual({
      a: { pair: "catppuccin" },
      b: { pair: "rose-pine" },
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

  it("pinned wins a collision over an alphabetically-earlier unpinned repo", () => {
    const input: Record<string, IdentityEntry> = {
      a: { pair: "catppuccin", bg: "#111111" },
      b: { pair: "catppuccin", pinned: true },
    };
    const { identity, changes } = assignThemes(["a", "b"], input, ring);
    expect(identity["b"]).toEqual({ pair: "catppuccin", pinned: true });
    expect(identity["a"]).toEqual({ pair: "rose-pine", bg: "#111111" });
    expect(changes).toEqual([{ repo: "a", pair: "rose-pine", reason: "collision" }]);
  });

  it("alphabetically-first keeps when both colliders are unpinned", () => {
    const input: Record<string, IdentityEntry> = {
      a: { pair: "catppuccin" },
      b: { pair: "catppuccin" },
    };
    const { identity, changes } = assignThemes(["b", "a"], input, ring);
    expect(identity["a"]).toEqual({ pair: "catppuccin" });
    expect(changes).toEqual([{ repo: "b", pair: "rose-pine", reason: "collision" }]);
  });

  it("alphabetically-first keeps when both are pinned; the loser loses pinned", () => {
    const input: Record<string, IdentityEntry> = {
      a: { pair: "catppuccin", pinned: true },
      b: { pair: "catppuccin", pinned: true },
    };
    const { identity, changes } = assignThemes(["a", "b"], input, ring);
    expect(identity["a"]).toEqual({ pair: "catppuccin", pinned: true });
    expect(identity["b"]).toEqual({ pair: "rose-pine" });
    expect(changes).toEqual([{ repo: "b", pair: "rose-pine", reason: "collision" }]);
  });

  it("prefers pairs unused by anyone over pairs worn by non-live repos", () => {
    const input: Record<string, IdentityEntry> = { offline: { pair: "catppuccin" } };
    const { identity } = assignThemes(["a"], input, ring);
    expect(identity["a"]).toEqual({ pair: "rose-pine" });
  });

  it("falls back to pairs worn only by non-live repos when all pairs are in identity", () => {
    const input: Record<string, IdentityEntry> = { offline: { pair: "catppuccin" } };
    const { identity, changes } = assignThemes(["a"], input, ["catppuccin"]);
    expect(identity["a"]).toEqual({ pair: "catppuccin" });
    expect(changes).toEqual([{ repo: "a", pair: "catppuccin", reason: "new" }]);
  });

  it("round-robins in assignment order once the ring is exhausted", () => {
    const { identity, changes } = assignThemes(["a", "b", "c"], {}, ["p1", "p2"]);
    expect(identity).toEqual({
      a: { pair: "p1" },
      b: { pair: "p2" },
      c: { pair: "p1" },
    });
    expect(changes.map((c) => c.reason)).toEqual(["new", "new", "new"]);
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
    expect(assignThemes(live, input, ring)).toEqual(assignThemes(live, input, ring));
  });
});
