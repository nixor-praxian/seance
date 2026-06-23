import { execa } from "execa";
import { promises as fs } from "node:fs";
import type { Rect, WindowRef } from "./types.js";
import { cocoaFramesToAx, type CocoaRect } from "./layouts.js";
import type { ThemePalette } from "./themes.js";
import type { Appearance } from "./themes.js";

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const GHOSTTY_APP_NAME = "Ghostty";

/**
 * Run an AppleScript snippet and return stdout.
 * Throws if osascript exits non-zero.
 */
export async function osascript(
  script: string,
  opts: { language?: "AppleScript" | "JavaScript" } = {},
): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("seance: Ghostty bridge requires macOS (osascript not available)");
  }
  const args = opts.language === "JavaScript" ? ["-l", "JavaScript", "-e", script] : ["-e", script];
  const { stdout } = await execa("osascript", args);
  return stdout.trim();
}

/**
 * True if Ghostty is currently running.
 */
export async function isRunning(): Promise<boolean> {
  const out = await osascript(
    `tell application "System Events" to (name of processes) contains "${GHOSTTY_APP_NAME}"`,
  );
  return out === "true";
}

/**
 * Bring Ghostty to the foreground (launching it if needed).
 */
export async function activate(): Promise<void> {
  await osascript(`tell application id "${GHOSTTY_BUNDLE_ID}" to activate`);
}

/**
 * List all Ghostty top-level windows in front-to-back order.
 *
 * Tries Ghostty's native AppleScript dictionary first (stable `id` property
 * added in 1.3). Falls back to System Events enumeration by index + title.
 */
export async function listWindows(): Promise<WindowRef[]> {
  // Native scripting dictionary path
  try {
    const script = `
      tell application id "${GHOSTTY_BUNDLE_ID}"
        set out to ""
        repeat with w in windows
          set out to out & (id of w as string) & "\\t" & (name of w as string) & "\\n"
        end repeat
        return out
      end tell
    `;
    const raw = await osascript(script);
    const rows = parseTsv(raw);
    if (rows.length > 0) {
      return rows.map(([id, title]) => ({
        windowId: id ?? "",
        ...(title ? { title } : {}),
      }));
    }
  } catch {
    // fall through to System Events
  }

  const script = `
    tell application "System Events"
      tell process "${GHOSTTY_APP_NAME}"
        set out to ""
        set i to 0
        repeat with w in windows
          set i to i + 1
          try
            set t to name of w
          on error
            set t to ""
          end try
          set out to out & i & "\\t" & t & "\\n"
        end repeat
        return out
      end tell
    end tell
  `;
  const raw = await osascript(script);
  return parseTsv(raw).map(([idx, title]) => ({
    windowId: `axindex:${idx}`,
    ...(title ? { title } : {}),
  }));
}

/**
 * Return the window currently in focus, or null if Ghostty is not frontmost.
 */
export async function focusedWindow(): Promise<WindowRef | null> {
  try {
    const script = `
      tell application id "${GHOSTTY_BUNDLE_ID}"
        if (count of windows) is 0 then return ""
        set w to front window
        return (id of w as string) & "\\t" & (name of w as string)
      end tell
    `;
    const raw = await osascript(script);
    if (!raw) return null;
    const [id, title] = raw.split("\t");
    if (!id) return null;
    return {
      windowId: id,
      ...(title ? { title } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Return the controlling TTY of the current process (e.g. /dev/ttys002),
 * or undefined if not attached to a terminal.
 *
 * We shell out to `tty` with stdin inherited so the child sees the same
 * controlling terminal as seance itself.
 */
export async function currentTty(): Promise<string | undefined> {
  try {
    const { stdout } = await execa("tty", [], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
      reject: false,
    });
    const t = stdout.trim();
    return t.startsWith("/dev/") ? t : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Move + resize a set of Ghostty windows.
 *
 * Targeting strategy: write a unique OSC 2 title sentinel to each window's TTY,
 * then look the window up in System Events by name. This sidesteps the fact
 * that Ghostty's `id` (a tab-group id) can't be addressed via System Events,
 * and that Ghostty's window-list order doesn't match AX z-order.
 *
 * Per-window TTY is required (captured at `group add` time).
 */
export async function setWindowBounds(
  plans: Array<{ ttyPath: string; rect: Rect }>,
): Promise<void> {
  if (plans.length === 0) return;

  const stamp = Date.now().toString(36);
  const stamped = plans.map((p, i) => ({
    ttyPath: p.ttyPath,
    sentinel: `⎈seance:${stamp}:${i}`,
    rect: p.rect,
  }));

  await Promise.all(
    stamped.map((s) => fs.writeFile(s.ttyPath, `\x1b]2;${s.sentinel}\x1b\\`, { flag: "a" })),
  );

  // Give Ghostty time to process OSC sequences and propagate titles to AX.
  await new Promise((r) => setTimeout(r, 200));

  // Migrate each target window to the current macOS Space via Ghostty's native
  // `focus` action. Without this, AX position-set on a window that's on a
  // different Space silently strands it: the on-screen position appears to
  // change, but the next minimize+restore lands the window off-current-Space
  // and it looks like it "disappeared". Focusing first guarantees AX is acting
  // on a window that's actually on the current Space.
  const focusScript = `
    tell application id "${GHOSTTY_BUNDLE_ID}"
      ${stamped
        .map(
          (s) =>
            `try\n` +
            `  focus (focused terminal of selected tab of (first window whose name ends with "${s.sentinel.replace(/"/g, '\\"')}"))\n` +
            `end try`,
        )
        .join("\n      ")}
    end tell
  `;
  await osascript(focusScript);
  await new Promise((r) => setTimeout(r, 150));

  const captures = stamped
    .map(
      (s, i) =>
        `set w${i} to first window whose name ends with "${s.sentinel.replace(/"/g, '\\"')}"`,
    )
    .join("\n        ");
  const applies = stamped
    .map(
      (s, i) =>
        `set position of w${i} to {${s.rect.x}, ${s.rect.y}}\n        ` +
        `set size of w${i} to {${s.rect.width}, ${s.rect.height}}`,
    )
    .join("\n        ");

  const script = `
    tell application "System Events"
      tell process "${GHOSTTY_APP_NAME}"
        ${captures}
        ${applies}
      end tell
    end tell
  `;
  await osascript(script);

  // Cleanup: undo the sentinel titles we wrote, so windows don't show
  // "⎈seance:..." in their title bars until their shell happens to reset it.
  // We just write the tty basename back; active shells / Claude will reassert
  // their own title within ms anyway, but idle/waiting windows stay readable.
  await Promise.all(
    stamped.map((s) => {
      const ttyName = s.ttyPath.replace(/^\/dev\//, "");
      return fs
        .writeFile(s.ttyPath, `\x1b]2;${ttyName}\x1b\\`, { flag: "a" })
        .catch(() => undefined);
    }),
  );
}

export interface ScreenInfo {
  /**
   * 0-based index into NSScreen.screens. Convenient for `--screen <n>`, but
   * NOT stable: the array reorders on focus change / reconnect. Persist
   * `displayId` instead.
   */
  index: number;
  /** Stable CGDirectDisplayID (NSScreenNumber). Survives reorder/reconnect. */
  displayId: number;
  /** Visible frame in AX coordinates (top-left origin, excl. menu bar / dock). */
  rect: Rect;
  /** The screen with keyboard focus (NSScreen.mainScreen). */
  isMain: boolean;
  /** The screen at Cocoa origin (0,0) — carries the menu bar. */
  isPrimary: boolean;
}

/**
 * Enumerate every display as an AX-space rect (top-left origin, excludes menu
 * bar and dock), in NSScreen.screens order.
 *
 * visibleFrame is in Cocoa coords (bottom-left origin, y-up, one global space).
 * We read each screen's visibleFrame plus the primary display's full frame
 * height, then flip in pure TS via cocoaFramesToAx. Secondary displays flip
 * against the *primary* height, which is why they land at negative AX y.
 */
export async function listScreens(): Promise<ScreenInfo[]> {
  const script = `
    ObjC.import('AppKit');
    const screens = $.NSScreen.screens;
    const main = $.NSScreen.mainScreen;
    let primaryH = 0;
    for (let i = 0; i < screens.count; i++) {
      const f = screens.objectAtIndex(i).frame;
      if (f.origin.x === 0 && f.origin.y === 0) { primaryH = f.size.height; break; }
    }
    if (primaryH === 0 && screens.count > 0) primaryH = screens.objectAtIndex(0).frame.size.height;
    const lines = [String(primaryH)];
    for (let i = 0; i < screens.count; i++) {
      const s = screens.objectAtIndex(i);
      const v = s.visibleFrame;
      const f = s.frame;
      const isMain = s.isEqual(main) ? 1 : 0;
      const isPrimary = (f.origin.x === 0 && f.origin.y === 0) ? 1 : 0;
      const did = s.deviceDescription.objectForKey("NSScreenNumber").js;
      lines.push([v.origin.x, v.origin.y, v.size.width, v.size.height, isMain, isPrimary, did].join('\\t'));
    }
    lines.join('\\n');
  `;
  const raw = await osascript(script, { language: "JavaScript" });
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const primaryH = Number(lines[0] ?? 0);
  const parsed = lines.slice(1).map((line) => line.split("\t").map(Number));
  const visibleFrames: CocoaRect[] = parsed.map((p) => ({
    x: p[0] ?? 0,
    y: p[1] ?? 0,
    width: p[2] ?? 0,
    height: p[3] ?? 0,
  }));
  const rects = cocoaFramesToAx(visibleFrames, primaryH);
  return rects.map((rect, i) => ({
    index: i,
    displayId: parsed[i]?.[6] ?? 0,
    rect,
    isMain: parsed[i]?.[4] === 1,
    isPrimary: parsed[i]?.[5] === 1,
  }));
}

/**
 * Apply a parsed Ghostty palette to a single window via OSC sequences
 * written to its TTY. Per-window recoloring, no Ghostty config touched.
 *
 * Sequences:
 *   OSC 4;<n>;<color> ST   per palette index 0..15
 *   OSC 10;<color> ST       foreground
 *   OSC 11;<color> ST       background
 *   OSC 12;<color> ST       cursor
 *
 * ST is `\x1b\\`. One atomic write per TTY.
 */
export async function applyPaletteToTty(
  ttyPath: string,
  palette: ThemePalette,
): Promise<void> {
  const ST = "\x1b\\";
  const ESC = "\x1b]";
  const parts: string[] = [];
  for (let i = 0; i < 16; i++) parts.push(`${ESC}4;${i};${palette.ansi[i]}${ST}`);
  parts.push(`${ESC}10;${palette.foreground}${ST}`);
  parts.push(`${ESC}11;${palette.background}${ST}`);
  parts.push(`${ESC}12;${palette.cursor}${ST}`);
  await fs.writeFile(ttyPath, parts.join(""), { flag: "a" });
}

/**
 * Detect the active macOS appearance via `defaults read -g AppleInterfaceStyle`.
 * Returns "dark" when the key is "Dark", "light" when the key is absent
 * (defaults exits non-zero) or returns anything else.
 */
export async function currentAppearance(): Promise<Appearance> {
  try {
    const { stdout } = await execa("defaults", ["read", "-g", "AppleInterfaceStyle"], {
      reject: false,
    });
    return stdout.trim() === "Dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * List available Ghostty theme names via the CLI.
 */
export async function listThemes(): Promise<string[]> {
  const { stdout } = await execa("ghostty", ["+list-themes"]);
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .map((s) => s.replace(/\s*\([^)]*\)\s*$/, ""))
    .filter((s) => s.length > 0);
}

export interface WindowInfo {
  axIndex: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
}

/**
 * Snapshot every Ghostty top-level window via System Events.
 * Index is the AX 1-based position (z-order, frontmost first).
 */
export async function listAllWindows(): Promise<WindowInfo[]> {
  const script = `
    tell application "System Events"
      tell process "${GHOSTTY_APP_NAME}"
        set out to ""
        set i to 0
        repeat with w in windows
          set i to i + 1
          set t to ""
          try
            set t to name of w
          end try
          set px to "?"
          set py to "?"
          try
            set p to position of w
            set px to (item 1 of p as string)
            set py to (item 2 of p as string)
          end try
          set sw to "?"
          set sh to "?"
          try
            set sz to size of w
            set sw to (item 1 of sz as string)
            set sh to (item 2 of sz as string)
          end try
          set m to "?"
          try
            set m to (value of attribute "AXMinimized" of w) as string
          end try
          set out to out & i & tab & t & tab & px & tab & py & tab & sw & tab & sh & tab & m & "\\n"
        end repeat
        return out
      end tell
    end tell
  `;
  const raw = await osascript(script);
  return parseTsv(raw).map((row) => ({
    axIndex: Number(row[0]),
    title: row[1] ?? "",
    x: Number(row[2]),
    y: Number(row[3]),
    width: Number(row[4]),
    height: Number(row[5]),
    minimized: row[6] === "true",
  }));
}

export interface ProbeRow {
  axIndex: number;
  /**
   * Ghostty's window id, when resolvable. Ghostty 1.3.x only exposes its key
   * window to AppleScript, so this is usually absent — targeting relies on
   * ttyPath + AX index, not this. Used opportunistically by `restore --rebind`.
   */
  ghosttyId?: string;
  ttyPath: string;
  command: string;
  cwd?: string;
}

/**
 * Brand every Ghostty child TTY with a unique sentinel title, then resolve
 * each Ghostty window's id, AX index, tty, and foreground command.
 *
 * Stamps temporarily clobber window titles; the shell or Claude Code resets
 * them on the next prompt redraw / title update.
 */
export async function probeWindows(): Promise<ProbeRow[]> {
  const pid = await ghosttyPid();
  if (pid === undefined) return [];

  const { stdout: psOut } = await execa("ps", ["-axo", "pid,ppid,tty,command"]);
  type Proc = { pid: number; ppid: number; tty: string; command: string };
  const procs: Proc[] = [];
  for (const line of psOut.split("\n").slice(1)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), tty: m[3]!, command: m[4]! });
  }

  const childTtys = new Set<string>();
  for (const p of procs) if (p.ppid === pid && /^ttys\d+/.test(p.tty)) childTtys.add(p.tty);

  const ttys = [...childTtys].sort();
  if (ttys.length === 0) return [];

  // Multi-round probe: in each round write sentinels to unmapped ttys, read AX
  // + Ghostty dict, accumulate. Other apps (Claude Code, shell prompts) race
  // with us writing their own OSC 2, so one pass often misses windows whose
  // owners are actively reasserting titles.
  const ttyToGhId = new Map<string, string>();
  const ttyToAx = new Map<string, number>();
  // Ghostty's scripting dict mirror of NSWindow.title can lag AX by a frame or
  // two; 300ms gives both updates time to propagate. 5 rounds = 1.5s max.
  const MAX_ROUNDS = 5;
  const ROUND_DELAY_MS = 300;
  const sentinelPattern = /⌬probe:(ttys\d+):/;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const remaining = ttys.filter((t) => !ttyToGhId.has(t) || !ttyToAx.has(t));
    if (remaining.length === 0) break;

    const stamp = `${Date.now().toString(36)}r${round}`;
    // Burst: write the sentinel 3× per tty so we're more likely to be the
    // "last write" when titles are being contested (e.g. Claude Code reasserts
    // its title every few hundred ms).
    const payload = (t: string) =>
      `\x1b]2;⌬probe:${t}:${stamp}\x1b\\`.repeat(3);
    await Promise.all(
      remaining.map((t) =>
        fs.writeFile(`/dev/${t}`, payload(t), { flag: "a" }).catch(() => undefined),
      ),
    );
    await new Promise((r) => setTimeout(r, ROUND_DELAY_MS));

    const ghScript = `
      tell application id "${GHOSTTY_BUNDLE_ID}"
        set out to ""
        repeat with w in windows
          set nm to (name of w as string)
          if nm contains "⌬probe:" then
            set out to out & (id of w as string) & (ASCII character 9) & nm & "\\n"
          end if
        end repeat
        return out
      end tell
    `;
    const axScript = `
      tell application "System Events"
        tell process "${GHOSTTY_APP_NAME}"
          set out to ""
          set i to 0
          repeat with w in windows
            set i to i + 1
            set nm to ""
            try
              set nm to name of w
            end try
            if nm contains "⌬probe:" then
              set out to out & i & tab & nm & "\\n"
            end if
          end repeat
          return out
        end tell
      end tell
    `;
    const [ghRaw, axRaw] = await Promise.all([osascript(ghScript), osascript(axScript)]);
    for (const [id, name] of parseTsv(ghRaw)) {
      const m = sentinelPattern.exec(name ?? "");
      if (m && id) ttyToGhId.set(m[1]!, id);
    }
    for (const [idxStr, name] of parseTsv(axRaw)) {
      const m = sentinelPattern.exec(name ?? "");
      if (m && idxStr) ttyToAx.set(m[1]!, Number(idxStr));
    }
  }

  // Deepest PID per tty = foreground command (latest fork).
  const deepest = new Map<string, Proc>();
  for (const p of procs) {
    if (!/^ttys\d+/.test(p.tty)) continue;
    const cur = deepest.get(p.tty);
    if (!cur || p.pid > cur.pid) deepest.set(p.tty, p);
  }

  const cwds = await cwdsForPids([...deepest.values()].map((p) => p.pid));

  // Cleanup: every tty we wrote a probe sentinel to gets a readable label
  // written back, so minimized-window Dock tooltips don't show "⌬probe:…".
  // Active shells / Claude will reassert their own titles within ms; idle
  // and minimized windows will see this label until something else writes.
  const home = process.env.HOME ?? "";
  await Promise.all(
    ttys.map((tty) => {
      const proc = deepest.get(tty);
      const cwd = proc ? cwds.get(proc.pid) : undefined;
      const niceCwd = cwd && home && cwd.startsWith(home) ? cwd.replace(home, "~") : cwd;
      const label = niceCwd ? `${tty} · ${niceCwd}` : tty;
      return fs
        .writeFile(`/dev/${tty}`, `\x1b]2;${label}\x1b\\`, { flag: "a" })
        .catch(() => undefined);
    }),
  );

  const rows: ProbeRow[] = [];
  for (const tty of ttys) {
    const ghId = ttyToGhId.get(tty);
    const axIdx = ttyToAx.get(tty);
    // The AX index (resolved via the System-Events sentinel match) is the
    // identity we actually target by. Ghostty 1.3.x only reports its key
    // window, so ghId is usually absent — don't drop a window for lacking it.
    if (axIdx === undefined) continue;
    const proc = deepest.get(tty);
    rows.push({
      axIndex: axIdx,
      ...(ghId ? { ghosttyId: ghId } : {}),
      ttyPath: `/dev/${tty}`,
      command: proc?.command ?? "",
      ...(proc && cwds.get(proc.pid) ? { cwd: cwds.get(proc.pid)! } : {}),
    });
  }
  return rows.sort((a, b) => a.axIndex - b.axIndex);
}

/**
 * Foreground command per TTY (the deepest / latest-forked process), e.g.
 * `claude --resume <uuid>` or `-/bin/zsh`. Used by `gather` to tell the user
 * how to recover a window that's stranded on another Space.
 */
export async function foregroundCommandsByTty(
  ttyPaths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ttyPaths.length === 0) return out;
  const wanted = new Set(ttyPaths.map((p) => p.replace(/^\/dev\//, "")));
  const { stdout } = await execa("ps", ["-axo", "pid,tty,command"]);
  const deepest = new Map<string, { pid: number; command: string }>();
  for (const line of stdout.split("\n").slice(1)) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const tty = m[2]!;
    if (!wanted.has(tty)) continue;
    const pid = Number(m[1]);
    const cur = deepest.get(tty);
    if (!cur || pid > cur.pid) deepest.set(tty, { pid, command: m[3]! });
  }
  for (const [tty, v] of deepest) out.set(`/dev/${tty}`, v.command);
  return out;
}

async function cwdsForPids(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pids.length === 0) return out;
  try {
    const { stdout } = await execa(
      "lsof",
      ["-a", "-d", "cwd", "-Fn", "-p", pids.join(",")],
      { reject: false },
    );
    let currentPid: number | undefined;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) {
        currentPid = Number(line.slice(1));
      } else if (line.startsWith("n") && currentPid !== undefined) {
        const path = line.slice(1);
        if (path.startsWith("/")) out.set(currentPid, path);
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export interface GhosttyWindowSnapshot {
  ghosttyId: string;
  title: string;
  cwd: string;
}

/**
 * Read each Ghostty window's id, title, and working directory via Ghostty's
 * own scripting dictionary. No OSC writes, no race — useful when probe is
 * losing to apps like Claude Code that aggressively re-assert OSC 2 titles.
 *
 * Returns the working directory of each window's *selected tab's focused
 * terminal* (Ghostty exposes `working directory` on the terminal surface).
 */
export async function listGhosttyWindowsNative(): Promise<GhosttyWindowSnapshot[]> {
  const script = `
    tell application id "${GHOSTTY_BUNDLE_ID}"
      set out to ""
      repeat with w in windows
        set wid to (id of w as string)
        set wname to (name of w as string)
        set wcwd to ""
        try
          set wcwd to (working directory of focused terminal of selected tab of w as string)
        end try
        set out to out & wid & (ASCII character 9) & wname & (ASCII character 9) & wcwd & "\\n"
      end repeat
      return out
    end tell
  `;
  const raw = await osascript(script);
  return parseTsv(raw).map((row) => ({
    ghosttyId: row[0] ?? "",
    title: row[1] ?? "",
    cwd: row[2] ?? "",
  }));
}

/**
 * Snapshot the set of Ghostty window ids (via Ghostty's own dictionary).
 * Useful for the spawn-and-diff pattern: capture before, spawn, diff after.
 */
export async function listGhosttyIds(): Promise<Set<string>> {
  const script = `
    tell application id "${GHOSTTY_BUNDLE_ID}"
      set out to ""
      repeat with w in windows
        set out to out & (id of w as string) & "\\n"
      end repeat
      return out
    end tell
  `;
  const raw = await osascript(script);
  return new Set(
    raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** Run an AppleScript file via osascript. */
export async function runScriptFile(path: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("seance: AppleScript execution requires macOS");
  }
  await execa("osascript", [path]);
}

/**
 * Read the current rect of each window identified by ttyPath. Uses the same
 * sentinel-via-TTY trick as setWindowBounds, but only reads instead of moves.
 * Returns Map<ttyPath, Rect>; missing entries mean the window couldn't be located.
 */
export async function currentRectsByTty(ttyPaths: string[]): Promise<Map<string, Rect>> {
  const result = new Map<string, Rect>();
  if (ttyPaths.length === 0) return result;

  const stamp = Date.now().toString(36);
  const stamped = ttyPaths.map((ttyPath, i) => ({
    ttyPath,
    sentinel: `⎈seance-read:${stamp}:${i}`,
  }));

  await Promise.all(
    stamped.map((s) =>
      fs.writeFile(s.ttyPath, `\x1b]2;${s.sentinel}\x1b\\`, { flag: "a" }).catch(() => undefined),
    ),
  );
  await new Promise((r) => setTimeout(r, 200));

  const script = `
    tell application "System Events"
      tell process "${GHOSTTY_APP_NAME}"
        set out to ""
        repeat with w in windows
          set nm to ""
          try
            set nm to name of w
          end try
          if nm contains "⎈seance-read:" then
            set p to position of w
            set sz to size of w
            set out to out & nm & tab & (item 1 of p as string) & tab & (item 2 of p as string) & tab & (item 1 of sz as string) & tab & (item 2 of sz as string) & "\\n"
          end if
        end repeat
        return out
      end tell
    end tell
  `;
  const raw = await osascript(script);
  const bySentinel = new Map(stamped.map((s) => [s.sentinel, s.ttyPath]));
  for (const row of parseTsv(raw)) {
    const [name, x, y, w, h] = row;
    if (!name) continue;
    const idx = name.indexOf("⎈seance-read:");
    if (idx < 0) continue;
    const sent = name.slice(idx);
    const ttyPath = bySentinel.get(sent);
    if (!ttyPath) continue;
    result.set(ttyPath, {
      x: Number(x),
      y: Number(y),
      width: Number(w),
      height: Number(h),
    });
  }
  return result;
}

/**
 * Heuristic: does this title look like a default shell prompt (cwd-derived)
 * rather than something meaningful the user set?
 *
 * If yes, don't fossilize it in saved state — restored windows should derive
 * fresh titles from the new shell rather than wearing the old cwd's name.
 */
export function looksLikeShellDefaultTitle(title: string | undefined, cwd?: string): boolean {
  if (!title) return true;
  const t = title.trim();
  if (!t) return true;
  // bare path or ~/path
  if (/^~?\/.+$/.test(t)) return true;
  // user@host:path
  if (/^[\w.-]+@[\w.-]+:.+$/.test(t)) return true;
  if (cwd) {
    const home = process.env.HOME ?? "";
    const tilde = home ? cwd.replace(new RegExp("^" + escapeRegExp(home)), "~") : cwd;
    const base = cwd.split("/").pop() ?? "";
    if (t === cwd || t === tilde || (base && t === base)) return true;
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ghosttyPid(): Promise<number | undefined> {
  try {
    const { stdout } = await execa("ps", ["-axo", "pid,command"]);
    for (const line of stdout.split("\n")) {
      if (line.includes("/Ghostty.app/Contents/MacOS/")) {
        const pid = Number(line.trim().split(/\s+/)[0]);
        if (Number.isFinite(pid)) return pid;
      }
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

function parseTsv(raw: string): string[][] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}
