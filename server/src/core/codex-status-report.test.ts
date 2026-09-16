/*
 * codex-status-report.test.ts — §5.4's fenced SHIPWRIGHT-STATUS parser.
 */
import { describe, expect, it } from "vitest";

import { parseShipwrightStatusReport } from "./codex-status-report.js";

describe("parseShipwrightStatusReport", () => {
  it("parses a well-formed fenced block", () => {
    const text = 'Some scrollback text\n```SHIPWRIGHT-STATUS\n{"phase":"build","done":true}\n```\nmore text';
    expect(parseShipwrightStatusReport(text)).toEqual({ phase: "build", done: true });
  });

  it("returns null when no fenced block is present", () => {
    expect(parseShipwrightStatusReport("plain terminal output, nothing structured")).toBeNull();
  });

  it("returns null for the English-prose mention inside the nudge prompt (no real fence)", () => {
    const prose =
      "[Shipwright] Still there? If you're finished, wrap up and close with your " +
      "SHIPWRIGHT-STATUS block. If not, please continue.";
    expect(parseShipwrightStatusReport(prose)).toBeNull();
  });

  it("done:false parses correctly (not treated as completion)", () => {
    const text = '```SHIPWRIGHT-STATUS\n{"phase":"test","done":false}\n```';
    expect(parseShipwrightStatusReport(text)).toEqual({ phase: "test", done: false });
  });

  it("skips a malformed block and keeps scanning for an earlier well-formed one", () => {
    const text =
      '```SHIPWRIGHT-STATUS\n{"phase":"build","done":true}\n```\n' +
      "then later, truncated by a viewport cut:\n" +
      '```SHIPWRIGHT-STATUS\n{"phase":"buil';
    expect(parseShipwrightStatusReport(text)).toEqual({ phase: "build", done: true });
  });

  it("returns the LAST well-formed block when multiple are present", () => {
    const text =
      '```SHIPWRIGHT-STATUS\n{"phase":"build","done":false}\n```\n' +
      "...more work happens...\n" +
      '```SHIPWRIGHT-STATUS\n{"phase":"build","done":true}\n```';
    expect(parseShipwrightStatusReport(text)).toEqual({ phase: "build", done: true });
  });

  it("returns null when the JSON has no boolean done field", () => {
    const text = '```SHIPWRIGHT-STATUS\n{"phase":"build"}\n```';
    expect(parseShipwrightStatusReport(text)).toBeNull();
  });

  it("defaults phase to empty string when omitted", () => {
    const text = '```SHIPWRIGHT-STATUS\n{"done":true}\n```';
    expect(parseShipwrightStatusReport(text)).toEqual({ phase: "", done: true });
  });
});
