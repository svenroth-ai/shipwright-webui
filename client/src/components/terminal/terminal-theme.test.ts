/*
 * Embedded-terminal theme contrast tests (iterate v0.8.2, AC-2).
 *
 * Regression guard for the black-on-black input rendering bug surfaced
 * by Claude Code's TUI input box on the previous light-theme palette.
 * Two assertion classes:
 *
 * (1) WCAG AA contrast for the foreground/background pair (≥ 4.5:1).
 * (2) Synthesized escape-sequence fixtures — the most plausible TUI
 *     input-box patterns (reverse-video, white-on-black, near-white
 *     on dark slot) all land ≥ 4.5:1.
 *
 * Notes:
 *   - The `black` ANSI slot is intentionally near-bg and skipped in the
 *     "every fg vs default bg" sweep — code rendered with `\e[30m` on
 *     the default bg should stay near-black; reverse-video flips the
 *     pair so the input box gets the high-contrast cream-on-dark.
 *   - Brand fallbacks for cssVar()-driven slots match the static palette
 *     so the test runs in jsdom (no live brand-vars) match the runtime
 *     when the brand file is loaded. If a brand-var override drops a
 *     slot below AA, the runtime override is wrong, not the test.
 */

import { describe, expect, it } from "vitest";
import {
  EMBEDDED_TERMINAL_PALETTE,
  contrastRatio,
  relativeLuminance,
} from "./terminal-theme";

const AA = 4.5;
const AA_LARGE = 3.0;

describe("terminal-theme — relative luminance utility", () => {
  it("returns 0 for pure black, 1 for pure white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("strips alpha from 8-digit hex", () => {
    // selectionBackground uses the #rrggbbaa form
    expect(relativeLuminance("#6b5e5680")).toBeCloseTo(
      relativeLuminance("#6b5e56"),
      5,
    );
  });
});

describe("EMBEDDED_TERMINAL_PALETTE — WCAG AA contrast (AC-2 regression guard)", () => {
  const p = EMBEDDED_TERMINAL_PALETTE;

  it("foreground vs background ≥ AA (4.5:1) — primary input legibility", () => {
    const ratio = contrastRatio(p.foreground, p.background);
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });

  // Exclude `black` from the sweep — by design near the bg.
  // Exclude `selectionBackground` — it's a translucent overlay, not a fg.
  const fgSlotsToSweep: Array<keyof typeof p> = [
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
  ];

  for (const slot of fgSlotsToSweep) {
    it(`${String(slot)} vs background ≥ AA-large (3.0:1)`, () => {
      const ratio = contrastRatio(p[slot] as string, p.background);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  it("white slot vs black slot ≥ AA — the pair that triggered the bug under the old palette", () => {
    // Old theme: white = #6b5e56, black = #1a1a1a → ~3.5:1, sub-AA.
    // New theme: white = #e5e0d8, black = #1a1a1a → ≥ 12:1.
    const ratio = contrastRatio(p.white, p.black);
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });

  it("white slot vs background ≥ AA — the slot Claude TUI uses for input prompt fg", () => {
    const ratio = contrastRatio(p.white, p.background);
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });

  it("brightWhite slot vs background ≥ AA — TUI 'high-emphasis' text", () => {
    const ratio = contrastRatio(p.brightWhite, p.background);
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });
});

describe("EMBEDDED_TERMINAL_PALETTE — TUI escape-sequence fixtures (AC-2 fixture-driven)", () => {
  const p = EMBEDDED_TERMINAL_PALETTE;

  it("reverse-video pattern (`\\e[7m` swaps fg/bg) reads cream-on-dark", () => {
    // Reverse swaps default fg ↔ default bg.
    const fg = p.background;
    const bg = p.foreground;
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  it("white-on-black pattern (`\\e[40m\\e[37m`) ≥ AA", () => {
    expect(contrastRatio(p.white, p.black)).toBeGreaterThanOrEqual(AA);
  });

  it("brightWhite-on-black pattern (`\\e[40m\\e[97m`) ≥ AA", () => {
    expect(contrastRatio(p.brightWhite, p.black)).toBeGreaterThanOrEqual(AA);
  });

  it("brightBlack as fg on default bg (TUI 'dimmed text', e.g. timestamps) ≥ AA-large", () => {
    // brightBlack is a foreground slot for "dimmed" output. Don't assert
    // it as a usable highlight bg — most TUIs pair it as fg only and our
    // palette intentionally keeps it light enough to read against the
    // primary dark bg.
    expect(contrastRatio(p.brightBlack, p.background)).toBeGreaterThanOrEqual(
      AA_LARGE,
    );
  });
});
