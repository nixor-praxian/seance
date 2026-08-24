import { Command } from "commander";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  ensurePolicy,
  loadState,
  saveState,
  savesDir,
  statePath,
  syncClaudeCodeTheme,
} from "./state.js";
import {
  assignThemes,
  autoGrid,
  computeRoles,
  placePanes,
  repoOf,
  resolveRole,
  type IdentityEntry,
  type LivePane,
  type PlacementRule,
  type PolicyScreen,
  type Role,
} from "./policy.js";
import {
  assignFamilies,
  layoutScreen,
  screenKeyForRect,
  type FamilyRequest,
  type PaneBudget,
  type PlacementNote,
} from "./arrange.js";
import { CHEATSHEET } from "./cheatsheet.js";
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
  setGroupBackground,
  setGroupTheme,
} from "./groups.js";
import { parseCustomColumns, parseGrid, tile } from "./layouts.js";
import {
  activeSessionUuids,
  isClaudeCommand,
  listRepoSessions,
  type SessionPane,
  type SessionSnapshot,
} from "./sessions.js";
import * as ghostty from "./ghostty.js";
import {
  getTheme,
  listThemePairs,
  parseThemeFile,
  registerTheme,
  resolveTheme,
  themeFilePath,
  type Appearance,
  type ThemePalette,
} from "./themes.js";
import {
  DEFAULT_MIN_CONTRAST,
  contrastRepairs,
  enforceContrast,
} from "./contrast.js";
import type { GridSpec, LayoutSpec, Rect, SeanceState, WindowRef } from "./types.js";

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
      const bgStr =
        g.background == null
          ? ""
          : typeof g.background === "string"
            ? ` (bg ${g.background})`
            : ` (bg dark ${g.background.dark} / light ${g.background.light})`;
      console.log(`theme:       ${g.themeName ?? "-"}${bgStr}`);
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
        const res = await ghostty.setWindowBounds(plans);

        setGroupLayout(state, name, layout);
        setGroupDisplay(state, name, target.displayId);
        setActiveGroup(state, name);
        await saveState(state);
        console.log(`arranged ${res.placed.length} window(s) in "${name}" on display ${target.index}`);
        if (res.stranded.length > 0) {
          console.log(
            `stranded (unreachable on this Space): ${res.stranded.map((t) => t.replace(/^\/dev\//, "")).join(", ")}`,
          );
        }
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
      const present = await ghostty.currentRectsByTty(
        tagged.map((w) => ({ ttyPath: w.ttyPath, ...(w.cwd ? { label: basename(w.cwd) } : {}) })),
      );
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

      const rects = await ghostty.currentRectsByTty(
        tagged.map((w) => ({ ttyPath: w.ttyPath, label: basename(w.cwd) })),
      );
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
                const appearance = state.appearance ?? (await ghostty.currentAppearance());
                const themeName = resolveTheme(pair, appearance);
                const palette = guardPalette(
                  state,
                  await parseThemeFile(themeFilePath(themeName)),
                );
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

  // ── background ───────────────────────────────────────────────────
  program
    .command("background <group> <color> [light]")
    .description(
      'Per-group background override painted on top of the theme. One color for both appearances, or "<dark> <light>" for an appearance-aware pair. "none" clears it.',
    )
    .action(async (group: string, color: string, light: string | undefined) => {
      const state = await loadState();
      const g = getGroup(state, group);
      const clear = color.toLowerCase() === "none";
      setGroupBackground(state, group, clear ? null : light ? { dark: color, light } : color);
      setActiveGroup(state, group);
      if (g.themeName) {
        await paintGroupTheme(state, group);
      } else if (!clear) {
        const appearance = state.appearance ?? (await ghostty.currentAppearance());
        const bg = light ? (appearance === "dark" ? color : light) : color;
        const windows = g.windows.filter((w) => w.ttyPath);
        for (const w of windows) {
          try {
            await ghostty.applyBackgroundToTty(w.ttyPath!, bg);
          } catch (err) {
            console.error(`  ${w.ttyPath}: ${(err as Error).message}`);
          }
        }
        console.log(`painted bg ${bg} to ${windows.length} window(s) in "${group}"`);
      }
      await saveState(state);
      if (clear) console.log(`cleared background override for "${group}"`);
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

  // ── appearance ───────────────────────────────────────────────────
  program
    .command("appearance <mode>")
    .description(
      "Force theme appearance regardless of macOS: dark | light | auto (follow system). Repaints all themed groups and points Claude Code's own theme at the same polarity.",
    )
    .action(async (mode: string) => {
      const m = mode.toLowerCase();
      if (!["dark", "light", "auto"].includes(m)) {
        throw new Error('appearance must be "dark", "light", or "auto"');
      }
      const state = await loadState();
      if (m === "auto") delete state.appearance;
      else state.appearance = m as "dark" | "light";
      await saveState(state);
      console.log(`appearance = ${m}`);

      const effective = state.appearance ?? (await ghostty.currentAppearance());
      const synced = await syncClaudeCodeTheme(effective);
      if (synced) {
        console.log(`Claude Code theme = ${synced} (restart or /config in running sessions)`);
      }

      for (const name of Object.keys(state.groups)) {
        if (state.groups[name]!.themeName) {
          try {
            await paintGroupTheme(state, name);
          } catch (err) {
            console.error(`  ${name}: ${(err as Error).message}`);
          }
        }
      }
    });

  // ── contrast ─────────────────────────────────────────────────────
  program
    .command("contrast [ratio]")
    .description(
      "Minimum WCAG contrast every palette slot must clear against its background before seance paints it. No argument audits the registered pairs. \"off\" paints themes verbatim.",
    )
    .action(async (ratio: string | undefined) => {
      const state = await loadState();
      if (ratio !== undefined) {
        const value = ratio.toLowerCase() === "off" ? 0 : Number(ratio);
        if (!Number.isFinite(value) || value < 0 || value > 21) {
          throw new Error('contrast must be a ratio between 0 and 21, or "off"');
        }
        state.minContrast = value;
        await saveState(state);
      }
      const minRatio = state.minContrast ?? DEFAULT_MIN_CONTRAST;
      console.log(
        `min contrast = ${minRatio === 0 ? "off (themes painted verbatim)" : `${minRatio}:1`}`,
      );
      if (minRatio === 0) return;

      const appearance = state.appearance ?? (await ghostty.currentAppearance());
      console.log(`\nrepairs at ${appearance} appearance:\n`);
      console.log("PAIR               THEME                     WORST  REPAIRED");
      console.log("-----------------  ------------------------  -----  --------");
      for (const { name, pair } of listThemePairs(state)) {
        const themeName = resolveTheme(pair, appearance);
        let palette;
        try {
          palette = await parseThemeFile(themeFilePath(themeName));
        } catch {
          console.log(`${name.padEnd(17)}  ${themeName.padEnd(24)}  (theme file not found)`);
          continue;
        }
        const repairs = contrastRepairs(palette, { minRatio });
        const worst = repairs.length === 0 ? "—" : `${Math.min(...repairs.map((r) => r.ratioBefore)).toFixed(2)}`;
        console.log(
          `${name.padEnd(17)}  ${themeName.padEnd(24)}  ${worst.padEnd(5)}  ${repairs.length === 0 ? "none" : `${repairs.length}/18`}`,
        );
      }
    });

  // ── organize (seance 2.0: perception + policy, docs/vision.md) ───
  program
    .command("organize [grid]")
    .description(
      'Perceive every live pane, derive repo identity, place by policy, tile, and paint. Idempotent. Pass a grid ("seance organize 3x2") to force that shape this run; "auto" clears every pinned grid.',
    )
    .option("--screen <n>", "apply the grid to one display only (see `seance screens`)", (v) => Number(v))
    .option("--pin", "remember the grid as policy instead of applying it for this run only")
    .action(async (gridArg: string | undefined, opts: { screen?: number; pin?: boolean }) => {
      if (gridArg === undefined) {
        if (opts.screen !== undefined || opts.pin) {
          throw new Error("--screen and --pin need a grid: \"seance organize 3x2 --pin\"");
        }
        await runOrganize();
        return;
      }
      if (gridArg.toLowerCase() === "auto") {
        const state = await loadState();
        ensurePolicy(state);
        const cleared = state.placement!.filter((r) => r.grid).map((r) => r.repo);
        state.placement = state.placement!.map(({ grid: _grid, ...rest }) => rest);
        await saveState(state);
        console.log(cleared.length > 0 ? `grid pins cleared: ${cleared.join(", ")}` : "no grid pins to clear");
        await runOrganize();
        return;
      }
      await runOrganize({
        grid: parseGrid(gridArg),
        ...(opts.screen !== undefined ? { screen: opts.screen } : {}),
        ...(opts.pin ? { pin: true } : {}),
      });
    });

  // ── arrange (automatic: perceive → distribute → tile → paint) ────
  program
    .command("arrange [name]")
    .description(
      "Group every active (non-minimized) pane by repo, spread the repos across every connected display, tile each one into a shape that suits that display, and paint. Takes no shape — use `organize` for that. `arrange <name>` applies a saved arrangement.",
    )
    .option("--save <name>", "record where the windows are now as a named arrangement, moving nothing")
    .action(async (name: string | undefined, opts: { save?: string }) => {
      const state = await loadState();
      ensurePolicy(state);
      if (name !== undefined && opts.save !== undefined) {
        throw new Error('arrange --save takes the name itself: "seance arrange --save <name>"');
      }
      if (name !== undefined && !state.arrangements?.[name]) {
        const known = Object.keys(state.arrangements ?? {}).sort();
        throw new Error(
          `no arrangement "${name}". Saved: ${known.length > 0 ? known.join(", ") : "none"}`,
        );
      }
      await runArrange(state, {
        ...(name !== undefined ? { name } : {}),
        ...(opts.save !== undefined ? { save: opts.save } : {}),
      });
    });

  // ── place (imperative override, recorded as policy) ──────────────
  program
    .command("place <repo> <grid>")
    .description(
      'Pin a repo\'s grid + display and tile it now: "seance place zeus 3x3 --screen 1". Grid "auto" clears the pin. Organize honours pins from then on.',
    )
    .option("--screen <n>", "target display index (see `seance screens`)", (v) => Number(v))
    .action(async (repoArg: string, gridArg: string, opts: { screen?: number }) => {
      const state = await loadState();
      ensurePolicy(state);
      const { live } = await perceiveWorld();
      const panes = live.filter((p) => p.repo === repoArg);
      if (panes.length === 0) {
        const repos = [...new Set(live.map((p) => p.repo))].sort().join(", ");
        throw new Error(`no live pane for "${repoArg}". Live repos: ${repos || "none"}`);
      }

      const screens = await ghostty.listScreens();
      const policyScreens: PolicyScreen[] = screens.map((s) => ({
        key: String(s.displayId),
        rect: s.rect,
        isMain: s.isMain,
      }));
      const roles = computeRoles(policyScreens);

      let target: PolicyScreen;
      if (opts.screen !== undefined) {
        const s = policyScreens[opts.screen];
        if (!s) {
          throw new Error(`no display #${opts.screen} — see "seance screens"`);
        }
        target = s;
      } else {
        const existing = state.placement!.find((r) => r.repo === repoArg || r.repo === "*");
        target = resolveRole(existing?.role ?? "main", roles);
      }
      const role = [...roles.entries()].find(([, s]) => s.key === target.key)?.[0] ?? "main";

      const grid = gridArg.toLowerCase() === "auto" ? undefined : parseGrid(gridArg);
      if (grid && panes.length > grid.cols * grid.rows) {
        throw new Error(`${panes.length} ${repoArg} pane(s) won't fit ${grid.cols}x${grid.rows}`);
      }

      state.placement = [
        { repo: repoArg, role, ...(grid ? { grid } : {}) },
        ...state.placement!.filter((r) => r.repo !== repoArg),
      ];

      const g = grid ?? autoGrid(panes.length, target.rect.width, state.layout!.minPaneWidth);
      const rects = tile(target.rect, g);
      const plans = panes.map((p, i) => ({ ttyPath: p.ttyPath, rect: rects[i]!, label: p.repo }));
      await ghostty.activate();
      const { placed, stranded } = await ghostty.setWindowBounds(plans);
      await saveState(state);

      const screenIdx = screens.find((s) => String(s.displayId) === target.key)!.index;
      console.log(
        `placed ${placed.length}/${panes.length} ${repoArg} pane(s) as ${g.cols}x${g.rows} on display ${screenIdx} (${role})${grid ? " — pinned" : " — pin cleared"}`,
      );
      if (stranded.length > 0) {
        console.log(`stranded: ${stranded.map((t) => t.replace(/^\/dev\//, "")).join(", ")}`);
      }
    });

  // ── focus ────────────────────────────────────────────────────────
  program
    .command("focus <repo>")
    .description("Raise and focus the first live pane of a repo.")
    .action(async (repo: string) => {
      const { live } = await perceiveWorld();
      const target = live.find((p) => p.repo === repo);
      if (!target) {
        const repos = [...new Set(live.map((p) => p.repo))].sort().join(", ");
        throw new Error(`no live pane for "${repo}". Live repos: ${repos || "none"}`);
      }
      await ghostty.focusTty(target.ttyPath, target.repo);
      console.log(`focused ${repo} (${target.ttyPath.replace(/^\/dev\//, "")})`);
    });

  // ── json (Alfred Script Filter protocol) ─────────────────────────
  program
    .command("json <verb> [query]")
    .description('Machine-readable surface. "json query <q>" prints Alfred Script Filter items.')
    .action(async (verb: string, query: string | undefined) => {
      if (verb !== "query") throw new Error(`unknown json verb "${verb}" — only "query"`);
      const q = (query ?? "").trim().toLowerCase();
      const state = await loadState();
      ensurePolicy(state);
      const { live } = await perceiveWorld();
      const byRepo = new Map<string, number>();
      for (const p of live) byRepo.set(p.repo, (byRepo.get(p.repo) ?? 0) + 1);

      const items: PaletteItem[] = [
        {
          uid: "arrange",
          title: "Arrange",
          subtitle: `group ${live.length} pane(s) by repo across every display, skip minimized`,
          arg: "arrange",
          match: "arrange auto tile layout reflow",
        },
        {
          uid: "organize",
          title: "Organize",
          subtitle: `perceive → place → paint ${live.length} pane(s) across ${byRepo.size} repo(s)`,
          arg: "organize",
        },
      ];
      for (const [name, rules] of Object.entries(state.arrangements ?? {})) {
        const pins = rules.filter((r) => r.repo !== "*").map((r) => `${r.repo}→${r.role}`);
        items.push({
          uid: `arrange-${name}`,
          title: `Arrange ${name}`,
          subtitle: pins.length > 0 ? pins.join(", ") : "all repos on main",
          arg: `arrange ${name}`,
          match: `arrange ${name} ${rules.map((r) => r.repo).join(" ")}`,
        });
      }
      for (const [repo, n] of [...byRepo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const pair = state.identity?.[repo]?.pair;
        items.push({
          uid: `focus-${repo}`,
          title: `Focus ${repo}`,
          subtitle: `${n} pane(s)${pair ? ` — ${pair}` : ""}`,
          arg: `focus ${repo}`,
        });
      }
      for (const mode of ["dark", "light", "auto"] as const) {
        items.push({
          uid: `appearance-${mode}`,
          title: `Appearance ${mode}`,
          subtitle: "repaint all panes for this appearance",
          arg: `appearance ${mode}`,
        });
      }
      items.push({
        uid: "session-save",
        title: "Save session",
        subtitle: `snapshot ${live.length} pane(s) as "latest" (repo + cwd + claude resume uuid)`,
        arg: "session save latest",
      });
      for (const s of Object.values(state.sessions ?? {})) {
        const resumes = s.panes.filter((p) => p.resume).length;
        items.push({
          uid: `session-restore-${s.name}`,
          title: `Restore ${s.name}`,
          subtitle: `${s.panes.length} pane(s), ${resumes} claude — saved ${s.savedAt.slice(0, 16).replace("T", " ")}`,
          arg: `session restore ${s.name}`,
        });
      }
      items.push({
        uid: "cheatsheet",
        title: "Cheatsheet",
        subtitle: "how to use seance — commands, palette grammar, troubleshooting",
        arg: "cheatsheet --alfred",
        match: "cheatsheet help docs readme manual guide howto",
      });
      const filtered = q
        ? items.filter((i) => `${i.title} ${i.match ?? ""}`.toLowerCase().includes(q))
        : items;

      // Repo-token queries surface that repo's dormant conversations (titled,
      // from transcript heads) and a repo-scoped snapshot restore.
      const firstTok = q.split(/\s+/)[0] ?? "";
      if (firstTok) {
        const knownRepos = new Set<string>(byRepo.keys());
        for (const s of Object.values(state.sessions ?? {})) {
          for (const p of s.panes) knownRepos.add(p.repo);
        }
        const repo = [...knownRepos].sort().find((r) => r.toLowerCase().startsWith(firstTok));
        if (repo) {
          const snapName = ["latest", "auto"].find((n) =>
            state.sessions?.[n]?.panes.some((p) => p.repo === repo),
          );
          if (snapName) {
            filtered.push({
              uid: `restore-repo-${repo}`,
              title: `Restore ${repo} from ${snapName}`,
              subtitle: "respawn this repo's missing panes, then organize",
              arg: `session restore ${snapName} --repo ${repo}`,
            });
          }
          const cwd = await resolveRepoCwd(state, live, repo);
          if (cwd) {
            const liveK = live.filter(
              (p) => p.cwd === cwd && isClaudeCommand(p.command),
            ).length;
            for (const sess of await listRepoSessions(cwd, { skip: liveK, limit: 4 })) {
              filtered.push({
                uid: `resume-${sess.uuid}`,
                title: `Resume ${repo} — ${sess.title ?? sess.uuid.slice(0, 8)}`,
                subtitle: `${fmtAge(sess.mtimeMs)} ago · ${sess.uuid.slice(0, 8)}`,
                arg: `resume ${repo} ${sess.uuid}`,
              });
            }
          }
        }
      }

      // "arrange save <name>" grammar: freeze the current repo→display split.
      const am = /^arr(?:ange)?\s+save\s+(\S+)$/i.exec((query ?? "").trim());
      if (am) {
        filtered.unshift({
          uid: "arrange-save",
          title: `Save arrangement "${am[1]}"`,
          subtitle: "record where the windows are now — moves nothing",
          arg: `arrange --save ${am[1]}`,
        });
      }

      // "org <grid> [display]" grammar: one shape for every pane this run.
      const om = /^org(?:anize)?\s+(\d+\s*x\s*\d+|auto)(?:\s+(?:display\s*|d)?(\d+))?$/i.exec(
        (query ?? "").trim(),
      );
      if (om) {
        const gridStr = om[1]!.replace(/\s/g, "").toLowerCase();
        const screenPart = om[2] !== undefined ? ` --screen ${om[2]}` : "";
        filtered.unshift({
          uid: "organize-grid",
          title: `Organize ${gridStr}${om[2] !== undefined ? ` on display ${om[2]}` : ""}`,
          subtitle:
            gridStr === "auto"
              ? "clear every pinned grid, back to auto-grid"
              : "tile every pane into this shape for this run",
          arg: `organize ${gridStr}${screenPart}`,
        });
      }

      // "[verb] <repo> <grid> [display]" grammar: "zeus 3x3 1", "zeus 3x3
      // display 1", "zeus auto", and the same with a redundant "organize"/
      // "place" in front. Matches by repo prefix so "zeu 3x3 1" works too.
      const m =
        /^(?:(?:org(?:anize)?|place)\s+)?(\S+)\s+(\d+\s*x\s*\d+|auto)(?:\s+(?:display\s*|d)?(\d+))?$/i.exec(
          (query ?? "").trim(),
        );
      if (m) {
        const repo = [...byRepo.keys()].find((r) => r.startsWith(m[1]!.toLowerCase()));
        if (repo) {
          const gridStr = m[2]!.replace(/\s/g, "").toLowerCase();
          const screenPart = m[3] !== undefined ? ` --screen ${m[3]}` : "";
          filtered.unshift({
            uid: "place",
            title: `Place ${repo} ${gridStr}${m[3] !== undefined ? ` on display ${m[3]}` : ""}`,
            subtitle:
              gridStr === "auto"
                ? "clear the grid pin, back to auto-grid"
                : "pin grid + display as policy, tile now",
            arg: `place ${repo} ${gridStr}${screenPart}`,
          });
        }
      }
      console.log(JSON.stringify({ items: filtered }));
    });

  // ── watch (the daemon) ───────────────────────────────────────────
  program
    .command("watch")
    .description(
      "Watcher loop: auto-paint new panes with their repo identity; re-organize when the display set changes.",
    )
    .option("--install", "install + start as a launchd agent")
    .option("--uninstall", "stop + remove the launchd agent")
    .option("--interval <ms>", "poll interval", (v) => Number(v), 2000)
    .action(async (opts: { install?: boolean; uninstall?: boolean; interval: number }) => {
      if (opts.install) return installWatcher();
      if (opts.uninstall) return uninstallWatcher();
      await watchLoop(opts.interval);
    });

  // ── session (Phase 4: workspace recipes, no window refs) ─────────
  program
    .command("session <verb> [name]")
    .description(
      'Workspace snapshots. "session save [name]" captures (repo, cwd, claude-resume-uuid) per pane; "session restore [name] [--repo <r>]" respawns what\'s missing and organizes; "session list".',
    )
    .option("--repo <repo>", "restore only this repo's panes")
    .action(async (verb: string, nameArg: string | undefined, opts: { repo?: string }) => {
      const state = await loadState();
      ensurePolicy(state);
      const name = nameArg ?? "latest";

      if (verb === "list") {
        const entries = Object.values(state.sessions ?? {});
        if (entries.length === 0) {
          console.log("no saved sessions");
          return;
        }
        for (const s of entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))) {
          const resumes = s.panes.filter((p) => p.resume).length;
          console.log(
            `${s.name.padEnd(16)} ${String(s.panes.length).padStart(2)} pane(s), ${resumes} claude  saved ${s.savedAt}`,
          );
        }
        return;
      }

      if (verb === "save") {
        const { live } = await perceiveWorld();
        if (live.length === 0) throw new Error("no live panes to save");
        const snapshot = await buildSnapshot(name, live);
        state.sessions = { ...(state.sessions ?? {}), [name]: snapshot };
        await saveState(state);
        const resumes = snapshot.panes.filter((p) => p.resume).length;
        console.log(
          `saved session "${name}": ${snapshot.panes.length} pane(s), ${resumes} resumable claude session(s)`,
        );
        return;
      }

      if (verb === "restore") {
        const wanted = nameArg ?? (state.sessions?.["latest"] ? "latest" : "auto");
        const snapshot = state.sessions?.[wanted];
        if (!snapshot) {
          const known = Object.keys(state.sessions ?? {}).join(", ") || "none";
          throw new Error(`no session "${wanted}". Saved: ${known}`);
        }
        const wantedPanes = opts.repo
          ? snapshot.panes.filter((p) => p.repo === opts.repo)
          : snapshot.panes;
        if (wantedPanes.length === 0) {
          throw new Error(`session "${wanted}" has no ${opts.repo} panes`);
        }
        const { live } = await perceiveWorld();
        const liveCmds = live.map((p) => p.command).join("\n");
        const liveClaudeCount = new Map<string, number>();
        const liveShellCount = new Map<string, number>();
        for (const p of live) {
          const m = isClaudeCommand(p.command) ? liveClaudeCount : liveShellCount;
          m.set(p.cwd, (m.get(p.cwd) ?? 0) + 1);
        }

        const spawns: Array<{ cwd: string; command?: string; label: string }> = [];
        const skipped: string[] = [];
        const wantClaude = new Map<string, SessionPane[]>();
        const wantShell = new Map<string, number>();
        for (const p of wantedPanes) {
          if (p.resume) {
            const arr = wantClaude.get(p.cwd) ?? [];
            arr.push(p);
            wantClaude.set(p.cwd, arr);
          } else {
            wantShell.set(p.cwd, (wantShell.get(p.cwd) ?? 0) + 1);
          }
        }
        for (const [cwd, panes] of wantClaude) {
          let budget = panes.length - (liveClaudeCount.get(cwd) ?? 0);
          for (const p of panes) {
            if (budget <= 0) {
              skipped.push(`${p.repo} (${p.resume!.slice(0, 8)}…) — enough claude panes live in ${cwd}`);
              continue;
            }
            if (liveCmds.includes(p.resume!)) {
              skipped.push(`${p.repo} (${p.resume!.slice(0, 8)}…) — already running`);
              continue;
            }
            spawns.push({ cwd, command: `claude --resume ${p.resume}`, label: p.repo });
            budget--;
          }
        }
        for (const [cwd, want] of wantShell) {
          const missing = want - (liveShellCount.get(cwd) ?? 0);
          for (let i = 0; i < missing; i++) {
            spawns.push({ cwd, label: basename(cwd) });
          }
        }

        if (spawns.length === 0) {
          console.log(
            `nothing to restore — all ${wantedPanes.length}${opts.repo ? ` ${opts.repo}` : ""} pane(s) of "${wanted}" are live`,
          );
          for (const s of skipped) console.log(`  = ${s}`);
          return;
        }
        for (const s of spawns) {
          await ghostty.spawnWindow(s.cwd, s.command);
          console.log(`spawned ${s.label}${s.command ? ` — ${s.command}` : ""}`);
        }
        for (const s of skipped) console.log(`  = ${s}`);
        console.log(`waiting for ${spawns.length} window(s) to boot, then organizing…`);
        await new Promise((r) => setTimeout(r, 4000));
        await runOrganize();
        return;
      }

      throw new Error(`unknown session verb "${verb}" — save | restore | list`);
    });

  // ── resume (single dormant conversation, CCResume-style) ─────────
  program
    .command("resume <repo> [uuid]")
    .description(
      "Respawn one dormant claude conversation for a repo. Without a uuid, the most recent one not presumed live.",
    )
    .action(async (repo: string, uuid: string | undefined) => {
      const state = await loadState();
      ensurePolicy(state);
      const { live } = await perceiveWorld();
      const cwd = await resolveRepoCwd(state, live, repo);
      if (!cwd) {
        throw new Error(
          `can't resolve a directory for "${repo}" — no live pane, no saved session, no ~/GitHub/${repo}`,
        );
      }
      let target = uuid;
      if (!target) {
        const liveK = live.filter((p) => p.cwd === cwd && isClaudeCommand(p.command)).length;
        const dormant = await listRepoSessions(cwd, { skip: liveK, limit: 1 });
        target = dormant[0]?.uuid;
        if (!target) throw new Error(`no dormant claude sessions found for ${repo} (${cwd})`);
      }
      await ghostty.spawnWindow(cwd, `claude --resume ${target}`);
      console.log(`resuming ${repo} ${target.slice(0, 8)}… — organizing once it boots`);
      await new Promise((r) => setTimeout(r, 4000));
      await runOrganize();
    });

  // ── alfred ───────────────────────────────────────────────────────
  program
    .command("alfred <verb>")
    .description('Alfred 5 workflow. "alfred install" copies it into your workflows directory.')
    .action(async (verb: string) => {
      if (verb !== "install") throw new Error(`unknown alfred verb "${verb}" — only "install"`);
      const src = join(packageRoot(), "alfred", "seance-workflow");
      await fs.access(src).catch(() => {
        throw new Error(`workflow source missing at ${src}`);
      });
      const workflows = join(
        homedir(),
        "Library",
        "Application Support",
        "Alfred",
        "Alfred.alfredpreferences",
        "workflows",
      );
      await fs.access(workflows).catch(() => {
        throw new Error(
          `Alfred workflows directory not found at ${workflows} — is Alfred 5 installed (or using a sync folder)?`,
        );
      });
      const dest = join(workflows, "com.seance.palette");
      await fs.cp(src, dest, { recursive: true, force: true });
      // Alfred runs scripts under a sterile PATH; bake in the dir of the node
      // that's running us (covers nvm/homebrew/system installs of `seance`).
      const plistPath = join(dest, "info.plist");
      const plist = await fs.readFile(plistPath, "utf8");
      const path = [
        dirname(process.execPath),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ]
        .filter((p, i, a) => a.indexOf(p) === i)
        .join(":");
      await fs.writeFile(plistPath, plist.replace(/export PATH="[^"]*"/g, `export PATH="${path}"`), "utf8");
      await ghostty
        .osascript(`tell application id "com.runningwithcrayons.Alfred" to reload workflow "com.seance.palette"`)
        .catch(() => undefined);
      console.log(`installed → ${dest}\nType "s" in Alfred to summon seance.`);
    });

  // ── meta ─────────────────────────────────────────────────────────
  program
    .command("cheatsheet")
    .description("Print the how-to-use cheatsheet as Markdown (rendered by the Alfred Text View).")
    .option("--alfred", "open it in Alfred's Text View instead of printing it")
    .action(async (opts: { alfred?: boolean }) => {
      if (!opts.alfred) {
        process.stdout.write(CHEATSHEET);
        return;
      }
      await ghostty.osascript(
        `tell application id "com.runningwithcrayons.Alfred" to run trigger "cheatsheet" in workflow "com.seance.palette"`,
      );
    });

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

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

interface OrganizeOverride {
  grid: GridSpec;
  /** Display index; absent = every display. */
  screen?: number;
  /** Record the grid on the affected repos' placement rules instead of this run only. */
  pin?: boolean;
}

interface PaletteItem {
  uid: string;
  title: string;
  subtitle: string;
  arg: string;
  match?: string;
}

interface WorldPane {
  ttyPath: string;
  repo: string;
  cwd: string;
  command: string;
}

async function perceiveWorld(): Promise<{ live: WorldPane[]; home: string }> {
  const home = homedir();
  const panes = await ghostty.perceivePanes();
  return {
    home,
    live: panes.map((p) => ({
      ttyPath: p.ttyPath,
      cwd: p.cwd ?? home,
      repo: repoOf(p.cwd ?? home, home),
      command: p.command,
    })),
  };
}

async function resolveRepoCwd(
  state: SeanceState,
  live: WorldPane[],
  repo: string,
): Promise<string | undefined> {
  const livePane = live.find((p) => p.repo === repo);
  if (livePane) return livePane.cwd;
  const snapshots = Object.values(state.sessions ?? {}).sort((a, b) =>
    b.savedAt.localeCompare(a.savedAt),
  );
  for (const s of snapshots) {
    const p = s.panes.find((x) => x.repo === repo);
    if (p) return p.cwd;
  }
  const guess = join(homedir(), "GitHub", repo);
  try {
    await fs.access(guess);
    return guess;
  } catch {
    return undefined;
  }
}

function fmtAge(mtimeMs: number): string {
  const s = Math.max(0, (Date.now() - mtimeMs) / 1000);
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

async function buildSnapshot(name: string, live: WorldPane[]): Promise<SessionSnapshot> {
  const claudeByCwd = new Map<string, WorldPane[]>();
  for (const p of live) {
    if (isClaudeCommand(p.command)) {
      const arr = claudeByCwd.get(p.cwd) ?? [];
      arr.push(p);
      claudeByCwd.set(p.cwd, arr);
    }
  }
  const uuidByTty = new Map<string, string>();
  for (const [cwd, panes] of claudeByCwd) {
    const uuids = await activeSessionUuids(cwd, panes.length);
    panes.forEach((p, i) => {
      const u = uuids[i];
      if (u) uuidByTty.set(p.ttyPath, u);
    });
  }
  return {
    name,
    savedAt: new Date().toISOString(),
    panes: live.map((p) => ({
      repo: p.repo,
      cwd: p.cwd,
      ...(uuidByTty.get(p.ttyPath) ? { resume: uuidByTty.get(p.ttyPath)! } : {}),
    })),
  };
}

function themeRing(state: SeanceState): string[] {
  return listThemePairs(state)
    .map((t) => t.name)
    .filter((n) => n !== "Catppuccin");
}

function bgFor(entry: IdentityEntry, appearance: Appearance): string | undefined {
  if (entry.bg == null) return undefined;
  if (typeof entry.bg === "string") return entry.bg;
  return appearance === "dark" ? entry.bg.dark : entry.bg.light;
}

/**
 * The single choke point every palette passes through before it reaches a TTY.
 * Folds the background override into the palette so contrast is measured
 * against the colour actually painted, then lifts anything unreadable.
 */
function guardPalette(
  state: SeanceState,
  palette: ThemePalette,
  background?: string,
): ThemePalette {
  return enforceContrast(palette, {
    ...(background ? { background } : {}),
    minRatio: state.minContrast ?? DEFAULT_MIN_CONTRAST,
  });
}

async function paintPane(
  state: SeanceState,
  pane: WorldPane,
  appearance: Appearance,
  paletteCache: Map<string, ThemePalette>,
): Promise<boolean> {
  const entry = state.identity?.[pane.repo];
  if (!entry) return false;
  const pair = getTheme(state, entry.pair);
  if (!pair) return false;
  const themeName = resolveTheme(pair, appearance);
  const bg = bgFor(entry, appearance);
  const key = `${themeName}|${bg ?? ""}`;
  let palette = paletteCache.get(key);
  if (!palette) {
    try {
      palette = guardPalette(state, await parseThemeFile(themeFilePath(themeName)), bg);
    } catch {
      return false;
    }
    paletteCache.set(key, palette);
  }
  try {
    await ghostty.applyPaletteToTty(pane.ttyPath, palette);
    return true;
  } catch {
    return false;
  }
}

async function runOrganize(override?: OrganizeOverride): Promise<void> {
  const state = await loadState();
  ensurePolicy(state);
  const { live, home } = await perceiveWorld();
  if (live.length === 0) {
    console.log("no live Ghostty panes to organize");
    return;
  }

  const repos = [...new Set(live.map((p) => p.repo))];
  const { identity, changes } = assignThemes(repos, state.identity ?? {}, themeRing(state));
  state.identity = identity;

  const screens = await ghostty.listScreens();
  const policyScreens: PolicyScreen[] = screens.map((s) => ({
    key: String(s.displayId),
    rect: s.rect,
    isMain: s.isMain,
  }));
  const roles = computeRoles(policyScreens);
  const roleOf = new Map<string, string>();
  for (const [role, s] of roles) roleOf.set(s.key, role);

  let forcedKey: string | undefined;
  if (override?.screen !== undefined) {
    const s = policyScreens[override.screen];
    if (!s) throw new Error(`no display #${override.screen} — see "seance screens"`);
    forcedKey = s.key;
  }

  const livePanes: LivePane[] = live.map((p) => ({
    ttyPath: p.ttyPath,
    cwd: p.cwd,
    command: p.command,
  }));
  const byScreen = placePanes(livePanes, state.placement!, roles, home);
  const repoByTty = new Map(live.map((p) => [p.ttyPath, p.repo]));

  const plans: Array<{ ttyPath: string; rect: Rect; label?: string }> = [];
  const summary: string[] = [];
  const pinTargets = new Map<string, string>();
  for (const [key, panes] of byScreen) {
    const screen = policyScreens.find((s) => s.key === key)!;
    const reposOn = new Set(panes.map((p) => repoByTty.get(p.ttyPath)!));
    const role = roleOf.get(key) ?? key;
    const forced = override && (forcedKey === undefined || forcedKey === key) ? override.grid : undefined;
    if (forced && panes.length > forced.cols * forced.rows) {
      throw new Error(
        `${panes.length} pane(s) on ${role} won't fit ${forced.cols}x${forced.rows} — need at least ${panes.length} cells`,
      );
    }
    if (forced && override?.pin) for (const r of reposOn) pinTargets.set(r, role);
    const pinned = state.placement!.find((r) => r.grid && reposOn.has(r.repo))?.grid;
    const grid =
      forced ??
      (pinned && panes.length <= pinned.cols * pinned.rows
        ? pinned
        : autoGrid(panes.length, screen.rect.width, state.layout!.minPaneWidth));
    const rects = tile(screen.rect, grid);
    panes.forEach((p, i) => {
      plans.push({ ttyPath: p.ttyPath, rect: rects[i]!, label: repoByTty.get(p.ttyPath)! });
    });
    const repoCounts = new Map<string, number>();
    for (const p of panes) {
      const r = repoByTty.get(p.ttyPath)!;
      repoCounts.set(r, (repoCounts.get(r) ?? 0) + 1);
    }
    const desc = [...repoCounts.entries()].map(([r, n]) => (n > 1 ? `${r}×${n}` : r)).join(", ");
    summary.push(`  ${role.padEnd(15)} ${`${grid.cols}x${grid.rows}`.padEnd(5)} ${desc}`);
  }

  for (const [repo, role] of pinTargets) {
    const i = state.placement!.findIndex((r) => r.repo === repo);
    if (i >= 0) state.placement![i] = { ...state.placement![i]!, grid: override!.grid };
    else state.placement!.unshift({ repo, role: role as PlacementRule["role"], grid: override!.grid });
  }

  await ghostty.activate();
  const { placed, stranded } = await ghostty.setWindowBounds(plans);

  const { painted, appearance } = await paintAll(state, live);

  await saveState(state);

  for (const c of changes) console.log(`theme ${c.reason === "new" ? "assigned" : "reassigned"}: ${c.repo} → ${c.pair}`);
  console.log(`organized ${placed.length}/${live.length} pane(s), painted ${painted} (${appearance})`);
  for (const line of summary) console.log(line);
  if (pinTargets.size > 0) {
    console.log(`grid pinned ${override!.grid.cols}x${override!.grid.rows}: ${[...pinTargets.keys()].join(", ")}`);
  }
  await reportStranded(stranded, repoByTty);
}

async function paintAll(
  state: SeanceState,
  live: WorldPane[],
): Promise<{ painted: number; appearance: Appearance }> {
  const appearance = state.appearance ?? (await ghostty.currentAppearance());
  const paletteCache = new Map<string, ThemePalette>();
  let painted = 0;
  for (const p of live) {
    if (await paintPane(state, p, appearance, paletteCache)) painted++;
  }
  return { painted, appearance };
}

async function reportStranded(
  stranded: string[],
  repoByTty: Map<string, string>,
): Promise<void> {
  if (stranded.length === 0) return;
  const cmds = await ghostty.foregroundCommandsByTty(stranded);
  console.log("stranded on another Space (bring over via Mission Control, then re-run):");
  for (const t of stranded) {
    console.log(`  ${t.replace(/^\/dev\//, "")}  ${repoByTty.get(t) ?? "?"}  ${cmds.get(t) ?? ""}`);
  }
}

interface ArrangeOptions {
  /** Saved arrangement to apply instead of `state.placement`. */
  name?: string;
  /** Record the current repo→display split under this name; moves nothing. */
  save?: string;
}

/**
 * `arrange` differs from `organize` in what it decides rather than how it acts:
 * it picks the display split and the shape itself, and it only tiles panes that
 * are actually on screen.
 *
 * Note the asymmetry between `live` and `active`: identity assignment and
 * painting run over every live pane (an OSC write reaches a minimized window's
 * TTY fine, so it is already the right colour when restored), while only
 * `active` panes get a rect.
 */
async function runArrange(state: SeanceState, opts: ArrangeOptions): Promise<void> {
  const rules = opts.name !== undefined ? state.arrangements![opts.name]! : state.placement!;
  const budget: PaneBudget = {
    minPaneWidth: state.layout!.minPaneWidth,
    minPaneHeight: state.layout!.minPaneHeight ?? 256,
  };

  const { live } = await perceiveWorld();
  if (live.length === 0) {
    console.log("no live Ghostty panes to arrange");
    return;
  }
  const repoByTty = new Map(live.map((p) => [p.ttyPath, p.repo]));

  const repos = [...new Set(live.map((p) => p.repo))];
  const { identity, changes } = assignThemes(repos, state.identity ?? {}, themeRing(state));
  state.identity = identity;

  const screens = await ghostty.listScreens();
  const policyScreens: PolicyScreen[] = screens.map((s) => ({
    key: String(s.displayId),
    rect: s.rect,
    isMain: s.isMain,
  }));
  const roles = computeRoles(policyScreens);
  const roleOf = new Map<string, Role>();
  for (const [role, s] of roles) roleOf.set(s.key, role);

  const { active, minimized } = await splitByVisibility(live);

  if (opts.save !== undefined) {
    await saveArrangement(state, opts.save, active, policyScreens, roleOf);
    return;
  }

  const families = orderFamilies(active, rules);
  const { byScreen, autoPlacement, notes } = assignFamilies(
    families.map((f) => ({ repo: f.repo, count: f.panes.length })),
    rules,
    state.autoPlacement ?? {},
    roles,
    budget,
  );
  state.autoPlacement = autoPlacement;

  const byRepo = new Map(families.map((f) => [f.repo, f]));
  const plans: Array<{ ttyPath: string; rect: Rect; label?: string }> = [];
  const summary: string[] = [];
  for (const [key, { role, repos: reposOn }] of byScreen) {
    const screen = policyScreens.find((s) => s.key === key)!;
    const requests: FamilyRequest[] = reposOn.map((repo) => {
      const pin = rules.find((r) => r.repo === repo)?.grid;
      return { repo, count: byRepo.get(repo)!.panes.length, ...(pin ? { grid: pin } : {}) };
    });
    const placements = layoutScreen(screen.rect, requests, budget);
    let panes = 0;
    for (const placement of placements) {
      const family = byRepo.get(placement.repo)!;
      placement.cells.forEach((rect, i) => {
        plans.push({ ttyPath: family.panes[i]!.ttyPath, rect, label: placement.repo });
      });
      panes += placement.cells.length;
    }
    const shapes = placements
      .map((p) => `${p.repo} ${p.grid.cols}x${p.grid.rows}`)
      .join(", ");
    summary.push(`  ${role.padEnd(15)} ${String(panes).padStart(2)} pane(s)  ${shapes}`);
  }

  await ghostty.activate();
  const { placed, stranded } = await ghostty.setWindowBounds(plans);

  const { painted, appearance } = await paintAll(state, live);
  await saveState(state);

  for (const c of changes) {
    console.log(`theme ${c.reason === "new" ? "assigned" : "reassigned"}: ${c.repo} → ${c.pair}`);
  }
  console.log(
    `arranged ${placed.length}/${active.length} pane(s), painted ${painted} (${appearance})${opts.name !== undefined ? ` — arrangement "${opts.name}"` : ""}`,
  );
  for (const line of summary) console.log(line);
  if (minimized.length > 0) {
    const repoCounts = new Map<string, number>();
    for (const p of minimized) repoCounts.set(p.repo, (repoCounts.get(p.repo) ?? 0) + 1);
    const desc = [...repoCounts.entries()].map(([r, n]) => (n > 1 ? `${r}×${n}` : r)).join(", ");
    console.log(`minimized (not tiled): ${desc}`);
  }
  for (const note of notes) console.log(formatNote(note));
  await reportStranded(stranded, repoByTty);
}

/**
 * Minimized panes must be excluded before the actuator runs, not after:
 * setWindowBounds focuses each target to migrate it onto the current Space,
 * which would undo the user's ⌘M.
 *
 * The AX read that resolves which pane is which costs a sentinel round trip and
 * a title flash, so it is gated on a cheap process-wide check that answers "is
 * anything minimized at all" — the answer is normally no.
 */
async function splitByVisibility(
  live: WorldPane[],
): Promise<{ active: WorldPane[]; minimized: WorldPane[] }> {
  const windows = await ghostty.listAllWindows().catch(() => []);
  if (!windows.some((w) => w.minimized)) return { active: live, minimized: [] };

  const states = await ghostty.windowStatesByTty(
    live.map((p) => ({ ttyPath: p.ttyPath, label: p.repo })),
  );
  const active: WorldPane[] = [];
  const minimized: WorldPane[] = [];
  for (const pane of live) {
    // An unresolved sentinel means the window lost the title race or sits on
    // another Space; setWindowBounds retries and migrates, so it resolves
    // strictly better than this single-shot read. Only an explicit yes excludes.
    if (states.get(pane.ttyPath)?.minimized === true) minimized.push(pane);
    else active.push(pane);
  }
  return { active, minimized };
}

interface PaneFamily {
  repo: string;
  panes: WorldPane[];
}

function orderFamilies(panes: WorldPane[], rules: PlacementRule[]): PaneFamily[] {
  const ruleIndex = (repo: string): number => {
    const i = rules.findIndex((r) => r.repo === repo);
    return i === -1 ? rules.length : i;
  };
  const byRepo = new Map<string, WorldPane[]>();
  for (const pane of panes) {
    const list = byRepo.get(pane.repo);
    if (list) list.push(pane);
    else byRepo.set(pane.repo, [pane]);
  }
  return [...byRepo.entries()]
    .map(([repo, list]) => ({
      repo,
      panes: [...list].sort((a, b) => (a.ttyPath < b.ttyPath ? -1 : a.ttyPath > b.ttyPath ? 1 : 0)),
    }))
    .sort(
      (a, b) =>
        ruleIndex(a.repo) - ruleIndex(b.repo) ||
        (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0),
    );
}

async function saveArrangement(
  state: SeanceState,
  name: string,
  active: WorldPane[],
  screens: PolicyScreen[],
  roleOf: Map<string, Role>,
): Promise<void> {
  const rects = await ghostty.currentRectsByTty(
    active.map((p) => ({ ttyPath: p.ttyPath, label: p.repo })),
  );
  const roleByRepo = new Map<string, Role>();
  for (const pane of active) {
    const rect = rects.get(pane.ttyPath);
    if (!rect || roleByRepo.has(pane.repo)) continue;
    const role = roleOf.get(screenKeyForRect(rect, screens));
    if (role) roleByRepo.set(pane.repo, role);
  }
  const rules: PlacementRule[] = [
    ...[...roleByRepo.entries()].map(([repo, role]) => ({ repo, role })),
    { repo: "*", role: "main" as Role },
  ];
  state.arrangements = { ...(state.arrangements ?? {}), [name]: rules };
  await saveState(state);
  const desc = [...roleByRepo.entries()].map(([repo, role]) => `${repo}→${role}`).join(", ");
  console.log(`saved arrangement "${name}": ${desc || "no resolvable panes"}`);
}

function formatNote(note: PlacementNote): string {
  if (note.kind === "over-capacity") {
    return `  ${note.role}: ${note.panes} panes on a ${note.capacity}-pane display — panes are below the readable floor`;
  }
  const pinned = note.pinnedElsewhere;
  if (pinned.length === 0) return `  ${note.role}: empty`;
  return `  ${note.role}: empty — ${pinned.join(", ")} pinned elsewhere ("seance place <repo> auto" lets one balance)`;
}

const WATCHER_PLIST = "com.seance.watcher.plist";

async function watchLoop(intervalMs: number): Promise<void> {
  const paintedSig = new Map<string, string>();
  const paletteCache = new Map<string, ThemePalette>();
  let screensSig = "";
  let tick = 0;
  for (;;) {
    try {
      const state = await loadState();
      ensurePolicy(state);
      const { live } = await perceiveWorld();
      const repos = [...new Set(live.map((p) => p.repo))];
      const { identity, changes } = assignThemes(repos, state.identity ?? {}, themeRing(state));
      if (changes.length > 0) {
        state.identity = identity;
        await saveState(state);
        for (const c of changes) console.log(`watch: theme ${c.repo} → ${c.pair}`);
      }
      state.identity = identity;

      const appearance = state.appearance ?? (await ghostty.currentAppearance());

      // Claude Code rewrites the whole of ~/.claude/settings.json from its own
      // in-memory state whenever a setting changes via /config, so a session
      // that booted under the old theme silently reverts this key for every
      // session started afterwards. Re-assert it every tick rather than
      // writing once: a read of a few KB is nothing next to the osascript and
      // lsof work this loop already does, and it self-heals within one pass.
      // Don't gate this on `tick % n` — a tick is one iteration of a loop whose
      // body can take many seconds, not a wall-clock interval.
      const synced = await syncClaudeCodeTheme(appearance);
      if (synced) console.log(`watch: Claude Code theme reverted → restored ${synced}`);

      for (const p of live) {
        const entry = identity[p.repo];
        if (!entry) continue;
        const sig = `${entry.pair}|${JSON.stringify(entry.bg ?? null)}|${appearance}`;
        if (paintedSig.get(p.ttyPath) === sig) continue;
        if (await paintPane(state, p, appearance, paletteCache)) {
          paintedSig.set(p.ttyPath, sig);
          console.log(`watch: painted ${p.ttyPath.replace(/^\/dev\//, "")} (${p.repo} → ${entry.pair})`);
        }
      }
      const liveTtys = new Set(live.map((p) => p.ttyPath));
      for (const known of [...paintedSig.keys()]) {
        if (!liveTtys.has(known)) paintedSig.delete(known);
      }

      // Rolling auto-snapshot every ~5min, so restore works even if the user
      // never typed `session save` — the crash/reboot recipe is always ≤5min old.
      if (tick % 150 === 0 && live.length > 0) {
        const snapshot = await buildSnapshot("auto", live);
        state.sessions = { ...(state.sessions ?? {}), auto: snapshot };
        await saveState(state);
      }

      if (tick % 5 === 0) {
        const screens = await ghostty.listScreens();
        const sig = screens
          .map((s) => `${s.displayId}:${s.rect.x},${s.rect.y},${s.rect.width},${s.rect.height}`)
          .sort()
          .join("|");
        if (screensSig && sig !== screensSig) {
          console.log("watch: display set changed — reorganizing in 3s");
          await new Promise((r) => setTimeout(r, 3000));
          await runOrganize();
          paintedSig.clear();
        }
        screensSig = sig;
      }
    } catch (err) {
      console.error(`watch: ${(err as Error).message}`);
    }
    tick++;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function installWatcher(): Promise<void> {
  const cliJs = join(packageRoot(), "dist", "cli.js");
  await fs.access(cliJs).catch(() => {
    throw new Error(`${cliJs} missing — run "npm run build" first`);
  });
  const logPath = join(homedir(), ".config", "seance", "watcher.log");
  await fs.mkdir(dirname(logPath), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.seance.watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${cliJs}</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;
  const plistPath = join(homedir(), "Library", "LaunchAgents", WATCHER_PLIST);
  await fs.mkdir(dirname(plistPath), { recursive: true });
  await fs.writeFile(plistPath, plist, "utf8");
  await ghostty.launchctl(["unload", plistPath]).catch(() => undefined);
  await ghostty.launchctl(["load", plistPath]);
  console.log(`watcher installed and running (${plistPath})\nlogs: ${logPath}`);
}

async function uninstallWatcher(): Promise<void> {
  const plistPath = join(homedir(), "Library", "LaunchAgents", WATCHER_PLIST);
  await ghostty.launchctl(["unload", plistPath]).catch(() => undefined);
  await fs.rm(plistPath, { force: true });
  console.log("watcher stopped and removed");
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
  const appearance = state.appearance ?? (await ghostty.currentAppearance());
  const themeName = resolveTheme(pair, appearance);
  const raw = await parseThemeFile(themeFilePath(themeName)).catch((err: Error) => {
    throw new Error(`failed to load Ghostty theme "${themeName}": ${err.message}`);
  });
  const windows = g.windows.filter((w) => w.ttyPath);
  if (windows.length === 0) {
    throw new Error(`no TTY-tagged windows in "${name}"`);
  }
  const bg =
    g.background == null
      ? undefined
      : typeof g.background === "string"
        ? g.background
        : appearance === "dark"
          ? g.background.dark
          : g.background.light;
  const palette = guardPalette(state, raw, bg);
  const repaired = contrastRepairs(raw, {
    ...(bg ? { background: bg } : {}),
    minRatio: state.minContrast ?? DEFAULT_MIN_CONTRAST,
  }).length;
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
    `applied "${g.themeName}" → ${themeName} (${appearance})${bg ? ` + bg ${bg}` : ""} to ${applied}/${windows.length} window(s) in "${name}"${repaired > 0 ? ` · ${repaired} slot(s) contrast-repaired` : ""}`,
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
): Array<{ ttyPath: string; rect: Rect; label?: string }> {
  const plans: Array<{ ttyPath: string; rect: Rect; label?: string }> = [];
  for (const w of windows) {
    if (!w.ttyPath || w.slot === undefined) continue;
    const cellIdx = w.slot - 1;
    const r = rects[cellIdx];
    if (!r) continue;
    plans.push({ ttyPath: w.ttyPath, rect: r, ...(w.cwd ? { label: basename(w.cwd) } : {}) });
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
