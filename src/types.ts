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
  lastLayout?: LayoutSpec;
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
}
