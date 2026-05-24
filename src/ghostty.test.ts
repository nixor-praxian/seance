import { describe, it, expect } from "vitest";
import { looksLikeShellDefaultTitle } from "./ghostty.js";

describe("looksLikeShellDefaultTitle", () => {
  it("treats empty and whitespace as default", () => {
    expect(looksLikeShellDefaultTitle("")).toBe(true);
    expect(looksLikeShellDefaultTitle(undefined)).toBe(true);
    expect(looksLikeShellDefaultTitle("   ")).toBe(true);
  });

  it("matches bare paths", () => {
    expect(looksLikeShellDefaultTitle("/Users/node/GitHub/seance")).toBe(true);
    expect(looksLikeShellDefaultTitle("~/GitHub/seance")).toBe(true);
  });

  it("matches user@host:path", () => {
    expect(looksLikeShellDefaultTitle("node@laptop:~/code")).toBe(true);
  });

  it("matches cwd, ~-collapsed cwd, and basename", () => {
    const cwd = "/Users/node/GitHub/seance";
    const home = process.env.HOME ?? "";
    expect(looksLikeShellDefaultTitle(cwd, cwd)).toBe(true);
    expect(looksLikeShellDefaultTitle("seance", cwd)).toBe(true);
    if (home && cwd.startsWith(home)) {
      expect(looksLikeShellDefaultTitle(cwd.replace(home, "~"), cwd)).toBe(true);
    }
  });

  it("preserves meaningful titles", () => {
    expect(looksLikeShellDefaultTitle("Claude Code — debugging save")).toBe(false);
    expect(looksLikeShellDefaultTitle("✳ Integrate iris with zeus")).toBe(false);
    expect(looksLikeShellDefaultTitle("metis dev server")).toBe(false);
  });
});
