import { Command } from "commander";
import { loadState, saveState, statePath } from "./state.js";
import {
  addWindow,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  setGroupLayout,
  setGroupTheme,
} from "./groups.js";
import { parseCustomColumns, parseGrid, tile } from "./layouts.js";
import * as ghostty from "./ghostty.js";
import type { LayoutSpec } from "./types.js";

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
    .action(async (name: string) => {
      const state = await loadState();
      const win = await ghostty.focusedWindow();
      if (!win) {
        console.error("no focused Ghostty window — focus one and try again");
        process.exitCode = 1;
        return;
      }
      if (!state.groups[name]) createGroup(state, name);
      addWindow(state, name, win);
      await saveState(state);
      console.log(`added window ${win.windowId} (${win.title ?? "untitled"}) to "${name}"`);
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
      for (const w of g.windows) {
        console.log(`  ${w.windowId}\t${w.title ?? ""}`);
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
        for (let i = 0; i < g.windows.length && i < rects.length; i++) {
          const w = g.windows[i]!;
          const r = rects[i]!;
          await ghostty.setWindowBounds(w.windowId, r);
        }

        setGroupLayout(state, name, layout);
        await saveState(state);
        console.log(`arranged ${Math.min(g.windows.length, rects.length)} window(s) in "${name}"`);
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
      for (let i = 0; i < g.windows.length && i < rects.length; i++) {
        await ghostty.setWindowBounds(g.windows[i]!.windowId, rects[i]!);
      }
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

  // ── meta ─────────────────────────────────────────────────────────
  program
    .command("where")
    .description("Print the state file path.")
    .action(() => {
      console.log(statePath());
    });

  await program.parseAsync(argv);
}

function formatLayout(layout: LayoutSpec): string {
  if (Array.isArray((layout as { cols: unknown }).cols)) {
    const l = layout as { cols: number[]; rows?: number };
    return `cols=${l.cols.join(",")}${l.rows ? `x${l.rows}` : ""}`;
  }
  const g = layout as { cols: number; rows: number };
  return `${g.cols}x${g.rows}`;
}
