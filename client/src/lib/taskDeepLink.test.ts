/*
 * taskDeepLink — the ONE place that builds/reads the "open this task's
 * terminal" deep link (A19, FR-01.63). RED-first: this file imports a module
 * that does not exist yet, so it fails at import time until taskDeepLink.ts
 * lands.
 *
 * The contract it pins:
 *   - buildTaskTerminalDeepLink(taskId) → `/tasks/<enc>?pane=terminal&focus=terminal`
 *   - parseTerminalFocusIntent(search)  → true when the pane/focus intent is present
 *   - round-trips: what build() writes, parse() reads back as `true`
 *
 * There is deliberately NO write-path here — this module only navigates.
 */
import { describe, it, expect } from "vitest";
import {
  buildTaskTerminalDeepLink,
  parseTerminalFocusIntent,
} from "./taskDeepLink";

describe("taskDeepLink — build", () => {
  // @covers FR-01.04
  it("builds /tasks/<id>?pane=terminal&focus=terminal", () => {
    expect(buildTaskTerminalDeepLink("task-A")).toBe(
      "/tasks/task-A?pane=terminal&focus=terminal",
    );
  });

  // @covers FR-01.04
  it("URL-encodes the taskId (no query-string literal leaks a raw slash)", () => {
    expect(buildTaskTerminalDeepLink("a/b c")).toBe(
      "/tasks/a%2Fb%20c?pane=terminal&focus=terminal",
    );
  });
});

describe("taskDeepLink — parse", () => {
  // @covers FR-01.04
  it("true when both pane + focus name the terminal", () => {
    expect(parseTerminalFocusIntent("?pane=terminal&focus=terminal")).toBe(true);
  });

  // @covers FR-01.04
  it("true when only pane=terminal is present", () => {
    expect(parseTerminalFocusIntent("?pane=terminal")).toBe(true);
  });

  // @covers FR-01.04
  it("true when only focus=terminal is present", () => {
    expect(parseTerminalFocusIntent("?focus=terminal")).toBe(true);
  });

  // @covers FR-01.04
  it("tolerates a leading-'?'-less search string", () => {
    expect(parseTerminalFocusIntent("pane=terminal")).toBe(true);
  });

  // @covers FR-01.04
  it("false for an empty search", () => {
    expect(parseTerminalFocusIntent("")).toBe(false);
  });

  // @covers FR-01.04
  it("false for an unrelated query", () => {
    expect(parseTerminalFocusIntent("?foo=bar")).toBe(false);
  });

  // @covers FR-01.04
  it("false when the value is not 'terminal'", () => {
    expect(parseTerminalFocusIntent("?pane=files&focus=transcript")).toBe(false);
  });
});

describe("taskDeepLink — round trip", () => {
  // @covers FR-01.04
  it("what build() writes, parse() reads back as true", () => {
    const link = buildTaskTerminalDeepLink("round-trip-task");
    const search = link.slice(link.indexOf("?"));
    expect(parseTerminalFocusIntent(search)).toBe(true);
  });
});
