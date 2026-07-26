export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridSpec {
  cols: number;
  rows: number;
}

export interface CustomColumnsSpec {
  cols: number[];
  rows?: number;
}

export type LayoutSpec = GridSpec | CustomColumnsSpec;

export interface WindowRef {
  windowId: string;
  title?: string;
  /**
   * Controlling TTY path (e.g. /dev/ttys002) captured at `group add` time.
   * Used at tile time to brand the window with a unique title sentinel via OSC 2,
   * which is then matched in System Events. Without this, AX window targeting
   * is ambiguous (Ghostty's `id` is a tab-group id System Events can't see).
   */
  ttyPath?: string;
  /** 1-indexed grid slot. slot 1 = top-left, then row-major. */
  slot?: number;
  /** Working directory captured at `group add` time. Used by `seance save`. */
  cwd?: string;
}

export interface Group {
  name: string;
  windows: WindowRef[];
  themeName?: string;
  /**
   * Background color override painted on top of the theme. Either a single
   * color (e.g. "#2e4636") used in both appearances, or an appearance-aware
   * pair resolved like the theme itself.
   */
  background?: string | { dark: string; light: string };
  lastLayout?: LayoutSpec;
  /**
   * Target display, stored as its stable CGDirectDisplayID (NSScreenNumber),
   * not the volatile NSScreen.screens index. Absent / undefined = main display.
   */
  displayId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfig {
  name: string;
  themeName?: string;
  defaultLayout?: LayoutSpec;
}

export interface ThemePair {
  light: string;
  dark: string;
}

export interface SeanceState {
  version: 1;
  groups: Record<string, Group>;
  projects: Record<string, ProjectConfig>;
  themes: Record<string, ThemePair>;
  /**
   * seance 2.0 policy (see docs/vision.md): the only state that should
   * persist long-term. Repo identity, placement rules on display roles,
   * and layout parameters — never TTYs, display ids, or coordinates.
   */
  identity?: Record<string, import("./policy.js").IdentityEntry>;
  placement?: import("./policy.js").PlacementRule[];
  layout?: { minPaneWidth: number };
  /** Last group that was used / arranged / themed. Drives default-group lookups. */
  activeGroup?: string;
  /**
   * Force theme resolution to a fixed appearance, overriding macOS. Absent =
   * follow the system. Useful because Claude Code renders with its own fixed
   * theme, so terminals must match it rather than the OS.
   */
  appearance?: "dark" | "light";
}
