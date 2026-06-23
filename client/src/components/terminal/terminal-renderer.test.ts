/*
 * terminal-renderer.test — diagnostic renderer override resolver
 * (iterate-2026-06-23). Pure resolver is exhaustively tested; the impure
 * window/localStorage reader gets a couple of jsdom-backed checks.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  resolveTerminalRenderer,
  getTerminalRendererOverride,
  RENDERER_STORAGE_KEY,
} from "./terminal-renderer";

describe("resolveTerminalRenderer", () => {
  it("defaults to webgl with no query and no storage", () => {
    expect(resolveTerminalRenderer({})).toBe("webgl");
    expect(resolveTerminalRenderer({ search: null, storageValue: null })).toBe("webgl");
    expect(resolveTerminalRenderer({ search: "", storageValue: "" })).toBe("webgl");
  });

  it("returns dom when storage value is dom", () => {
    expect(resolveTerminalRenderer({ storageValue: "dom" })).toBe("dom");
  });

  it("returns dom when the query opts in", () => {
    expect(resolveTerminalRenderer({ search: "?terminalRenderer=dom" })).toBe("dom");
    expect(resolveTerminalRenderer({ search: "?foo=1&terminalRenderer=dom&bar=2" })).toBe("dom");
  });

  it("lets the query override persisted storage in BOTH directions", () => {
    // query=webgl forces the default back even with dom persisted
    expect(
      resolveTerminalRenderer({ search: "?terminalRenderer=webgl", storageValue: "dom" }),
    ).toBe("webgl");
    // query=dom wins over an absent/other storage value
    expect(
      resolveTerminalRenderer({ search: "?terminalRenderer=dom", storageValue: "webgl" }),
    ).toBe("dom");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveTerminalRenderer({ storageValue: "DOM" })).toBe("dom");
    expect(resolveTerminalRenderer({ storageValue: "  dom  " })).toBe("dom");
    expect(resolveTerminalRenderer({ search: "?terminalRenderer=DOM" })).toBe("dom");
  });

  it("treats any unknown value as the webgl default", () => {
    expect(resolveTerminalRenderer({ storageValue: "canvas" })).toBe("webgl");
    expect(resolveTerminalRenderer({ search: "?terminalRenderer=svg" })).toBe("webgl");
  });

  it("never throws on a malformed search string (falls back to webgl)", () => {
    expect(() => resolveTerminalRenderer({ search: "%%%not a query%%%" })).not.toThrow();
    expect(resolveTerminalRenderer({ search: "%%%not a query%%%" })).toBe("webgl");
  });
});

describe("getTerminalRendererOverride (window/localStorage glue)", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(RENDERER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });

  it("defaults to webgl with nothing set", () => {
    expect(getTerminalRendererOverride()).toBe("webgl");
  });

  it("reads the dom override from localStorage", () => {
    window.localStorage.setItem(RENDERER_STORAGE_KEY, "dom");
    expect(getTerminalRendererOverride()).toBe("dom");
  });
});
