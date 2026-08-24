/*
 * terminal-mouse-report.test — the right-button SGR-mouse-report classifier
 * (iterate-2026-07-07-terminal-rightclick-double-paste) plus the reader-
 * scroll/copy outbound classification (iterate-2026-08-24-terminal-readonly-
 * scroll-copy).
 */
import { describe, it, expect } from "vitest";
import {
  isRightButtonMouseReport,
  isMouseReport,
  classifyOutboundTerminalData,
} from "./terminal-mouse-report";

const ESC = String.fromCharCode(27);
/** Build a SGR mouse report `ESC [ < Cb ; x ; y (M|m)`. */
const sgr = (cb: number, x = 10, y = 5, release = false): string =>
  ESC + "[<" + cb + ";" + x + ";" + y + (release ? "m" : "M");

describe("isRightButtonMouseReport", () => {
  it("matches a right-button press (Cb=2)", () => {
    expect(isRightButtonMouseReport(sgr(2))).toBe(true);
  });
  it("matches a right-button release (m)", () => {
    expect(isRightButtonMouseReport(sgr(2, 10, 5, true))).toBe(true);
  });
  it("matches a right-button drag/motion (Cb=34 = 2+32)", () => {
    expect(isRightButtonMouseReport(sgr(34))).toBe(true);
  });
  it("matches right + Shift (Cb=6 = 2+4)", () => {
    expect(isRightButtonMouseReport(sgr(6))).toBe(true);
  });

  it("does NOT match the left button (Cb=0)", () => {
    expect(isRightButtonMouseReport(sgr(0))).toBe(false);
  });
  it("does NOT match the middle button (Cb=1)", () => {
    expect(isRightButtonMouseReport(sgr(1))).toBe(false);
  });
  it("does NOT match a left drag (Cb=32)", () => {
    expect(isRightButtonMouseReport(sgr(32))).toBe(false);
  });
  it("does NOT match wheel up/down (Cb=64/65)", () => {
    expect(isRightButtonMouseReport(sgr(64))).toBe(false);
    expect(isRightButtonMouseReport(sgr(65))).toBe(false);
  });
  it("does NOT match wheel Cb=66 (>=64 excluded even though low bits == 2)", () => {
    expect(isRightButtonMouseReport(sgr(66))).toBe(false);
  });

  it("does NOT match plain keyboard / paste / control data", () => {
    expect(isRightButtonMouseReport("hello")).toBe(false);
    expect(isRightButtonMouseReport("\r")).toBe(false);
    expect(isRightButtonMouseReport("")).toBe(false); // Ctrl+C / SIGINT
    expect(
      isRightButtonMouseReport(ESC + "[200~pasted text" + ESC + "[201~"),
    ).toBe(false); // bracketed paste
  });
  it("does NOT match a legacy X10 mouse report (not SGR)", () => {
    expect(isRightButtonMouseReport(ESC + "[M !!")).toBe(false);
  });
  it("does NOT match a SGR report embedded in a larger string", () => {
    // Anchored match: a report must be the whole frame (xterm emits it alone).
    expect(isRightButtonMouseReport("x" + sgr(2))).toBe(false);
    expect(isRightButtonMouseReport(sgr(2) + "y")).toBe(false);
  });
});

describe("isMouseReport", () => {
  it("matches left/middle/right press and release", () => {
    expect(isMouseReport(sgr(0))).toBe(true);
    expect(isMouseReport(sgr(1))).toBe(true);
    expect(isMouseReport(sgr(2, 10, 5, true))).toBe(true);
  });
  it("matches wheel up/down", () => {
    expect(isMouseReport(sgr(64))).toBe(true);
    expect(isMouseReport(sgr(65))).toBe(true);
  });
  it("matches drag/motion reports", () => {
    expect(isMouseReport(sgr(32))).toBe(true); // left drag
    expect(isMouseReport(sgr(34))).toBe(true); // right drag
  });
  it("does NOT match plain keyboard / paste / control data", () => {
    expect(isMouseReport("hello")).toBe(false);
    expect(isMouseReport("\r")).toBe(false);
    expect(isMouseReport("")).toBe(false);
    expect(isMouseReport(ESC + "[A")).toBe(false); // cursor-up (wheel→arrow fallback)
  });
  it("does NOT match a legacy X10 mouse report (not SGR)", () => {
    expect(isMouseReport(ESC + "[M !!")).toBe(false);
  });
});

describe("classifyOutboundTerminalData", () => {
  it("drops a right-button report (null)", () => {
    expect(classifyOutboundTerminalData(sgr(2))).toBeNull();
  });
  it("tags a left-button click as 'mouse' (reader scroll/copy exception)", () => {
    expect(classifyOutboundTerminalData(sgr(0))).toEqual({
      type: "mouse",
      payload: sgr(0),
    });
  });
  it("tags a wheel report as 'mouse'", () => {
    expect(classifyOutboundTerminalData(sgr(64))).toEqual({
      type: "mouse",
      payload: sgr(64),
    });
  });
  it("tags plain keystrokes/paste as 'data' (writer-only, unchanged)", () => {
    expect(classifyOutboundTerminalData("ls\n")).toEqual({
      type: "data",
      payload: "ls\n",
    });
    expect(
      classifyOutboundTerminalData(ESC + "[200~pasted text" + ESC + "[201~"),
    ).toEqual({
      type: "data",
      payload: ESC + "[200~pasted text" + ESC + "[201~",
    });
  });
  it("tags a wheel→arrow-key fallback (mouse-tracking off) as plain 'data' — content alone can't distinguish it from a real arrow keypress", () => {
    // Scoped decision: only genuine SGR mouse-report bytes get the reader
    // exception. A real arrow keystroke and touch-scroll's alt-buffer
    // fallback-to-arrows (touch-scroll.ts) are byte-identical, so widening
    // this to arrow keys would let a reader's real keypresses through too.
    expect(classifyOutboundTerminalData(ESC + "[A")).toEqual({
      type: "data",
      payload: ESC + "[A",
    });
  });
});
