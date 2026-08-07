import type { ThemePalette } from "./themes.js";

/** WCAG AA for normal text. */
export const DEFAULT_MIN_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `color` if it already clears `minRatio` against `background`, else the
 * closest variant that does.
 *
 * The search runs in OKLab and moves lightness only, so hue survives — a washed
 * out amber becomes a darker amber, not brown. Chroma is surrendered in steps
 * only when no lightness at all reaches the ratio (a saturated yellow can never
 * clear 4.5:1 against white while staying that saturated).
 */
export function readableAgainst(color: string, background: string, minRatio: number): string {
  if (!HEX.test(color) || !HEX.test(background)) return color;
  if (contrastRatio(color, background) >= minRatio) return color;

  const lighten = contrastRatio("#ffffff", background) >= contrastRatio("#000000", background);
  const [l, a, b] = toOklab(color);

  for (const chroma of [1, 0.75, 0.5, 0.25, 0]) {
    const ca = a * chroma;
    const cb = b * chroma;
    if (contrastRatio(fromOklab(lighten ? 1 : 0, ca, cb), background) < minRatio) continue;
    let lo = lighten ? l : 0;
    let hi = lighten ? 1 : l;
    let best = fromOklab(lighten ? 1 : 0, ca, cb);
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const candidate = fromOklab(mid, ca, cb);
      if (contrastRatio(candidate, background) >= minRatio) {
        best = candidate;
        if (lighten) hi = mid;
        else lo = mid;
      } else if (lighten) lo = mid;
      else hi = mid;
    }
    return best;
  }
  return lighten ? "#ffffff" : "#000000";
}

export interface ContrastOptions {
  /** Measure against this instead of the palette's own background. */
  background?: string;
  /** Minimum WCAG ratio. <= 0 disables repair entirely. */
  minRatio?: number;
}

/**
 * Repair a palette so nothing it can paint is invisible against the background
 * it will actually be painted on.
 *
 * Ghostty's bundled themes reserve slots that sit at or near the background —
 * ANSI 0 on dark themes, ANSI 7/15 on light ones — and every light theme in the
 * curated set ships several chromatic slots under 2:1 as well. That is fine for
 * a theme read as a whole and fatal for a TUI that picks a slot and writes text
 * in it: One Half Light's bright white is 1.04:1 against its own background,
 * i.e. literally white on white.
 *
 * `background` matters because a per-repo override (see `seance background`)
 * changes what the palette is measured against — repairing against the theme's
 * own background and then painting a different one puts the guarantee back.
 */
export function enforceContrast(palette: ThemePalette, options: ContrastOptions = {}): ThemePalette {
  const background = options.background ?? palette.background;
  const minRatio = options.minRatio ?? DEFAULT_MIN_CONTRAST;
  if (minRatio <= 0) return { ...palette, background };
  return {
    background,
    foreground: readableAgainst(palette.foreground, background, minRatio),
    cursor: readableAgainst(palette.cursor, background, minRatio),
    ansi: palette.ansi.map((c) => readableAgainst(c, background, minRatio)),
  };
}

export interface ContrastRepair {
  /** ANSI index 0..15, or "foreground" / "cursor". */
  slot: number | "foreground" | "cursor";
  from: string;
  to: string;
  ratioBefore: number;
  ratioAfter: number;
}

/** What `enforceContrast` would change, for reporting. */
export function contrastRepairs(
  palette: ThemePalette,
  options: ContrastOptions = {},
): ContrastRepair[] {
  const background = options.background ?? palette.background;
  const fixed = enforceContrast(palette, options);
  const repairs: ContrastRepair[] = [];
  const note = (slot: ContrastRepair["slot"], from: string, to: string): void => {
    if (from === to) return;
    repairs.push({
      slot,
      from,
      to,
      ratioBefore: contrastRatio(from, background),
      ratioAfter: contrastRatio(to, background),
    });
  };
  palette.ansi.forEach((c, i) => note(i, c, fixed.ansi[i]!));
  note("foreground", palette.foreground, fixed.foreground);
  note("cursor", palette.cursor, fixed.cursor);
  return repairs;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function toOklab(hex: string): [number, number, number] {
  const [sr, sg, sb] = channels(hex);
  const r = srgbToLinear(sr);
  const g = srgbToLinear(sg);
  const b = srgbToLinear(sb);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(lightness: number, a: number, b: number): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb.map((v) => clamp8(linearToSrgb(v))).join("")}`;
}

function clamp8(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");
}
