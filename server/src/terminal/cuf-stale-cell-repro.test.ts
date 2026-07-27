/*
 * cuf-stale-cell-repro.test.ts — the MECHANISM behind the embedded-terminal
 * letter-level "smear", pinned deterministically (iterate-2026-07-27, FR-01.28).
 *
 * WHY THIS FILE EXISTS. The smear class survived eight fixes, and the eighth
 * (PR #325, DOM renderer by default) removed a REAL but DIFFERENT mechanism —
 * the WebGL glyph atlas, which drew wrong PIXELS for correct BUFFER content.
 * The user reported the defect again on the very next build, which falsified
 * "the atlas is the root cause" (CLAUDE.md rule 28's wording, since softened).
 *
 * The mechanism this file pins is renderer-INDEPENDENT, which is exactly why it
 * survived that flip: Claude Code repaints the screen DIFFERENTIALLY. It emits
 * CUP to address a row, then `ESC [ 1 C` (CUF, cursor-forward) to SKIP every
 * cell it believes already holds the right glyph — verbatim from a real pty
 * scrollback log, it never writes a single space:
 *
 *   ESC[7;3H⚠️ESC[1Cmarkiert.ESC[1CIchESC[1Chatte…
 *   bereits ESC[1CrfolESC[1CreichenESC[1CLESC[1Cbel-Lauf   ← skips letters MID-WORD
 *
 * CUF does not erase. So the outcome depends ENTIRELY on what the target row
 * already held when those bytes arrive:
 *   - the intended text  → skipping is correct        → renders clean
 *   - a blank row        → skipped cells stay blank   → renders clean
 *   - DIFFERENT text     → stale characters show      → THE DEFECT
 *
 * That third case is what a restored cell-state snapshot (ADR-087) produces: a
 * grid Claude never drew. The fix is the post-replay redraw nudge
 * (`PtyManager.forceRedraw` + the client `redraw` frame), which makes Claude
 * repaint from scratch instead of trusting its stale screen model.
 *
 * These tests assert ABSOLUTE expectations, not just an A/B — a differential
 * alone cannot distinguish "both right" from "both wrong"
 * (memory: differential probes cannot find defects present in both versions).
 */

import { describe, it, expect } from "vitest";
import { Terminal } from "@xterm/headless";

/** The ESC byte, from its code point so no editor or tool can mangle it. */
const ESC = String.fromCharCode(27);

/**
 * Verbatim differential repaint captured from a real session's pty scrollback
 * (`025fe6a8-….log`). Every inter-word gap is a CUF hop, never a space.
 */
const REDRAW =
  `${ESC}[7;3H⚠️${ESC}[1Cmarkiert.${ESC}[1CIch${ESC}[1Chatte` +
  `${ESC}[1Csie${ESC}[1Cund${ESC}[1Chabe${ESC}[1Csie${ESC}[1Cnicht${ESC}[1Cangewandt.`;

/** What the user must end up seeing. */
const INTENDED = "⚠️ markiert. Ich hatte sie und habe sie nicht angewandt.";

/** A plausible previous frame — same shape, different words. */
const STALE_FRAME =
  "⚠️xmarkiert.xIchxkonntexsie.undthabexsiexnichtxangewandt.";

const write = (t: Terminal, d: string): Promise<void> =>
  new Promise((resolve) => t.write(d, resolve));

function makeTerm(): Terminal {
  return new Terminal({ cols: 100, rows: 40, allowProposedApi: true });
}

/**
 * Row 7 as text. Compared TRIMMED on purpose: `CUP 7;3` indents by two
 * columns, and a naive equality check flags that indent as a defect (it did,
 * on the first run of this probe).
 */
function row7(t: Terminal): string {
  return (t.buffer.active.getLine(6)?.translateToString(true) ?? "").trim();
}

async function renderOnto(prime: string | null): Promise<string> {
  const term = makeTerm();
  if (prime !== null) await write(term, `${ESC}[7;3H${prime}`);
  await write(term, REDRAW);
  return row7(term);
}

describe("CUF differential repaint — stale cells are the smear mechanism", () => {
  it("renders correctly when the buffer AGREES with Claude's screen model", async () => {
    expect(await renderOnto(INTENDED)).toBe(INTENDED.trim());
  });

  it("renders correctly onto a BLANK row (a skipped blank cell reads as a space)", async () => {
    // This is why a freshly-opened terminal never shows the defect — and why it
    // looked intermittent for months.
    expect(await renderOnto(null)).toBe(INTENDED.trim());
  });

  it("CORRUPTS when the buffer holds DIFFERENT text under the skipped cells", async () => {
    const got = await renderOnto(STALE_FRAME);
    // The defect, stated absolutely: the row is NOT what the user should see.
    expect(got).not.toBe(INTENDED.trim());
    // And specifically: stale characters survive where spaces belong. This is
    // the exact artifact from the user's screenshot (`sie.undthabe`).
    expect(got).toContain("hattee");
    expect(got).toContain("undd");
    expect(got).not.toContain("hatte sie und habe");
  });

  it("the SAME bytes produce opposite outcomes — so the fault is buffer/model divergence, not the renderer", async () => {
    const agreeing = await renderOnto(INTENDED);
    const diverged = await renderOnto(STALE_FRAME);
    expect(agreeing).toBe(INTENDED.trim());
    expect(diverged).not.toBe(agreeing);
  });
});
