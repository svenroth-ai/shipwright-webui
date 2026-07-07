/*
 * terminal-mouse-report.test — the right-button SGR-mouse-report classifier
 * (iterate-2026-07-07-terminal-rightclick-double-paste).
 */
import { describe, it, expect } from "vitest";
import { isRightButtonMouseReport } from "./terminal-mouse-report";

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
