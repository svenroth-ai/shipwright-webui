/*
 * deriveTerminalReset — unit truth-table for the `terminalReset` field
 * the WS `ready` envelope carries (iterate-20260515-terminal-smear-reset,
 * ADR-104).
 *
 * Contract: `terminalReset` is true exactly when THIS WS attach freshly
 * created the pty (`ptyManager.get` was undefined immediately before
 * `spawn`) AND the task already had a Claude session (`firstJsonlObservedAt`
 * set). That is the "the previous embedded terminal was lost — a server
 * restart / crash killed the pty mid-session" signal that drives the
 * EmbeddedTerminal reset banner.
 *
 * The route-level wiring (envelope actually carries the field) is covered
 * by the Playwright web-surface E2E; this file locks the truth table.
 */

import { describe, expect, it } from "vitest";
import { deriveTerminalReset } from "./terminal-reset.js";

describe("deriveTerminalReset", () => {
  it("fresh pty + prior Claude session → true (the reset case)", () => {
    expect(deriveTerminalReset(false, "2026-05-15T13:09:26.453Z")).toBe(true);
  });

  it("fresh pty + NO prior session → false (first-ever launch)", () => {
    expect(deriveTerminalReset(false, undefined)).toBe(false);
    expect(deriveTerminalReset(false, null)).toBe(false);
    expect(deriveTerminalReset(false, "")).toBe(false);
  });

  it("re-attach to a LIVE pty → false regardless of prior session", () => {
    // Navigate-away-and-back: detach never kills the pty, so spawn()
    // returns the existing handle — not a reset.
    expect(deriveTerminalReset(true, "2026-05-15T13:09:26.453Z")).toBe(false);
    expect(deriveTerminalReset(true, undefined)).toBe(false);
  });
});
