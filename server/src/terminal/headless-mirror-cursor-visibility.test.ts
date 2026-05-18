/*
 * headless-mirror-cursor-visibility.test.ts
 * — iterate-2026-05-18-fix-terminal-cursor-flicker
 *
 * Regression guard: serializeStable() MUST restore DECTCEM (the ?25
 * cursor-visibility private mode) onto the snapshot payload.
 *
 * Why this is needed — empirically established (see the iterate ADR):
 *   - @xterm/addon-serialize 0.14.0's `_serializeModes()` serializes the
 *     public IModes set + the mouse-tracking selector, but NEVER DECTCEM
 *     (?25). Confirmed against the addon-serialize source.
 *   - Claude Code running fullscreen (CLAUDE_CODE_NO_FLICKER=1, the
 *     ADR-095/098 default) enters the alt-screen and hides the cursor
 *     with ?25l, toggling visibility only ~13× across thousands of CUP
 *     redraws — and a working session ends on ?25l (cursor hidden).
 *     Confirmed against real Claude pty logs.
 *
 * Before this fix, a navigate-away-and-back reattach wrote a snapshot
 * with no ?25l into a term.reset()'d xterm (cursor → visible default),
 * so a ghost cursor appeared and jumped with every Claude CUP redraw
 * ("nur der Cursor springt hin und her über dem Spinner"). Content was
 * fine — only the un-serialized cursor mode leaked.
 *
 * Sibling workaround: replay-snapshot.ts re-appends ?1006h (SGR mouse
 * encoding) for the same class of addon-serialize mode-drop.
 */

import { afterEach, describe, expect, it } from "vitest";
import { HeadlessMirror } from "./headless-mirror.js";

const TASK = "11111111-2222-3333-4444-555555555555";
// DECTCEM — hide cursor / show cursor. Asserted as independent literals
// (not imported from the impl) so a constant rename in headless-mirror.ts
// cannot silently move with the test.
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

describe("HeadlessMirror — DECTCEM cursor-visibility restore", () => {
  let mirrors: HeadlessMirror[] = [];
  const mk = (): HeadlessMirror => {
    const m = new HeadlessMirror({ taskId: TASK, cols: 80, rows: 24 });
    mirrors.push(m);
    return m;
  };

  afterEach(() => {
    for (const m of mirrors) m.dispose();
    mirrors = [];
  });

  it("emits ?25l when the cursor is hidden (Claude fullscreen pattern)", async () => {
    const m = mk();
    // Claude fullscreen: enter alt-screen, home, hide cursor, paint.
    await m.write("\x1b[?1049h\x1b[H\x1b[?25lworking…");
    const stable = await m.serializeStable();
    expect(stable).toContain(CURSOR_HIDE);
    expect(stable).not.toContain(CURSOR_SHOW);
  });

  it("emits ?25h when the cursor is visible (default state)", async () => {
    const m = mk();
    await m.write("plain shell output");
    const stable = await m.serializeStable();
    expect(stable).toContain(CURSOR_SHOW);
    expect(stable).not.toContain(CURSOR_HIDE);
  });

  it("reflects the LAST toggle — hide → show → hide ends hidden", async () => {
    const m = mk();
    await m.write(`${CURSOR_HIDE}a${CURSOR_SHOW}b${CURSOR_HIDE}c`);
    const stable = await m.serializeStable();
    expect(stable).toContain(CURSOR_HIDE);
    expect(stable).not.toContain(CURSOR_SHOW);
  });

  it("reflects the LAST toggle — hide → show ends visible", async () => {
    const m = mk();
    await m.write(`${CURSOR_HIDE}a${CURSOR_SHOW}b`);
    const stable = await m.serializeStable();
    expect(stable).toContain(CURSOR_SHOW);
    expect(stable).not.toContain(CURSOR_HIDE);
  });

  it("round-trip: replaying a hidden-cursor snapshot re-serializes with ?25l", async () => {
    // Producer → snapshot → consumer round-trip (touches_io_boundary
    // probe). The consumer xterm must actually PROCESS the restored
    // ?25l, so its own re-serialize carries the hidden state forward.
    const producer = mk();
    await producer.write("\x1b[?1049h\x1b[H\x1b[?25lspinner frame");
    const snap1 = await producer.serializeStable();
    expect(snap1).toContain(CURSOR_HIDE);

    const consumer = mk();
    await consumer.write(snap1);
    const snap2 = await consumer.serializeStable();
    expect(snap2).toContain(CURSOR_HIDE);
  });

  it("round-trip: replaying a visible-cursor snapshot re-serializes with ?25h", async () => {
    const producer = mk();
    await producer.write("visible shell prompt");
    const snap1 = await producer.serializeStable();
    expect(snap1).toContain(CURSOR_SHOW);

    const consumer = mk();
    await consumer.write(snap1);
    const snap2 = await consumer.serializeStable();
    expect(snap2).toContain(CURSOR_SHOW);
    expect(snap2).not.toContain(CURSOR_HIDE);
  });
});
