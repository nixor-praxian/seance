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
  resolveActiveGroup,
  setActiveGroup,
  setGroupLayout,
  setGroupDisplay,
  setGroupTheme,
} from "./groups.js";
import { parseCustomColumns, parseGrid, tile } from "./layouts.js";
import * as ghostty from "./ghostty.js";
import {
  getTheme,
  listThemePairs,
  parseThemeFile,
  registerTheme,
  resolveTheme,
  themeFilePath,
} from "./themes.js";
import type { LayoutSpec, Rect, SeanceState, WindowRef } from "./types.js";

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
      const { title: _drop, ...winNoTitle } = win;
      const entry: WindowRef = { ...winNoTitle, ttyPath, slot, cwd };
      addWindow(state, name, entry);
      await saveState(state);
      console.log(`added window to "${name}" at slot ${slot} (tty ${ttyPath}, cwd ${cwd})`);
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
        const disp = g.displayId === undefined ? "main" : `id${g.displayId}`;
        console.log(
          `${g.name}\t${g.windows.length} window(s)\tlayout=${layout}\tdisplay=${disp}\ttheme=${theme}`,
        );
      }
    });

  group
    .command("show <name>")
    .description("Show windows in a group.")
    .action(async (name: string) => {
      const state = await loadState();
      const g = getGroup(state, name);
      console.log(`group:       ${g.name}`);
      console.log(`theme:       ${g.themeName ?? "-"}`);
      console.log(`last layout: ${g.lastLayout ? formatLayout(g.lastLayout) : "-"}`);
      console.log(`display:     ${g.displayId === undefined ? "main" : `id ${g.displayId}`}`);
      console.log(`windows:     ${g.windows.length}`);
      if (g.windows.length === 0) return;
      const sorted = [...g.windows].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
      const rows = sorted.map((w) => ({
        slot: w.slot !== undefined ? String(w.slot) : "-",
        tty: w.ttyPath ? w.ttyPath.replace(/^\/dev\//, "") : "-",
        cwd: w.cwd ?? "-",
      }));
      const w = (k: "slot" | "tty" | "cwd", header: string) =>
        Math.max(header.length, ...rows.map((r) => r[k].length));
      const ws = [w("slot", "SLOT"), w("tty", "TTY"), w("cwd", "CWD")];
      const fmt = (cells: string[]) =>
        cells.map((s, i) => s.padEnd(ws[i]!)).join("  ").trimEnd();
      console.log("  " + fmt(["SLOT", "TTY", "CWD"]));
      for (const r of rows) console.log("  " + fmt([r.slot, r.tty, r.cwd]));
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
    .command("grid [arg1] [arg2]")
    .description(
      'Arrange a group on screen. Forms: "grid 2x2" (active group), "grid <name> 2x2", or "grid <name>" (re-apply last layout).',
    )
    .option("--cols <weights>", "comma-separated column weights (e.g. 1,3)")
    .option("--rows <n>", "rows when using --cols", (v) => Number(v))
    .option("--gap <px>", "gap between tiles in px", (v) => Number(v), 0)
    .option("--padding <px>", "outer padding in px", (v) => Number(v), 0)
    .option("--screen <n>", "target display index (see `seance screens`)", (v) => Number(v))
    .action(
      async (
        arg1: string | undefined,
        arg2: string | undefined,
        opts: { cols?: string; rows?: number; gap: number; padding: number; screen?: number },
      ) => {
        const state = await loadState();
        const looksLikeSpec = (s: string | undefined) => !!s && /^\d+\s*[xX]\s*\d+$/.test(s);

        let name: string | undefined;
        let spec: string | undefined;
        if (arg2 !== undefined) {
          name = arg1;
          spec = arg2;
        } else if (looksLikeSpec(arg1)) {
          spec = arg1;
          name = resolveActiveGroup(state);
        } else {
          name = arg1 ?? resolveActiveGroup(state);
        }

        if (!name) {
          throw new Error(
            'no active group. Pass one: "seance grid <name> 2x2" — or set one up with "seance init"',
          );
        }
        const g = getGroup(state, name);

        let layout: LayoutSpec;
        if (opts.cols) {
          layout = {
            cols: parseCustomColumns(opts.cols),
            ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
          };
        } else if (spec) {
          layout = parseGrid(spec);
        } else if (g.lastLayout) {
          layout = g.lastLayout;
        } else {
          throw new Error('provide a spec (e.g. "2x2") or --cols');
        }

        const screens = await ghostty.listScreens();
        const target = pickScreen(screens, {
          ...(opts.screen !== undefined ? { index: opts.screen } : {}),
          ...(g.displayId !== undefined ? { displayId: g.displayId } : {}),
        });
        if (opts.screen === undefined && g.displayId !== undefined && target.displayId !== g.displayId) {
          console.log(`(display ${g.displayId} not connected — tiling on main to avoid stranding windows)`);
        }
        const rects = tile(target.rect, layout, { gap: opts.gap, padding: opts.padding });

        await ghostty.activate();
        const plans = buildSlotPlans(g.windows, rects);
        if (plans.length === 0) {
          throw new Error(
            `no slotted+TTY-tagged windows in "${name}". Re-add with "seance group add ${name} --slot N" from each window.`,
          );
        }
        await ghostty.setWindowBounds(plans);

        setGroupLayout(state, name, layout);
        setGroupDisplay(state, name, target.displayId);
        setActiveGroup(state, name);
        await saveState(state);
        console.log(`arranged ${plans.length} window(s) in "${name}" on display ${target.index}`);
      },
    );

  // ── summon ───────────────────────────────────────────────────────
  program
    .command("summon [name]")
    .description("Focus a group and re-apply its last layout. Defaults to the active group.")
    .action(async (nameArg: string | undefined) => {
      const state = await loadState();
      const name = nameArg ?? resolveActiveGroup(state);
      if (!name) {
        throw new Error('no active group. Pass one: "seance summon <name>"');
      }
      const g = getGroup(state, name);
      await ghostty.activate();
      setActiveGroup(state, name);
      await saveState(state);
      if (!g.lastLayout) {
        console.log(`focused Ghostty (no layout stored for "${name}" yet)`);
        return;
      }
      const screens = await ghostty.listScreens();
      const target = pickScreen(screens, g.displayId !== undefined ? { displayId: g.displayId } : {});
      if (g.displayId !== undefined && target.displayId !== g.displayId) {
        console.log(`(display ${g.displayId} not connected — using main)`);
      }
      const rects = tile(target.rect, g.lastLayout);
      const plans = buildSlotPlans(g.windows, rects);
      if (plans.length === 0) {
        console.log(`focused Ghostty (no TTY-tagged windows in "${name}")`);
        return;
      }
      await ghostty.setWindowBounds(plans);
      console.log(`summoned "${name}"`);
    });

  // ── gather ───────────────────────────────────────────────────────
  program
    .command("gather [name]")
    .description(
      "Re-tile a group on its display and report any windows stranded on another Space (with how to recover them). Defaults to the active group.",
    )
    .action(async (nameArg: string | undefined) => {
      const state = await loadState();
      const name = nameArg ?? resolveActiveGroup(state);
      if (!name) {
        throw new Error('no active group. Pass one: "seance gather <name>"');
      }
      const g = getGroup(state, name);
      await ghostty.activate();
      setActiveGroup(state, name);
      await saveState(state);

      const tagged = g.windows.filter(
        (w): w is WindowRef & { ttyPath: string } => !!w.ttyPath && w.slot !== undefined,
      );
      if (tagged.length === 0) {
        console.log(`no slotted+TTY-tagged windows in "${name}".`);
        return;
      }

      // Windows we can locate via the System-Events sentinel are on the current
      // Space; the rest are stranded on another Space (or busy reasserting a
      // title). Tile only the reachable ones — never move a phantom.
      const present = await ghostty.currentRectsByTty(tagged.map((w) => w.ttyPath));
      const onSpace = tagged.filter((w) => present.has(w.ttyPath));
      const stranded = tagged.filter((w) => !present.has(w.ttyPath));

      if (g.lastLayout && onSpace.length > 0) {
        const screens = await ghostty.listScreens();
        const target = pickScreen(
          screens,
          g.displayId !== undefined ? { displayId: g.displayId } : {},
        );
        if (g.displayId !== undefined && target.displayId !== g.displayId) {
          console.log(`(display ${g.displayId} not connected — gathering on main)`);
        }
        const rects = tile(target.rect, g.lastLayout);
        const plans = buildSlotPlans(onSpace, rects);
        if (plans.length > 0) await ghostty.setWindowBounds(plans);
        console.log(`gathered ${plans.length} window(s) of "${name}" on display ${target.index}`);
      } else if (onSpace.length > 0) {
        console.log(`${onSpace.length} window(s) reachable, but no layout stored — run "seance grid ${name} <NxM>" first.`);
      }

      if (stranded.length > 0) {
        const hints = await ghostty.foregroundCommandsByTty(stranded.map((w) => w.ttyPath));
        console.log(
          `\n${stranded.length} window(s) could not be reached on this Space (stranded on another Space, or busy):`,
        );
        const sorted = [...stranded].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
        for (const w of sorted) {
          console.log(`  slot ${w.slot}  ${w.cwd ?? "?"}`);
          const cmd = hints.get(w.ttyPath);
          if (cmd) console.log(`           ↻ ${truncate(cmd, 80)}`);
        }
        console.log(
          `  Recover: Mission Control (F3) and click them onto this Space, then re-run "seance gather ${name}".`,
        );
      }
    });

  // ── theme ────────────────────────────────────────────────────────
  const theme = program.command("theme").description("Manage themes for groups.");

  theme
    .command("set <a> [rest...]")
    .description(
      "Assign a theme pair. Forms: 'theme set <pair>' (active group) or 'theme set <group> <pair>'. Multi-word pair names don't need quoting.",
    )
    .action(async (a: string, rest: string[]) => {
      const state = await loadState();
      const { group, pair } = resolveSetThemeArgs(state, a, rest);
      setGroupTheme(state, group, pair);
      setActiveGroup(state, group);
      await saveState(state);
      console.log(`set theme of "${group}" to ${pair}`);
    });

  theme
    .command("list")
    .description("List available Ghostty themes (via the ghostty CLI).")
    .action(async () => {
      const themes = await ghostty.listThemes();
      for (const t of themes) console.log(t);
    });

  theme
    .command("apply [group]")
    .description("Paint the group's theme into its windows via OSC. Defaults to the active group.")
    .action(async (groupArg: string | undefined) => {
      const state = await loadState();
      const name = groupArg ?? resolveActiveGroup(state);
      if (!name) {
        throw new Error('no active group. Pass one: "seance theme apply <group>"');
      }
      await paintGroupTheme(state, name);
      setActiveGroup(state, name);
      await saveState(state);
    });

  theme
    .command("list-pairs")
    .description("List registered theme pairs (name → dark/light).")
    .action(async () => {
      const state = await loadState();
      const pairs = listThemePairs(state);
      if (pairs.length === 0) {
        console.log("(no pairs registered)");
        return;
      }
      const widths = [
        Math.max(4, ...pairs.map((p) => p.name.length)),
        Math.max(4, ...pairs.map((p) => p.pair.dark.length)),
      ];
      console.log("NAME".padEnd(widths[0]!) + "  DARK".padEnd(widths[1]! + 2) + "  LIGHT");
      for (const { name, pair } of pairs) {
        console.log(
          name.padEnd(widths[0]!) + "  " + pair.dark.padEnd(widths[1]!) + "  " + pair.light,
        );
      }
    });

  theme
    .command("register <name>")
    .description("Register or overwrite a theme pair.")
    .requiredOption("--dark <theme>", "Ghostty theme name for dark appearance")
    .requiredOption("--light <theme>", "Ghostty theme name for light appearance")
    .action(async (name: string, opts: { dark: string; light: string }) => {
      const dark = opts.dark.trim();
      const light = opts.light.trim();
      if (!dark || !light) {
        console.error("--dark and --light must be non-empty theme names");
        process.exitCode = 1;
        return;
      }
      const state = await loadState();
      registerTheme(state, name, { dark, light });
      await saveState(state);
      console.log(`registered "${name}" (dark=${dark}, light=${light})`);
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
        const newProbes = probes.filter(
          (p) => p.ghosttyId !== undefined && newIds.has(p.ghosttyId),
        );

        for (const w of g.windows) {
          if (w.cwd === undefined) continue;
          const match = newProbes.find((p) => p.cwd === w.cwd);
          if (match) {
            w.windowId = match.ghosttyId ?? `tty:${match.ttyPath}`;
            w.ttyPath = match.ttyPath;
          }
        }
        await saveState(state);
        console.log(`rebind: matched ${newProbes.length} new window(s) to "${name}" by cwd`);
      }
    });

  // ── init ─────────────────────────────────────────────────────────
  program
    .command("init [name]")
    .description("Interactive wizard: pick windows for a group, pick a theme, apply a grid.")
    .option("--no-theme", "skip the theme picker")
    .option("--no-grid", "skip layout application")
    .action(
      async (
        nameArg: string | undefined,
        opts: { theme: boolean; grid: boolean },
      ) => {
        const state = await loadState();
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          const name = nameArg ?? (await ask(rl, "Group name: ")).trim();
          if (!name) {
            console.error("init: group name required");
            process.exitCode = 1;
            return;
          }
          if (state.groups[name]) {
            const answer = (
              await ask(rl, `Group "${name}" exists. [r]eplace, [m]erge, [c]ancel? (m) `)
            ).trim().toLowerCase();
            if (answer === "c" || answer === "cancel") return;
            if (answer === "r" || answer === "replace") {
              deleteGroup(state, name);
              createGroup(state, name);
            }
          } else {
            createGroup(state, name);
          }

          console.log("\nDetecting Ghostty windows…");
          const ax = await ghostty.listAllWindows();
          const probe = await ghostty.probeWindows();
          const probeByAx = new Map(probe.map((p) => [p.axIndex, p]));
          if (ax.length === 0) {
            console.error("init: no Ghostty windows detected");
            process.exitCode = 1;
            return;
          }

          const ttyToGroupSlot = new Map<string, string>();
          for (const g of Object.values(state.groups)) {
            for (const w of g.windows) {
              if (w.ttyPath && w.slot !== undefined) {
                ttyToGroupSlot.set(w.ttyPath, `${g.name}:${w.slot}`);
              }
            }
          }
          printWindowsTable(ax, probeByAx, ttyToGroupSlot);

          let picks: number[] = [];
          while (picks.length === 0) {
            const pickRaw = (
              await ask(
                rl,
                `\nPick windows for "${name}" in slot order — IDX numbers separated by spaces or commas, or "all" (empty to cancel): `,
              )
            ).trim();
            if (!pickRaw) {
              console.log("init: cancelled");
              return;
            }
            let parsed: number[];
            if (pickRaw === "all") {
              parsed = ax.filter((w) => probeByAx.has(w.axIndex)).map((w) => w.axIndex);
            } else {
              parsed = pickRaw
                .split(/[\s,]+/)
                .map((s) => Number(s))
                .filter((n) => Number.isInteger(n));
            }
            const valid = parsed.filter((idx) => probeByAx.has(idx));
            const dropped = parsed.filter((idx) => !probeByAx.has(idx));
            if (dropped.length > 0) {
              console.log(
                `  IDXs ${dropped.join(", ")} couldn't be probed (Claude Code, ssh, or a shell loop` +
                  ` is reasserting the title faster than we can). Two ways to add them:`,
              );
              console.log(`    a) from any local Ghostty window:  seance windows --probe --assign`);
              console.log(`    b) from a LOCAL shell in the window (only works for non-ssh windows):`);
              console.log(`         seance group add ${name} --slot N`);
            }
            picks = valid;
          }

          for (let i = 0; i < picks.length; i++) {
            const axIdx = picks[i]!;
            const p = probeByAx.get(axIdx)!;
            const slot = i + 1;
            addWindow(state, name, {
              windowId: p.ghosttyId ?? `tty:${p.ttyPath}`,
              ttyPath: p.ttyPath,
              slot,
              ...(p.cwd ? { cwd: p.cwd } : {}),
            });
          }
          console.log(`  ✓ added ${picks.length} window(s) to "${name}"`);

          const screens = await ghostty.listScreens();
          if (screens.length > 1) {
            console.log("\nTarget display (Enter for 0 = main):");
            for (const s of screens) {
              const size = `${s.rect.width}x${s.rect.height}`;
              const role = s.isMain ? " (main)" : "";
              console.log(`  ${s.index}) ${size} @ ${s.rect.x},${s.rect.y}${role}`);
            }
            const sRaw = (await ask(rl, "> ")).trim();
            if (sRaw) {
              const sIdx = Number(sRaw);
              if (Number.isInteger(sIdx) && sIdx >= 0 && sIdx < screens.length) {
                setGroupDisplay(state, name, screens[sIdx]!.displayId);
                console.log(`  ✓ target display ${sIdx}`);
              } else {
                console.error(`  ! invalid display "${sRaw}", using main`);
              }
            }
          }

          if (opts.theme) {
            const pairs = listThemePairs(state);
            console.log("\nTheme pair (Enter to skip):");
            pairs.forEach((p, i) => {
              console.log(`  ${i + 1}) ${p.name}  (dark=${p.pair.dark}, light=${p.pair.light})`);
            });
            const tRaw = (await ask(rl, "> ")).trim();
            if (tRaw) {
              const pick = Number(tRaw);
              const chosen = Number.isInteger(pick) && pick >= 1 && pick <= pairs.length
                ? pairs[pick - 1]!
                : pairs.find((p) => p.name === tRaw);
              if (chosen) {
                setGroupTheme(state, name, chosen.name);
                console.log(`  ✓ set theme "${chosen.name}"`);
              } else {
                console.error(`  ! unknown theme "${tRaw}", skipping`);
              }
            }
          }

          let layout: LayoutSpec | undefined;
          if (opts.grid) {
            const def = defaultGrid(picks.length);
            const gRaw = (
              await ask(rl, `\nLayout (e.g. 2x2, --cols 1,3) (default ${def.cols}x${def.rows}): `)
            ).trim();
            if (gRaw === "" || gRaw === "default") {
              layout = def;
            } else if (gRaw.startsWith("--cols ")) {
              try {
                layout = { cols: parseCustomColumns(gRaw.slice(7).trim()) };
              } catch (err) {
                console.error(`  ! ${(err as Error).message}, falling back to ${def.cols}x${def.rows}`);
                layout = def;
              }
            } else {
              try {
                layout = parseGrid(gRaw);
              } catch (err) {
                console.error(`  ! ${(err as Error).message}, falling back to ${def.cols}x${def.rows}`);
                layout = def;
              }
            }
          }

          rl.close();
          await saveState(state);

          if (layout) {
            const gScreen = state.groups[name]!;
            const target = pickScreen(
              screens,
              gScreen.displayId !== undefined ? { displayId: gScreen.displayId } : {},
            );
            const rects = tile(target.rect, layout);
            const plans = buildSlotPlans(state.groups[name]!.windows, rects);
            if (plans.length > 0) {
              await ghostty.activate();
              await ghostty.setWindowBounds(plans);
              setGroupLayout(state, name, layout);
              await saveState(state);
              console.log(`  ✓ arranged ${plans.length} window(s)`);
            }
          }

          const g = state.groups[name]!;
          if (g.themeName) {
            const pair = getTheme(state, g.themeName);
            if (pair) {
              try {
                const appearance = await ghostty.currentAppearance();
                const themeName = resolveTheme(pair, appearance);
                const palette = await parseThemeFile(themeFilePath(themeName));
                const ttyWindows = g.windows.filter((w) => w.ttyPath);
                for (const w of ttyWindows) {
                  await ghostty.applyPaletteToTty(w.ttyPath!, palette);
                }
                console.log(`  ✓ painted ${ttyWindows.length} window(s) with ${themeName}`);
              } catch (err) {
                console.error(`  ! theme apply failed: ${(err as Error).message}`);
              }
            }
          }

          console.log(`\n"${name}" ready. Try:  seance summon ${name}`);
        } finally {
          rl.close();
        }
      },
    );

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
      const buildTtyToGroupSlot = (): Map<string, string> => {
        const m = new Map<string, string>();
        for (const g of Object.values(state.groups)) {
          for (const w of g.windows) {
            if (w.ttyPath && w.slot !== undefined) m.set(w.ttyPath, `${g.name}:${w.slot}`);
          }
        }
        return m;
      };

      if (!opts.assign) {
        printWindowsTable(ax, probeByAx, buildTtyToGroupSlot());
        return;
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      let dirty = false;
      try {
        while (true) {
          printWindowsTable(ax, probeByAx, buildTtyToGroupSlot());
          console.log("\nAssign: <idx> <group> [slot]   (blank line to finish)");
          const line = (await ask(rl, "> ")).trim();
          if (!line) break;
          const parts = line.split(/\s+/);
          const idx = Number(parts[0]);
          const group = parts[1];
          const slot = parts[2] !== undefined ? Number(parts[2]) : undefined;
          if (!Number.isInteger(idx) || idx < 1 || !group) {
            console.log("  ! usage: <idx> <group> [slot]");
            continue;
          }
          if (slot !== undefined && (!Number.isInteger(slot) || slot < 1)) {
            console.log("  ! slot must be a positive integer");
            continue;
          }
          const p = probeByAx.get(idx);
          if (!p) {
            console.log(`  ! idx ${idx} has no probe data — skipped`);
            continue;
          }
          if (!state.groups[group]) createGroup(state, group);
          const finalSlot = slot ?? nextFreeSlot(state.groups[group]!);
          addWindow(state, group, {
            windowId: p.ghosttyId ?? `tty:${p.ttyPath}`,
            ttyPath: p.ttyPath,
            slot: finalSlot,
            ...(p.cwd ? { cwd: p.cwd } : {}),
          });
          dirty = true;
          console.log(`  ✓ idx ${idx} → ${group}:${finalSlot}${p.cwd ? `  (${p.cwd})` : ""}`);
        }
      } finally {
        rl.close();
      }
      if (dirty) {
        await saveState(state);
        console.log("\nstate saved.");
      } else {
        console.log("no assignments — nothing changed");
      }
    });

  // ── use (shortcut) ───────────────────────────────────────────────
  program
    .command("use <pair...>")
    .description(
      'Shortcut: assign a theme pair to the active group AND paint it. E.g. "seance use Rose Pine".',
    )
    .action(async (pairArgs: string[]) => {
      const state = await loadState();
      const active = resolveActiveGroup(state);
      if (!active) {
        throw new Error('no active group. Run "seance init <name>" first.');
      }
      const { group, pair } = resolveSetThemeArgs(state, active, pairArgs);
      setGroupTheme(state, group, pair);
      setActiveGroup(state, group);
      await paintGroupTheme(state, group);
      await saveState(state);
    });

  // ── screens ──────────────────────────────────────────────────────
  program
    .command("screens")
    .description("List displays seance can target. The index feeds `grid --screen <n>`.")
    .action(async () => {
      const screens = await ghostty.listScreens();
      if (screens.length === 0) {
        console.log("(no displays detected)");
        return;
      }
      console.log("IDX  ID    SIZE         POSITION         ROLE");
      console.log("---  ----  -----------  ---------------  ----");
      for (const s of screens) {
        const size = `${s.rect.width}x${s.rect.height}`;
        const pos = `${s.rect.x},${s.rect.y}`;
        const role = [s.isMain ? "main" : "", s.isPrimary ? "primary" : ""]
          .filter(Boolean)
          .join("+") || "external";
        console.log(
          `${String(s.index).padEnd(3)}  ${String(s.displayId).padEnd(4)}  ${size.padEnd(11)}  ${pos.padEnd(15)}  ${role}`,
        );
      }
    });

  // ── meta ─────────────────────────────────────────────────────────
  program
    .command("where")
    .description("Print the state file path.")
    .action(() => {
      console.log(statePath());
    });

  try {
    await program.parseAsync(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`seance: ${friendlyError(msg)}`);
    process.exit(1);
  }
}

async function paintGroupTheme(state: SeanceState, name: string): Promise<void> {
  const g = getGroup(state, name);
  if (!g.themeName) {
    throw new Error(`group "${name}" has no theme set — try "seance theme set ${name} <pair>"`);
  }
  const pair = getTheme(state, g.themeName);
  if (!pair) {
    throw new Error(
      `unknown theme pair "${g.themeName}". See "seance theme list-pairs".`,
    );
  }
  const appearance = await ghostty.currentAppearance();
  const themeName = resolveTheme(pair, appearance);
  const palette = await parseThemeFile(themeFilePath(themeName)).catch((err: Error) => {
    throw new Error(`failed to load Ghostty theme "${themeName}": ${err.message}`);
  });
  const windows = g.windows.filter((w) => w.ttyPath);
  if (windows.length === 0) {
    throw new Error(`no TTY-tagged windows in "${name}"`);
  }
  let applied = 0;
  for (const w of windows) {
    try {
      await ghostty.applyPaletteToTty(w.ttyPath!, palette);
      applied++;
    } catch (err) {
      console.error(`  ${w.ttyPath}: ${(err as Error).message}`);
    }
  }
  console.log(
    `applied "${g.themeName}" → ${themeName} (${appearance}) to ${applied}/${windows.length} window(s) in "${name}"`,
  );
}

/**
 * Disambiguate `theme set <a> [rest...]` into {group, pair}:
 *  - "set <pair-with-spaces>"        → joined `[a, ...rest]` is a known pair → active group
 *  - "set <group> <pair-with-spaces>"→ rest is non-empty → group=a, pair=rest.join(" ")
 *  - "set <pair>"                    → a is a known pair, rest empty → active group
 *  - else                            → friendly error listing known pairs
 */
function resolveSetThemeArgs(
  state: SeanceState,
  a: string,
  rest: string[],
): { group: string; pair: string } {
  const known = new Set(listThemePairs(state).map((p) => p.name));
  const joined = [a, ...rest].join(" ");
  if (known.has(joined)) {
    const active = resolveActiveGroup(state);
    if (!active) {
      throw new Error(
        `no active group. Use "seance theme set <group> ${joined}" or run "seance init" first.`,
      );
    }
    return { group: active, pair: joined };
  }
  if (rest.length > 0) {
    const pair = rest.join(" ");
    if (!known.has(pair)) {
      throw new Error(themePairNotFoundMessage(pair, [...known]));
    }
    return { group: a, pair };
  }
  if (known.has(a)) {
    const active = resolveActiveGroup(state);
    if (!active) {
      throw new Error(
        `no active group. Use "seance theme set <group> ${a}" or run "seance init" first.`,
      );
    }
    return { group: active, pair: a };
  }
  throw new Error(themePairNotFoundMessage(a, [...known]));
}

function themePairNotFoundMessage(attempted: string, known: string[]): string {
  return (
    `no theme pair "${attempted}". Registered pairs: ${known.sort().join(", ")}.\n` +
    `  Tip: pair names are seance's short labels (e.g. "Ayu"), not raw Ghostty theme names (e.g. "Ayu Mirage").`
  );
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  run(process.argv).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`seance: ${friendlyError(msg)}`);
    process.exit(1);
  });
}

function friendlyError(msg: string): string {
  const m = /^no such group "(.+)"$/.exec(msg.trim());
  if (m) {
    return `no group "${m[1]}". Run "seance group list" to see groups, or "seance init <name>" to create one.`;
  }
  return msg.replace(/^seance:\s*/, "");
}

function printWindowsTable(
  ax: ghostty.WindowInfo[],
  probeByAx: Map<number, ghostty.ProbeRow>,
  ttyToGroupSlot: Map<string, string>,
): void {
  const hasProbe = probeByAx.size > 0;
  const rows = ax.map((w) => {
    const p = probeByAx.get(w.axIndex);
    const ghId = p?.ghosttyId ? p.ghosttyId.replace(/^tab-group-/, "") : "";
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

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/** Nearest-square grid for N panes: rows=floor(sqrt(N)), cols=ceil(N/rows). */
function defaultGrid(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  const rows = Math.max(1, Math.floor(Math.sqrt(n)));
  const cols = Math.ceil(n / rows);
  return { cols, rows };
}

/**
 * Choose a target display. An explicit `index` (from `--screen <n>`) wins and
 * errors if out of range. Otherwise fall back to the group's persisted
 * `displayId` (matched against the current screens), then to the main display.
 * Returns the live ScreenInfo so the caller persists the stable displayId.
 */
function pickScreen(
  screens: ghostty.ScreenInfo[],
  opts: { index?: number; displayId?: number },
): ghostty.ScreenInfo {
  if (screens.length === 0) throw new Error("no displays detected");
  if (opts.index !== undefined) {
    const s = screens[opts.index];
    if (!s) {
      const have = screens.length === 1 ? "only display 0" : `displays 0..${screens.length - 1}`;
      throw new Error(`no display #${opts.index} — ${have} present. See "seance screens".`);
    }
    return s;
  }
  if (opts.displayId !== undefined) {
    const s = screens.find((x) => x.displayId === opts.displayId);
    if (s) return s;
  }
  return screens.find((s) => s.isMain) ?? screens[0]!;
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
