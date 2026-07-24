/*
 * terminal-renderer.test — renderer selection resolver.
 *
 * Originally the iterate-2026-06-23 diagnostic A/B. Since
 * iterate-2026-07-24-terminal-scroll-atlas-smear the polarity is INVERTED:
 * the DOM renderer is the default and WebGL (GPU acceleration) is opt-in,
 * because the WebGL glyph texture atlas is the root cause of the wrong-letter
 * "smear" class. These tests pin that default in both directions so a future
 * change cannot silently put the corrupting renderer back in front of users.
 *
 * Pure resolver is exhaustively tested; the impure window/localStorage reader
 * and the Settings writer get jsdom-backed checks.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  resolveTerminalRenderer,
  getTerminalRendererOverride,
  isGpuAccelerationEnabled,
  isRendererOverriddenByQuery,
  setGpuAccelerationEnabled,
  DEFAULT_TERMINAL_RENDERER,
  RENDERER_STORAGE_KEY,
} from "./terminal-renderer";

describe("resolveTerminalRenderer", () => {
  it("defaults to dom with no query and no storage (GPU is opt-in)", () => {
    expect(resolveTerminalRenderer({})).toBe("dom");
    expect(resolveTerminalRenderer({ search: null, storageValue: null })).toBe("dom");
    expect(resolveTerminalRenderer({ search: "", storageValue: "" })).toBe("dom");
  });

  it("exports the default as a named constant matching the resolver", () => {
    expect(DEFAULT_TERMINAL_RENDERER).toBe("dom");
    expect(resolveTerminalRenderer({})).toBe(DEFAULT_TERMINAL_RENDERER);
  });

  it("returns webgl when storage opts in", () => {
    expect(resolveTerminalRenderer({ storageValue: "webgl" })).toBe("webgl");
  });

  it("returns webgl when the query opts in", () => {
    expect(resolveTerminalRenderer({ search: "?terminalRenderer=webgl" })).toBe("webgl");
    expect(
      resolveTerminalRenderer({ search: "?foo=1&terminalRenderer=webgl&bar=2" }),
    ).toBe("webgl");
  });

  it("lets the query override persisted storage in BOTH directions", () => {
    // query=dom forces the safe default back even with webgl persisted
    expect(
      resolveTerminalRenderer({ search: "?terminalRenderer=dom", storageValue: "webgl" }),
    ).toBe("dom");
    // query=webgl opts in over an absent/other storage value
    expect(
      resolveTerminalRenderer({ search: "?terminalRenderer=webgl", storageValue: "dom" }),
    ).toBe("webgl");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveTerminalRenderer({ storageValue: "WEBGL" })).toBe("webgl");
    expect(resolveTerminalRenderer({ storageValue: "  webgl  " })).toBe("webgl");
    expect(resolveTerminalRenderer({ search: "?terminalRenderer=WEBGL" })).toBe("webgl");
  });

  it("treats any unknown value as the dom default (fail toward safe)", () => {
    expect(resolveTerminalRenderer({ storageValue: "canvas" })).toBe("dom");
    expect(resolveTerminalRenderer({ search: "?terminalRenderer=svg" })).toBe("dom");
  });

  it("never throws on a malformed search string (falls back to dom)", () => {
    expect(() => resolveTerminalRenderer({ search: "%%%not a query%%%" })).not.toThrow();
    expect(resolveTerminalRenderer({ search: "%%%not a query%%%" })).toBe("dom");
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

  it("defaults to dom with nothing set", () => {
    expect(getTerminalRendererOverride()).toBe("dom");
  });

  it("reads the webgl opt-in from localStorage", () => {
    window.localStorage.setItem(RENDERER_STORAGE_KEY, "webgl");
    expect(getTerminalRendererOverride()).toBe("webgl");
  });

  it("keeps honouring a pre-existing 'dom' value written before the flip", () => {
    // Back-compat: the storage KEY is unchanged, so a user who pinned "dom"
    // during the 2026-06-23 A/B keeps exactly what they chose.
    window.localStorage.setItem(RENDERER_STORAGE_KEY, "dom");
    expect(getTerminalRendererOverride()).toBe("dom");
  });
});

describe("GPU-acceleration preference (Settings checkbox)", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(RENDERER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });

  it("reports disabled by default", () => {
    expect(isGpuAccelerationEnabled()).toBe(false);
  });

  it("round-trips enable → disable through storage", () => {
    setGpuAccelerationEnabled(true);
    expect(window.localStorage.getItem(RENDERER_STORAGE_KEY)).toBe("webgl");
    expect(isGpuAccelerationEnabled()).toBe(true);
    expect(getTerminalRendererOverride()).toBe("webgl");

    setGpuAccelerationEnabled(false);
    expect(window.localStorage.getItem(RENDERER_STORAGE_KEY)).toBe("dom");
    expect(isGpuAccelerationEnabled()).toBe(false);
    expect(getTerminalRendererOverride()).toBe("dom");
  });

  // External code review (medium): binding the checkbox to the EFFECTIVE
  // renderer made it lie. With ?terminalRenderer=webgl and nothing stored it
  // showed checked; un-checking it then showed unchecked while the query kept
  // WebGL alive on the next mount. The stored preference is the checkbox's
  // truth; the query override is reported separately.
  it("reports the STORED preference, ignoring a ?terminalRenderer= query override", () => {
    const original = window.location.search;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { search: "?terminalRenderer=webgl" },
    });
    try {
      // Nothing stored → the setting is OFF even though WebGL is what renders.
      expect(isGpuAccelerationEnabled()).toBe(false);
      expect(getTerminalRendererOverride()).toBe("webgl");
      expect(isRendererOverriddenByQuery()).toBe(true);

      // Storing the matching value makes the override agree — no note needed.
      setGpuAccelerationEnabled(true);
      expect(isGpuAccelerationEnabled()).toBe(true);
      expect(isRendererOverriddenByQuery()).toBe(false);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { search: original },
      });
    }
  });

  it("reports no query override when the URL carries none", () => {
    setGpuAccelerationEnabled(true);
    expect(isRendererOverriddenByQuery()).toBe(false);
  });

  it("writes an explicit renderer name rather than removing the key", () => {
    // Keeps the stored value greppable and stable across a future default
    // change — "unset" and "explicitly off" must stay distinguishable.
    setGpuAccelerationEnabled(false);
    expect(window.localStorage.getItem(RENDERER_STORAGE_KEY)).not.toBeNull();
  });
});
