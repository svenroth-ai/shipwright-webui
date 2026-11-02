import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { SIDEBAR_DEFAULT, useMissionSidebar } from "./useMissionSidebar";

const KEY = "shipwright:mission-sidebar";

describe("useMissionSidebar stored width", () => {
  beforeEach(() => localStorage.clear());
  // @covers FR-01.66
  it("a width stored by the pre-polish default (320) falls back to the new default so both tabs line up", () => {
    localStorage.setItem(KEY, JSON.stringify({ width: 320, collapsed: false, segment: "viewer" }));
    const { result } = renderHook(() => useMissionSidebar());
    expect(result.current.width).toBe(SIDEBAR_DEFAULT);
    expect(result.current.segment).toBe("viewer");
  });
  // @covers FR-01.66
  it("a width the user set to 320 on purpose survives a remount", () => {
    const first = renderHook(() => useMissionSidebar());
    act(() => first.result.current.setWidth(320));
    first.unmount();
    expect(renderHook(() => useMissionSidebar()).result.current.width).toBe(320);
  });
  // @covers FR-01.66
  it("a deliberately dragged width is kept", () => {
    localStorage.setItem(KEY, JSON.stringify({ width: 450, collapsed: false, segment: "info" }));
    expect(renderHook(() => useMissionSidebar()).result.current.width).toBe(450);
  });
});
