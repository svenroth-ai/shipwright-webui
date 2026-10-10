import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  KEYBOARD_MIN_PX,
  computeKeyboardFit,
  useKeyboardViewportFit,
} from "./useKeyboardViewportFit";

describe("computeKeyboardFit", () => {
  it("treats a URL-bar sized shrink as NOT a keyboard", () => {
    const fit = computeKeyboardFit(800, 800 - (KEYBOARD_MIN_PX - 1), 0, true);
    expect(fit.open).toBe(false);
    expect(fit.terminal).toBe(false);
  });

  it("detects the keyboard and mirrors the visual viewport box", () => {
    const fit = computeKeyboardFit(800, 480.4, 31.6, false);
    expect(fit).toEqual({ open: true, terminal: false, height: 480, top: 32, bottom: 288 });
  });

  it("flags terminal focus only while the keyboard is open", () => {
    expect(computeKeyboardFit(800, 450, 0, true).terminal).toBe(true);
    expect(computeKeyboardFit(800, 800, 0, true).terminal).toBe(false);
  });

  it("does not mistake a pinch-zoom (scale 2) for a keyboard", () => {
    expect(computeKeyboardFit(820, 410, 0, true, 2).open).toBe(false);
  });

  it("never reports a negative top", () => {
    expect(computeKeyboardFit(800, 450, -12, false).top).toBe(0);
  });
});

describe("useKeyboardViewportFit", () => {
  const originalMatchMedia = window.matchMedia;
  const originalVv = Object.getOwnPropertyDescriptor(window, "visualViewport");

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalVv) Object.defineProperty(window, "visualViewport", originalVv);
    else delete (window as unknown as Record<string, unknown>).visualViewport;
    document.documentElement.removeAttribute("data-kbd-open");
    document.documentElement.style.removeProperty("--app-vh");
  });

  function install(coarse: boolean, vvHeight: number) {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: coarse && q === "(pointer: coarse)",
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: vvHeight,
        offsetTop: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  }

  it("sets --app-vh + data-kbd-open on a coarse pointer with the keyboard up, and cleans up", () => {
    install(true, window.innerHeight - 300);
    const { unmount } = renderHook(() => useKeyboardViewportFit());
    const root = document.documentElement;
    expect(root.hasAttribute("data-kbd-open")).toBe(true);
    expect(root.style.getPropertyValue("--app-vh")).toBe(`${window.innerHeight - 300}px`);
    unmount();
    expect(root.hasAttribute("data-kbd-open")).toBe(false);
    expect(root.style.getPropertyValue("--app-vh")).toBe("");
  });

  it("is inert on a fine pointer (desktop)", () => {
    install(false, window.innerHeight - 300);
    renderHook(() => useKeyboardViewportFit());
    expect(document.documentElement.hasAttribute("data-kbd-open")).toBe(false);
  });
});
