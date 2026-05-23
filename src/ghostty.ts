import { execa } from "execa";
import type { Rect, WindowRef } from "./types.js";

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const GHOSTTY_APP_NAME = "Ghostty";

/**
 * Run an AppleScript snippet and return stdout.
 * Throws if osascript exits non-zero.
 */
export async function osascript(script: string): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("seance: Ghostty bridge requires macOS (osascript not available)");
  }
  const { stdout } = await execa("osascript", ["-e", script]);
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
        windowId: Number(id),
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
    windowId: Number(idx),
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
    return {
      windowId: Number(id),
      ...(title ? { title } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Move + resize a Ghostty window by its id.
 * Uses System Events accessibility for reliable framing.
 */
export async function setWindowBounds(windowId: number, rect: Rect): Promise<void> {
  const script = `
    tell application "System Events"
      tell process "${GHOSTTY_APP_NAME}"
        set targetWindow to missing value
        repeat with w in windows
          try
            if (id of w) is ${windowId} then set targetWindow to w
          end try
        end repeat
        if targetWindow is missing value then
          -- fallback: treat windowId as 1-based index
          if (count of windows) >= ${windowId} then
            set targetWindow to window ${windowId}
          else
            error "window ${windowId} not found"
          end if
        end if
        set position of targetWindow to {${rect.x}, ${rect.y}}
        set size of targetWindow to {${rect.width}, ${rect.height}}
      end tell
    end tell
  `;
  await osascript(script);
}

/**
 * Visible screen frame of the main display in AX coordinates
 * (top-left origin, excludes menu bar and dock).
 */
export async function mainScreenFrame(): Promise<Rect> {
  const script = `
    tell application "Finder"
      set b to bounds of window of desktop
    end tell
    return (item 1 of b as string) & "\\t" & (item 2 of b as string) & "\\t" & (item 3 of b as string) & "\\t" & (item 4 of b as string)
  `;
  const raw = await osascript(script);
  const [x1, y1, x2, y2] = raw.split("\t").map(Number);
  return {
    x: x1 ?? 0,
    y: y1 ?? 0,
    width: (x2 ?? 0) - (x1 ?? 0),
    height: (y2 ?? 0) - (y1 ?? 0),
  };
}

/**
 * Apply a Ghostty theme by name. v0 uses Ghostty's CLI `+show-config`
 * + `+set-config` if available; otherwise no-op with a warning.
 *
 * NOTE: Ghostty's IPC for runtime theme swaps is still maturing.
 * This is a placeholder we'll harden once tested on a real Mac.
 */
export async function applyTheme(themeName: string): Promise<void> {
  try {
    await execa("ghostty", ["+set-config", `theme=${themeName}`]);
  } catch {
    throw new Error(
      `seance: failed to apply theme "${themeName}". ` +
        `Ensure the \`ghostty\` CLI is on PATH and the theme exists. ` +
        `Run \`ghostty +list-themes\` to verify.`,
    );
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
    .filter((s) => s.length > 0);
}

function parseTsv(raw: string): string[][] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}
