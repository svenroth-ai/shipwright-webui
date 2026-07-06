/*
 * Embedded-terminal theme palettes (iterate v0.8.2 dark; light added
 * iterate-2026-07-06-terminal-theme-modes, FR-01.44).
 *
 * Two palettes — DARK (the original, unchanged) and LIGHT (new). The
 * embedded terminal picks one at runtime via `paletteFor(appearance)` so
 * the xterm background/foreground/ANSI-16 track whichever theme Claude
 * Code is using (Claude paints no background of its own — it assumes the
 * host terminal already matches its theme, so a light Claude theme on a
 * dark terminal is black-on-black). See `lib/terminalAppearance.ts` for
 * how the resolved appearance is chosen (mirror Claude Code / system /
 * manual override), and `xtermAddons.ts buildEmbeddedXtermOptions()` for
 * where a palette becomes an xterm `ITheme`.
 *
 * WCAG-AA is asserted against these literals in `terminal-theme.test.ts`
 * (the black-on-black regression guard). DARK excludes the `black` slot
 * from the contrast sweep (by design near the bg); LIGHT symmetrically
 * excludes `brightWhite` (its near-bg slot).
 *
 * Values here are the static fallbacks; the runtime keeps a few cssVar()
 * brand overrides for the bright-* slots that have a natural brand
 * correspondence (see `xtermAddons.ts`).
 */

export interface AnsiPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** The resolved runtime appearance (never `auto`/`system` — those resolve
 *  to one of these before a palette is picked). */
export type ResolvedAppearance = "light" | "dark";

/**
 * DARK palette — the original embedded-terminal theme. Values used when
 * CSS-vars resolve to their fallbacks (jsdom test runs, brand-var
 * unavailable). The runtime `xtermAddons.ts` keeps cssVar() resolution for
 * the slots tagged "// brand" below; everything else is fixed.
 */
export const DARK_PALETTE: AnsiPalette = {
  background: "#1a1a1a",
  foreground: "#f5f0eb",
  cursor: "#f5f0eb",
  cursorAccent: "#1a1a1a",
  selectionBackground: "#6b5e5680", // brand brown @ 50% alpha
  black: "#1a1a1a",
  red: "#F87171",
  green: "#34D399",
  yellow: "#FBBF24",
  blue: "#60A5FA",
  magenta: "#A78BFA",
  cyan: "#22D3EE",
  white: "#e5e0d8", // near-white, AA-large on bg=#1a1a1a
  brightBlack: "#9ca3af",
  brightRed: "#FCA5A5", // brand fallback
  brightGreen: "#6EE7B7", // brand fallback
  brightYellow: "#FCD34D", // brand fallback
  brightBlue: "#93C5FD", // brand fallback
  brightMagenta: "#C4B5FD", // brand fallback
  brightCyan: "#67E8F9",
  brightWhite: "#ffffff",
};

/**
 * LIGHT palette — for when Claude Code is on a light theme (else its dark
 * text renders black-on-black on the dark bg). Based on VS Code's "Light
 * Modern" terminal palette (microsoft/vscode terminalColorRegistry.ts),
 * with the too-light bright-* slots darkened so every swept slot clears
 * WCAG AA-large (≥3.0:1) on the white bg — VS Code leans on its runtime
 * `minimumContrastRatio` for those; we bake the contrast into the literals
 * instead so the palette is self-sufficient (and the DARK rendering stays
 * byte-identical — no global minimumContrastRatio change). `brightWhite`
 * is the near-bg slot (excluded from the sweep, mirroring `black` in DARK).
 */
export const LIGHT_PALETTE: AnsiPalette = {
  background: "#ffffff",
  foreground: "#333333",
  cursor: "#333333",
  cursorAccent: "#ffffff",
  selectionBackground: "#add6ff80", // VS Code light selection @ 50% alpha
  black: "#000000",
  red: "#cd3131",
  green: "#107c10",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#1a991a", // darkened from VS Code #14ce14 (too light on white)
  brightYellow: "#b58900", // darkened from VS Code #b5ba00 (too light on white)
  brightBlue: "#2472c8",
  brightMagenta: "#b510b5", // darkened from VS Code #bc05bc-bright variants
  brightCyan: "#0b8ba8",
  brightWhite: "#a5a5a5", // near-bg slot on light — excluded from the sweep
};

/**
 * Back-compat alias — `EMBEDDED_TERMINAL_PALETTE` was the sole palette
 * before light support. Retained so the existing WCAG regression guard
 * (`terminal-theme.test.ts`) and any other importer keep resolving. New
 * code should use {@link DARK_PALETTE} / {@link LIGHT_PALETTE} /
 * {@link paletteFor}.
 */
export const EMBEDDED_TERMINAL_PALETTE = DARK_PALETTE;

/** Pick the palette for a resolved appearance. */
export function paletteFor(appearance: ResolvedAppearance): AnsiPalette {
  return appearance === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}

/**
 * Compute relative luminance per WCAG 2.1 (sRGB).
 * Accepts `#rrggbb` or `#rrggbbaa` (alpha is ignored — we only check the
 * solid color channel since selectionBackground is an alpha overlay).
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const Lfg = relativeLuminance(fgHex);
  const Lbg = relativeLuminance(bgHex);
  const lighter = Math.max(Lfg, Lbg);
  const darker = Math.min(Lfg, Lbg);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace(/^#/, "");
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  // Allow 8-digit (#rrggbbaa) — strip alpha.
  const core = s.length === 8 ? s.slice(0, 6) : s;
  return {
    r: parseInt(core.slice(0, 2), 16),
    g: parseInt(core.slice(2, 4), 16),
    b: parseInt(core.slice(4, 6), 16),
  };
}
