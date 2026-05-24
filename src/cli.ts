import { Command } from "commander";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { loadState, saveState, savesDir, statePath } from "./state.js";
import { buildSaveScript } from "./save.js";
import {
  addWindow,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  nextFreeSlot,
  setGroupLayout,
  setGroupTheme,
} from "./groups.js";
import { parseCustomColumns, parseGrid, tile } from "./layouts.js";
import * as ghostty from "./ghostty.js";
import type { LayoutSpec, Rect, WindowRef } from "./types.js";

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("seance")
    .description("Summon and arrange Ghostty terminal panes into named groups.")
    .version("0.0.1");

  // ── group ─────────────────────────────────────────────────────────
  const group = program.command("group").description("Manage named groups of Ghostty windows.");

  group
    .command("new <name>")
    .description("Create an empty group.")
    .action(async (name: string) => {
      const state = await loadState();
      createGroup(state, name);
      await saveState(state);
      console.log(`created group "${name}"`);
    });

  group
    .command("add <name>")
    .description("Add the focused Ghostty window to <name>.")
    .option("--slot <n>", "1-indexed grid slot (row-major). defaults to next free.", (v) => Number(v))
    .action(async (name: string, opts: { slot?: number }) => {
      const state = await loadState();
      const win = await ghostty.focusedWindow();
      if (!win) {
        console.error("no focused Ghostty window — focus one and try again");
        process.exitCode = 1;
        return;
      }
      const ttyPath = await ghostty.currentTty();
      if (!ttyPath) {
        console.error("seance: cannot determine controlling tty — run from an interactive shell");
        process.exitCode = 1;
        return;
      }
      if (opts.slot !== undefined && (!Number.isInteger(opts.slot) || opts.slot < 1)) {
        console.error(`invalid --slot "${opts.slot}" — must be a positive integer`);
        process.exitCode = 1;
        return;
      }
      if (!state.groups[name]) createGroup(state, name);
      const slot = opts.slot ?? nextFreeSlot(state.groups[name]!);
      const cwd = process.cwd();
      const keepTitle = !ghostty.looksLikeShellDefaultTitle(win.title, cwd);
      const { title: _drop, ...winNoTitle } = win;
      const entry: WindowRef = {
        ...winNoTitle,
        ...(keepTitle && win.title ? { title: win.title } : {}),
        ttyPath,
        slot,
        cwd,
      };
      addWindow(state, name, entry);
      await saveState(state);
      console.log(`added window ${win.windowId} to "${name}" at slot ${slot} (tty ${ttyPath}, cwd ${cwd})`);
    });

  group
    .command("list")
    .description("List all groups.")
    .action(async () => {
      const state = await loadState();
      const groups = listGroups(state);
      if (groups.length === 0) {
        console.log("(no groups)");
        return;
      }
      for (const g of groups) {
        const layout = g.lastLayout ? formatLayout(g.lastLayout) : "-";
        const theme = g.themeName ?? "-";
        console.log(`${g.name}\t${g.windows.length} window(s)\tlayout=${layout}\ttheme=${theme}`);
      }
    });

  group
    .command("show <name>")
    .description("Show windows in a group.")
    .action(async (name: string) => {
      const state = await loadState();
      const g = getGroup(state, name);
      console.log(`group: ${g.name}`);
      console.log(`theme: ${g.themeName ?? "-"}`);
      console.log(`last layout: ${g.lastLayout ? formatLayout(g.lastLayout) : "-"}`);
      console.log(`windows (${g.windows.length}):`);
      const sorted = [...g.windows].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
      for (const w of sorted) {
        const slot = w.slot !== undefined ? `slot ${w.slot}` : "(no slot)";
        const tty = w.ttyPath ?? "(no tty)";
        console.log(`  ${slot}\t${w.windowId}\t${tty}\t${w.title ?? ""}`);
      }
    });

  group
    .command("rm <name>")
    .description("Delete a group.")
    .action(async (name: string) => {
      const state = await loadState();
      deleteGroup(state, name);
      await saveState(state);
      console.log(`deleted group "${name}"`);
    });

  // ── grid ─────────────────────────────────────────────────────────
  program
    .command("grid <name> [spec]")
    .description('Arrange a group on screen. spec: "2x2", or use --cols for custom widths.')
    .option("--cols <weights>", "comma-separated column weights (e.g. 1,3)")
    .option("--rows <n>", "rows when using --cols", (v) => Number(v))
    .option("--gap <px>", "gap between tiles in px", (v) => Number(v), 0)
    .option("--padding <px>", "outer padding in px", (v) => Number(v), 0)
    .action(
      async (
        name: string,
        spec: string | undefined,
        opts: { cols?: string; rows?: number; gap: number; padding: number },
      ) => {
        const state = await loadState();
        const g = getGroup(state, name);

        let layout: LayoutSpec;
        if (opts.cols) {
          layout = {
            cols: parseCustomColumns(opts.cols),
            ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
          };
        } else if (spec) {
          layout = parseGrid(spec);
        } else {
          console.error("provide a spec (e.g. 2x2) or --cols");
          process.exitCode = 1;
          return;
        }

        const screen = await ghostty.mainScreenFrame();
        const rects = tile(screen, layout, { gap: opts.gap, padding: opts.padding });

        await ghostty.activate();
        const plans = buildSlotPlans(g.windows, rects);
        if (plans.length === 0) {
          console.error(
            `no slotted+TTY-tagged windows in "${name}". Re-add windows with "group add ${name}" (optionally --slot N) and try again.`,
          );
          process.exitCode = 1;
          return;
        }
        await ghostty.setWindowBounds(plans);

        setGroupLayout(state, name, layout);
        await saveState(state);
        console.log(`arranged ${plans.length} window(s) in "${name}"`);
      },
    );

  // ── summon ───────────────────────────────────────────────────────
  program
    .command("summon <name>")
    .description("Focus a group and re-apply its last layout.")
    .action(async (name: string) => {
      const state = await loadState();
      const g = getGroup(state, name);
      await ghostty.activate();
      if (!g.lastLayout) {
        console.log(`focused Ghostty (no layout stored for "${name}" yet)`);
        return;
      }
      const screen = await ghostty.mainScreenFrame();
      const rects = tile(screen, g.lastLayout);
      const plans = buildSlotPlans(g.windows, rects);
      if (plans.length === 0) {
        console.log(`focused Ghostty (no TTY-tagged windows in "${name}")`);
        return;
      }
      await ghostty.setWindowBounds(plans);
      console.log(`summoned "${name}"`);
    });

  // ── theme ────────────────────────────────────────────────────────
  const theme = program.command("theme").description("Manage themes for groups.");

  theme
    .command("set <name> <themeName>")
    .description("Assign a Ghostty theme to a group.")
    .action(async (name: string, themeName: string) => {
      const state = await loadState();
      setGroupTheme(state, name, themeName);
      await saveState(state);
      console.log(`set theme of "${name}" to ${themeName}`);
    });

  theme
    .command("list")
    .description("List available Ghostty themes (via the ghostty CLI).")
    .action(async () => {
      const themes = await ghostty.listThemes();
      for (const t of themes) console.log(t);
    });

  theme
    .command("apply <name>")
    .description("Apply the group's theme via Ghostty IPC.")
    .action(async (name: string) => {
      const state = await loadState();
      const g = getGroup(state, name);
      if (!g.themeName) {
        console.error(`group "${name}" has no theme set`);
        process.exitCode = 1;
        return;
      }
      await ghostty.applyTheme(g.themeName);
      console.log(`applied theme "${g.themeName}"`);
    });

  // ── save ─────────────────────────────────────────────────────────
  program
    .command("save <name> [path]")
    .description("Save a group as a runnable AppleScript that recreates the windows.")
    .action(async (name: string, pathArg?: string) => {
      const state = await loadState();
      const g = getGroup(state, name);

      const tagged = g.windows.filter(
        (w): w is WindowRef & { ttyPath: string; slot: number; cwd: string } =>
          !!w.ttyPath && w.slot !== undefined && !!w.cwd,
      );
      if (tagged.length === 0) {
        console.error(
          `no windows in "${name}" have slot+tty+cwd. Re-add windows from each shell with "group add ${name}".`,
        );
        process.exitCode = 1;
        return;
      }

      const rects = await ghostty.currentRectsByTty(tagged.map((w) => w.ttyPath));
      const entries = tagged
        .map((w) => {
          const rect = rects.get(w.ttyPath);
          if (!rect) return null;
          return {
            slot: w.slot,
            cwd: w.cwd,
            rect,
            ...(w.title ? { title: w.title } : {}),
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      if (entries.length === 0) {
        console.error(
          `could not resolve any current window rects for "${name}" (tty sentinels not matched — windows may be closed)`,
        );
        process.exitCode = 1;
        return;
      }

      const script = buildSaveScript(name, entries);
      const outPath = pathArg ?? join(savesDir(), `${name}.applescript`);
      await fs.mkdir(dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, script, "utf8");
      console.log(`saved ${entries.length} window(s) of "${name}" → ${outPath}`);
      console.log(`restore with:  osascript ${outPath}`);
    });

  // ── restore ──────────────────────────────────────────────────────
  program
    .command("restore <name>")
    .description("Run the saved AppleScript for <name> (recreates the windows).")
    .option("--rebind", "after restoring, re-probe the new windows and update the group's bindings")
    .action(async (name: string, opts: { rebind?: boolean }) => {
      const candidates = [
        name,
        join(savesDir(), `${name}.applescript`),
        join(savesDir(), name),
      ];
      let scriptPath: string | undefined;
      for (const p of candidates) {
        try {
          await fs.access(p);
          scriptPath = p;
          break;
        } catch {
          /* try next */
        }
      }
      if (!scriptPath) {
        console.error(`no saved script for "${name}". Looked at:\n  ${candidates.join("\n  ")}`);
        process.exitCode = 1;
        return;
      }

      const before = await ghostty.listGhosttyIds();
      await ghostty.runScriptFile(scriptPath);
      console.log(`ran ${scriptPath}`);

      if (opts.rebind) {
        await new Promise((r) => setTimeout(r, 600));
        const after = await ghostty.listGhosttyIds();
        const newIds = new Set([...after].filter((id) => !before.has(id)));
        if (newIds.size === 0) {
          console.log("rebind: no new windows detected — group bindings unchanged");
          return;
        }
        const state = await loadState();
        const g = getGroup(state, name);
        const probes = await ghostty.probeWindows();
        const newProbes = probes.filter((p) => newIds.has(p.ghosttyId));

        for (const w of g.windows) {
          if (w.cwd === undefined) continue;
          const match = newProbes.find((p) => p.cwd === w.cwd);
          if (match) {
            w.windowId = match.ghosttyId;
            w.ttyPath = match.ttyPath;
          }
        }
        await saveState(state);
        console.log(`rebind: matched ${newProbes.length} new window(s) to "${name}" by cwd`);
      }
    });

  // ── windows ──────────────────────────────────────────────────────
  program
    .command("windows")
    .description("List all Ghostty windows. --probe resolves tty/cmd; --assign assigns to groups.")
    .option("--probe", "probe TTYs to resolve ghostty id + tty + foreground command")
    .option("--assign", "interactively assign listed windows to groups (implies --probe)")
    .action(async (opts: { probe?: boolean; assign?: boolean }) => {
      const probe = !!(opts.probe || opts.assign);
      const ax = await ghostty.listAllWindows();
      const probeRows = probe ? await ghostty.probeWindows() : [];
      const probeByAx = new Map(probeRows.map((r) => [r.axIndex, r]));

      const state = await loadState();
      const ttyToGroupSlot = new Map<string, string>();
      for (const g of Object.values(state.groups)) {
        for (const w of g.windows) {
          if (w.ttyPath && w.slot !== undefined) {
            ttyToGroupSlot.set(w.ttyPath, `${g.name}:${w.slot}`);
          }
        }
      }

      printWindowsTable(ax, probeByAx, ttyToGroupSlot);

      if (opts.assign) {
        const assignments = await promptAssignments();
        if (assignments.length === 0) {
          console.log("no assignments — nothing changed");
          return;
        }
        for (const a of assignments) {
          const p = probeByAx.get(a.axIndex);
          const axw = ax.find((w) => w.axIndex === a.axIndex);
          if (!p || !axw) {
            console.error(`  skipped idx ${a.axIndex}: no probe data`);
            continue;
          }
          if (!state.groups[a.group]) createGroup(state, a.group);
          const slot = a.slot ?? nextFreeSlot(state.groups[a.group]!);
          const keepTitle = !ghostty.looksLikeShellDefaultTitle(axw.title, p.cwd);
          addWindow(state, a.group, {
            windowId: p.ghosttyId,
            ...(keepTitle && axw.title ? { title: axw.title } : {}),
            ttyPath: p.ttyPath,
            slot,
            ...(p.cwd ? { cwd: p.cwd } : {}),
          });
          console.log(`  assigned idx ${a.axIndex} → ${a.group}:${slot}${p.cwd ? ` (${p.cwd})` : ""}`);
        }
        await saveState(state);
      }
    });

  // ── meta ─────────────────────────────────────────────────────────
  program
    .command("where")
    .description("Print the state file path.")
    .action(() => {
      console.log(statePath());
    });

  await program.parseAsync(argv);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  run(process.argv).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

function printWindowsTable(
  ax: ghostty.WindowInfo[],
  probeByAx: Map<number, ghostty.ProbeRow>,
  ttyToGroupSlot: Map<string, string>,
): void {
  const hasProbe = probeByAx.size > 0;
  const rows = ax.map((w) => {
    const p = probeByAx.get(w.axIndex);
    const ghId = p ? p.ghosttyId.replace(/^tab-group-/, "") : "";
    const tty = p ? p.ttyPath.replace(/^\/dev\//, "") : "";
    const cmd = p ? truncate(p.command, 50) : "";
    const cur = p?.ttyPath ? (ttyToGroupSlot.get(p.ttyPath) ?? "") : "";
    const state = w.minimized ? "min" : `${w.x},${w.y} ${w.width}x${w.height}`;
    const title = truncate(w.title, 45);
    return { idx: String(w.axIndex), ghId, tty, cmd, cur, state, title };
  });

  type Col = { key: keyof (typeof rows)[number]; header: string; show: boolean };
  const allCols: Col[] = [
    { key: "idx", header: "IDX", show: true },
    { key: "ghId", header: "GHOSTTY", show: hasProbe },
    { key: "tty", header: "TTY", show: hasProbe },
    { key: "cur", header: "GROUP:SLOT", show: hasProbe },
    { key: "state", header: "STATE", show: true },
    { key: "cmd", header: "COMMAND", show: hasProbe },
    { key: "title", header: "TITLE", show: true },
  ];
  const cols = allCols.filter((c) => c.show);

  const widths = cols.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => String(r[c.key]).length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((s, i) => s.padEnd(widths[i]!)).join("  ").trimEnd();

  console.log(fmt(cols.map((c) => c.header)));
  console.log(fmt(cols.map((_, i) => "-".repeat(widths[i]!))));
  for (const r of rows) console.log(fmt(cols.map((c) => String(r[c.key]))));
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

interface Assignment {
  axIndex: number;
  group: string;
  slot?: number;
}

async function promptAssignments(): Promise<Assignment[]> {
  console.log(
    "\nAssign: <idx> <group> [slot]  (one per line, blank line to finish)",
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const out: Assignment[] = [];
  return new Promise((resolve) => {
    const ask = () => {
      rl.question("> ", (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          rl.close();
          resolve(out);
          return;
        }
        const parts = trimmed.split(/\s+/);
        const idx = Number(parts[0]);
        const group = parts[1];
        const slot = parts[2] !== undefined ? Number(parts[2]) : undefined;
        if (!Number.isInteger(idx) || idx < 1 || !group) {
          console.log("  usage: <idx> <group> [slot]");
        } else if (slot !== undefined && (!Number.isInteger(slot) || slot < 1)) {
          console.log("  slot must be a positive integer");
        } else {
          out.push({ axIndex: idx, group, ...(slot !== undefined ? { slot } : {}) });
        }
        ask();
      });
    };
    ask();
  });
}

function buildSlotPlans(
  windows: WindowRef[],
  rects: Rect[],
): Array<{ ttyPath: string; rect: Rect }> {
  const plans: Array<{ ttyPath: string; rect: Rect }> = [];
  for (const w of windows) {
    if (!w.ttyPath || w.slot === undefined) continue;
    const cellIdx = w.slot - 1;
    const r = rects[cellIdx];
    if (!r) continue;
    plans.push({ ttyPath: w.ttyPath, rect: r });
  }
  return plans;
}

function formatLayout(layout: LayoutSpec): string {
  if (Array.isArray((layout as { cols: unknown }).cols)) {
    const l = layout as { cols: number[]; rows?: number };
    return `cols=${l.cols.join(",")}${l.rows ? `x${l.rows}` : ""}`;
  }
  const g = layout as { cols: number; rows: number };
  return `${g.cols}x${g.rows}`;
}
