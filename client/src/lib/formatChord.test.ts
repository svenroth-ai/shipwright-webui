/*
 * formatChord — AC3: both chords, Windows-correct by DEFAULT. A Mac-only
 * `⌘K` hint anywhere is a failure; detection defaults to Ctrl when unknown.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  chordForms,
  detectPlatform,
  formatChord,
  formatChordFor,
} from "./formatChord";

function setPlatform(value: string | undefined) {
  Object.defineProperty(navigator, "platform", {
    value,
    configurable: true,
  });
}

const originalPlatform = navigator.platform;
afterEach(() => setPlatform(originalPlatform));

describe("formatChordFor — explicit platform", () => {
  // @covers FR-01.65
  it("renders Ctrl+K on Windows/Linux", () => {
    expect(formatChordFor({ mod: true, key: "K" }, "other")).toBe("Ctrl+K");
  });
  // @covers FR-01.65
  it("renders ⌘K on Mac", () => {
    expect(formatChordFor({ mod: true, key: "K" }, "mac")).toBe("⌘K");
  });
  // @covers FR-01.65
  it("renders a bare key identically on both platforms", () => {
    expect(formatChordFor({ key: "?" }, "other")).toBe("?");
    expect(formatChordFor({ key: "?" }, "mac")).toBe("?");
    expect(formatChordFor({ key: "Enter" }, "other")).toBe("Enter");
  });
  // @covers FR-01.65
  it("orders modifiers correctly", () => {
    expect(formatChordFor({ mod: true, shift: true, key: "P" }, "other")).toBe(
      "Ctrl+Shift+P",
    );
    expect(formatChordFor({ mod: true, shift: true, key: "P" }, "mac")).toBe(
      "⇧⌘P",
    );
  });
});

describe("detectPlatform — defaults to Ctrl when unknown", () => {
  // @covers FR-01.65
  it("returns 'mac' only on a positive Mac signal", () => {
    setPlatform("MacIntel");
    expect(detectPlatform()).toBe("mac");
    expect(formatChord({ mod: true, key: "K" })).toBe("⌘K");
  });
  // @covers FR-01.65
  it("returns 'other' on a Windows signal", () => {
    setPlatform("Win32");
    expect(detectPlatform()).toBe("other");
    expect(formatChord({ mod: true, key: "K" })).toBe("Ctrl+K");
  });
  // @covers FR-01.65
  it("returns 'other' (Ctrl) when the platform is blank/inconclusive", () => {
    setPlatform("");
    // Falls through to userAgent (jsdom's, which is not a Mac) → default Ctrl.
    expect(detectPlatform()).toBe("other");
    expect(formatChord({ mod: true, key: "K" })).toBe("Ctrl+K");
  });
});

describe("chordForms — both columns for the cheat-sheet", () => {
  // @covers FR-01.65
  it("exposes a Windows AND a Mac string", () => {
    expect(chordForms({ mod: true, key: "K" })).toEqual({
      windows: "Ctrl+K",
      mac: "⌘K",
    });
  });
});
