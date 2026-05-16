/*
 * embedded-terminal-convert-eol.test.ts — Bug B regression guard
 * (iterate-20260516-converteol-smear).
 *
 * Bug B: the embedded xterm.js terminal showed a left-column glyph-fragment
 * smear when scrolling a Claude Code session. Root cause: `convertEol: true`
 * in client/src/components/terminal/EmbeddedTerminal.tsx (set by ADR-093).
 *
 * ConPTY — and Claude Code's TUI running under it — emits a bare LF as
 * "cursor down, keep column"; a real terminal honours that. `convertEol:
 * true` makes xterm.js additionally carriage-return on every LF, yanking
 * the cursor to column 0, so the next write lands at column 0 and smears
 * over the kept-column content. Three prior fixes (ADR-099 / ADR-104 /
 * ADR-108) all patched write *timing* and missed the actual cause, which
 * is how `\n` is *interpreted* — a config knob none of them touched.
 *
 * This file formalizes the deterministic repro from the Bug B
 * investigation (the former server/.bug-b-repro.mjs harness): feed the
 * captured real-Claude pty byte-stream (claude-tui-scrollback.log) through
 * @xterm/headless and assert the webui's terminal config preserves the
 * cursor-column information. The discriminator is the count of lines that
 * carry significant leading indentation: with `convertEol: false` the
 * "keep column" writes survive as indented content; with `convertEol:
 * true` that content collapses to column 0 (the smear).
 *
 * Layers:
 *   1. The production constant — read the actual `convertEol` value out of
 *      EmbeddedTerminal.tsx (a content check across the workspace
 *      boundary, same pattern as action-schema-sync.test.ts). It MUST be
 *      `false`.
 *   2. The production config keeps a real Claude byte-stream clean —
 *      render the fixture with the value the client actually ships. If
 *      the client is ever flipped back to `convertEol: true`, this fails.
 *   3. Differential evidence lock — `convertEol: true` collapses the
 *      kept-column content; `convertEol: false` preserves it. Pins the
 *      discriminator independent of the client file.
 *
 * @xterm/headless is exact-pinned to 6.0.0 (ADR-097), matching the client
 * xterm.js — the render is deterministic.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// CJS interop — same pattern as headless-mirror.fixture.test.ts.
import pkg from "@xterm/headless";
const { Terminal } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// server/src/terminal/ → fixture sibling.
const FIXTURE_PATH = resolve(
  __dirname,
  "fixtures",
  "claude-tui-scrollback.log",
);
// server/src/terminal/ → up 3 → repo root → client component.
const CLIENT_EMBEDDED_TERMINAL = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "client",
  "src",
  "components",
  "terminal",
  "EmbeddedTerminal.tsx",
);

/**
 * A line "carries kept-column content" if it starts with at least this
 * many spaces followed by a non-space. Under correct ConPTY semantics
 * (`convertEol: false`) the bare-LF "cursor down, keep column" writes
 * produce dozens of such lines; `convertEol: true` collapses them to
 * column 0. Empirically (fixture @ 120 cols, @xterm/headless 6.0.0):
 *   convertEol: false → 68 indented lines
 *   convertEol: true  →  6 indented lines
 * Thresholds leave a wide margin on both sides of that 10x gap. The
 * discriminator is width-independent (verified 132–150 in the original
 * Bug B investigation); 120 matches the repro harness default.
 */
const INDENT_THRESHOLD = 16;
const CLEAN_MIN_INDENTED = 40;
const SMEARED_MAX_INDENTED = 15;
const RENDER_COLS = 120;
const RENDER_ROWS = 30;

/** The webui terminal scrollback size — see EmbeddedTerminal.tsx. */
const WEBUI_SCROLLBACK = 10000;

function loadFixture(): Buffer {
  return readFileSync(FIXTURE_PATH);
}

/**
 * Extract the `convertEol` value that EmbeddedTerminal.tsx actually
 * ships. Matches the property line inside `new Terminal({ ... })` —
 * anchored to line-start + leading indentation, so comment lines
 * (which begin with `//` after their indentation) never match.
 */
function readClientConvertEol(): boolean {
  const src = readFileSync(CLIENT_EMBEDDED_TERMINAL, "utf-8");
  const matches = [...src.matchAll(/^[^\S\n]*convertEol:\s*(true|false),/gm)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one \`convertEol: <bool>,\` property in ` +
        `${CLIENT_EMBEDDED_TERMINAL}, found ${matches.length}`,
    );
  }
  return matches[0][1] === "true";
}

/**
 * Render the fixture byte-stream through a headless xterm with the
 * webui's terminal config and return every buffer line (scrollback +
 * viewport), trailing whitespace trimmed.
 */
async function renderFixture(convertEol: boolean): Promise<string[]> {
  const term = new Terminal({
    cols: RENDER_COLS,
    rows: RENDER_ROWS,
    scrollback: WEBUI_SCROLLBACK,
    allowProposedApi: true,
    convertEol,
  });
  const data = loadFixture();
  await new Promise<void>((res) => {
    term.write(data, () => res());
  });
  const buffer = term.buffer.active;
  const out: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    out.push((line ? line.translateToString(true) : "").replace(/\s+$/, ""));
  }
  term.dispose();
  return out;
}

/** Count lines that start with >= INDENT_THRESHOLD spaces then content. */
function countIndentedLines(lines: string[]): number {
  const re = new RegExp(`^ {${INDENT_THRESHOLD},}\\S`);
  return lines.filter((l) => re.test(l)).length;
}

describe("EmbeddedTerminal convertEol — Bug B regression guard", () => {
  it("the fixture is a bare-LF Claude byte-stream (convertEol precondition)", () => {
    // convertEol only changes rendering when the stream contains bare LF.
    // The captured Claude/ConPTY scrollback is pure bare-LF (no CR at all);
    // if that ever stops holding, this test no longer exercises Bug B.
    const data = loadFixture();
    let bareLf = 0;
    let crlf = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0x0a && (i === 0 || data[i - 1] !== 0x0d)) bareLf++;
      if (data[i] === 0x0d && data[i + 1] === 0x0a) crlf++;
    }
    expect(bareLf).toBeGreaterThan(0);
    expect(crlf).toBe(0);
  });

  it("the production terminal config pins convertEol to false", () => {
    // Direct guard on the shipped constant. A crisp failure here means
    // someone re-flipped ADR-093's knob and re-opened Bug B.
    expect(readClientConvertEol()).toBe(false);
  });

  it("the webui terminal config renders a real Claude byte-stream without left-column smear", async () => {
    // Render with the value the client ACTUALLY ships — not a hardcoded
    // `false`. If EmbeddedTerminal.tsx is flipped back to `convertEol:
    // true`, this renders with `true`, the kept-column content collapses
    // and the assertion fails.
    const convertEol = readClientConvertEol();
    const lines = await renderFixture(convertEol);
    const indented = countIndentedLines(lines);
    expect(
      indented,
      `webui terminal config (convertEol=${convertEol}) produced only ` +
        `${indented} indented lines (expected >= ${CLEAN_MIN_INDENTED}). ` +
        `convertEol:true forces CR on bare LF and collapses kept-column ` +
        `content to column 0 — Bug B left-column smear.`,
    ).toBeGreaterThanOrEqual(CLEAN_MIN_INDENTED);
  });

  it("convertEol:true is the Bug B root cause — it collapses kept-column content to column 0", async () => {
    // Differential evidence lock, independent of the client file: prove
    // the discriminator is real and pin which direction is the bug.
    const smeared = countIndentedLines(await renderFixture(true));
    const clean = countIndentedLines(await renderFixture(false));

    // convertEol:true — the cursor is yanked to column 0 on every bare
    // LF, so almost no kept-column indentation survives.
    expect(
      smeared,
      `convertEol:true kept ${smeared} indented lines — expected <= ` +
        `${SMEARED_MAX_INDENTED} (the smear collapses content to col 0)`,
    ).toBeLessThanOrEqual(SMEARED_MAX_INDENTED);

    // convertEol:false — ConPTY "cursor down, keep column" is honoured.
    expect(clean).toBeGreaterThanOrEqual(CLEAN_MIN_INDENTED);

    // The two configs must diverge by a wide margin on the same stream.
    expect(clean).toBeGreaterThan(smeared * 2);
  });
});
