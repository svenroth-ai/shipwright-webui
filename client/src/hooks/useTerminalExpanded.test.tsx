import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useTerminalExpanded } from "./useTerminalExpanded";

describe("useTerminalExpanded (shared by the header and the Files and Terminal tab bar)", () => {
  // @covers FR-01.66
  it("two consumers share one state, mirrored to <html data-term-expanded>", () => {
    const a = renderHook(() => useTerminalExpanded());
    const b = renderHook(() => useTerminalExpanded());
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1]());
    expect(b.result.current[0]).toBe(true);
    expect(document.documentElement.hasAttribute("data-term-expanded")).toBe(true);
    act(() => b.result.current[1]());
    expect(a.result.current[0]).toBe(false);
    expect(document.documentElement.hasAttribute("data-term-expanded")).toBe(false);
    a.unmount();
    b.unmount();
  });

  // @covers FR-01.66
  it("clears the flag when the last consumer unmounts", () => {
    const a = renderHook(() => useTerminalExpanded());
    act(() => a.result.current[1]());
    a.unmount();
    expect(document.documentElement.hasAttribute("data-term-expanded")).toBe(false);
  });
});
