import { renderHook } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refused = vi.fn();
vi.mock("../../lib/sessionFileApi", () => ({ isRefusedBySession: (...a: unknown[]) => refused(...a) }));

import { openTerminalFileLink, useTerminalFileLinks } from "./useTerminalFileLinks";

const ctx = (over: Record<string, unknown> = {}) => ({ projectRoot: "/proj", cwd: "/proj", ready: true, open: vi.fn(), ...over });

describe("openTerminalFileLink", () => {
  beforeEach(() => refused.mockReset());

  // @covers FR-01.28
  it("opens an inside-project file without asking the session route", async () => {
    const c = ctx();
    await openTerminalFileLink({ path: "src/a.ts", line: 3 }, "t1", c, vi.fn());
    expect(c.open).toHaveBeenCalledWith({ path: "src/a.ts", outside: false, line: 3 });
    expect(refused).not.toHaveBeenCalled();
  });

  // @covers FR-01.28
  it("opens an outside file the session route does not refuse", async () => {
    refused.mockResolvedValue(false);
    const c = ctx();
    await openTerminalFileLink({ path: "/other/b.md" }, "t1", c, vi.fn());
    expect(refused).toHaveBeenCalledWith("t1", "/other/b.md");
    expect(c.open).toHaveBeenCalledWith({ path: "/other/b.md", outside: true });
  });

  // @covers FR-01.28
  it("shows the 'not part of this session' notice and opens nothing when refused", async () => {
    refused.mockResolvedValue(true);
    const c = ctx();
    const notify = vi.fn();
    await openTerminalFileLink({ path: "/other/b.md" }, "t1", c, notify);
    expect(notify).toHaveBeenCalledWith("link-not-in-session");
    expect(c.open).not.toHaveBeenCalled();
  });

  // @covers FR-01.28
  it("drops the result of a probe that a newer click (or task switch) has superseded", async () => {
    refused.mockResolvedValue(false);
    const c = ctx();
    await openTerminalFileLink({ path: "/other/b.md" }, "t1", c, vi.fn(), () => false);
    expect(c.open).not.toHaveBeenCalled();
    const notify = vi.fn();
    refused.mockResolvedValue(true);
    await openTerminalFileLink({ path: "/other/b.md" }, "t1", c, notify, () => false);
    expect(notify).not.toHaveBeenCalled();
  });

  // @covers FR-01.28
  it("does nothing without a context or while the project is still loading", async () => {
    const notify = vi.fn();
    await openTerminalFileLink({ path: "src/a.ts" }, "t1", undefined, notify);
    const c = ctx({ ready: false });
    await openTerminalFileLink({ path: "src/a.ts" }, "t1", c, notify);
    expect(c.open).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("useTerminalFileLinks", () => {
  // @covers FR-01.28
  it("registers exactly one provider on the term and disposes it on unmount; no re-register on prop change", () => {
    const dispose = vi.fn();
    const registerLinkProvider = vi.fn(() => ({ dispose }));
    const term = { registerLinkProvider, cols: 80, buffer: { active: { getLine: () => undefined } }, hasSelection: () => false } as unknown as Terminal;
    const termRef = { current: term };
    const { rerender, unmount } = renderHook((p: { id: string }) => useTerminalFileLinks(termRef, p.id, ctx(), vi.fn()), { initialProps: { id: "a" } });
    rerender({ id: "b" });
    expect(registerLinkProvider).toHaveBeenCalledTimes(1);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.28
  it("is inert when the terminal is not created yet", () => {
    expect(() => renderHook(() => useTerminalFileLinks({ current: null }, "a", undefined, vi.fn()))).not.toThrow();
  });
});
