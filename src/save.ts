import type { Rect } from "./types.js";

export interface SaveEntry {
  slot: number;
  cwd: string;
  rect: Rect;
  title?: string;
}

/**
 * Emit a self-contained AppleScript that recreates a group's windows fresh:
 * for each entry, spawn a new Ghostty window in the saved cwd, diff Ghostty's
 * window-id list to confirm a new window appeared, then position System
 * Events' frontmost window (always the just-spawned one) to the saved rect.
 *
 * The output is human-readable, hand-editable, and runnable directly with
 * `osascript <file>`. No seance binary required at restore time.
 */
export function buildSaveScript(group: string, entries: SaveEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.slot - b.slot);
  const header = [
    `-- seance group: ${group}`,
    `-- generated: ${new Date().toISOString()}`,
    `-- ${sorted.length} window(s); restore with:  osascript <this file>`,
    "",
    'on currentIds()',
    '  tell application id "com.mitchellh.ghostty"',
    "    set out to {}",
    "    repeat with w in windows",
    "      set end of out to (id of w as string)",
    "    end repeat",
    "    return out",
    "  end tell",
    "end currentIds",
    "",
    "on diffNewId(before)",
    "  set after to my currentIds()",
    "  repeat with i in after",
    "    if before does not contain (contents of i) then return (contents of i)",
    "  end repeat",
    '  return ""',
    "end diffNewId",
    "",
    'tell application id "com.mitchellh.ghostty" to activate',
    "delay 0.3",
    "",
  ].join("\n");

  const blocks = sorted.map((e, idx) => {
    const label = e.title ? ` (${e.title})` : "";
    const cwdAS = asString(e.cwd);
    return [
      `-- slot ${e.slot}: ${e.cwd}${label}`,
      `set before${idx} to my currentIds()`,
      `do shell script ("open -na ghostty.app --args --working-directory=" & quoted form of ${cwdAS})`,
      `delay 0.8`,
      `set newId${idx} to my diffNewId(before${idx})`,
      `tell application "System Events"`,
      `  tell process "Ghostty"`,
      `    set position of window 1 to {${e.rect.x}, ${e.rect.y}}`,
      `    set size of window 1 to {${e.rect.width}, ${e.rect.height}}`,
      `  end tell`,
      `end tell`,
      "",
    ].join("\n");
  });

  return header + blocks.join("\n");
}

function asString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
