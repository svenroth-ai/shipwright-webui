/*
 * Embedded-terminal theme palette (iterate v0.8.2, AC-2).
 *
 * Extracted from EmbeddedTerminal.tsx so the WCAG-AA contrast tests can
 * assert against the same literal color values the runtime uses. Imported
 * back into EmbeddedTerminal where the live cssVar() lookups still wrap
 * brand semantics for slots that have a natural correspondence
 * (error/success/warning/info/purple).
 *
 * Per spec option (b) — switch xterm to a dark theme ONCE at session
 * start (terminal-creation = session-start) so Claude Code's TUI input
 * box renders cleanly. Rationale lives in the inline comment in
 * EmbeddedTerminal.tsx; ADR captured at finalize.
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

/**
 * Static palette literals — values used when CSS-vars resolve to their
 * fallbacks (jsdom test runs, brand-var unavailable). The runtime
 * EmbeddedTerminal.tsx keeps cssVar() resolution for the slots tagged
 * "// brand" below; everything else is fixed.
 */
export const EMBEDDED_TERMINAL_PALETTE: AnsiPalette = {
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
