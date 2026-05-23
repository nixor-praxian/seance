import type { Group, SeanceState, WindowRef, LayoutSpec } from "./types.js";

export function createGroup(state: SeanceState, name: string): Group {
  if (state.groups[name]) {
    throw new Error(`group "${name}" already exists`);
  }
  const now = new Date().toISOString();
  const group: Group = {
    name,
    windows: [],
    createdAt: now,
    updatedAt: now,
  };
  state.groups[name] = group;
  return group;
}

export function getGroup(state: SeanceState, name: string): Group {
  const g = state.groups[name];
  if (!g) throw new Error(`no such group "${name}"`);
  return g;
}

export function listGroups(state: SeanceState): Group[] {
  return Object.values(state.groups).sort((a, b) => a.name.localeCompare(b.name));
}

export function addWindow(state: SeanceState, name: string, win: WindowRef): Group {
  const g = getGroup(state, name);
  if (!g.windows.some((w) => w.windowId === win.windowId)) {
    g.windows.push(win);
    g.updatedAt = new Date().toISOString();
  }
  return g;
}

export function removeWindow(state: SeanceState, name: string, windowId: number): Group {
  const g = getGroup(state, name);
  const before = g.windows.length;
  g.windows = g.windows.filter((w) => w.windowId !== windowId);
  if (g.windows.length !== before) g.updatedAt = new Date().toISOString();
  return g;
}

export function deleteGroup(state: SeanceState, name: string): void {
  if (!state.groups[name]) throw new Error(`no such group "${name}"`);
  delete state.groups[name];
}

export function setGroupLayout(state: SeanceState, name: string, layout: LayoutSpec): Group {
  const g = getGroup(state, name);
  g.lastLayout = layout;
  g.updatedAt = new Date().toISOString();
  return g;
}

export function setGroupTheme(state: SeanceState, name: string, themeName: string): Group {
  const g = getGroup(state, name);
  g.themeName = themeName;
  g.updatedAt = new Date().toISOString();
  return g;
}
