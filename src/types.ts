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
  windowId: number;
  title?: string;
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
