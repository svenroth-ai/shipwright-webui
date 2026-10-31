import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useMissionFileOpen } from "./useMissionFileOpen";
import type { ExternalTask } from "../lib/externalApi";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const task = (id: string) => ({ taskId: id, projectId: "unassigned" }) as unknown as ExternalTask;

// @covers FR-01.66
describe("useMissionFileOpen", () => {
  it("opens a request with a fresh nonce each time and notifies the caller", () => {
    const onOpened = vi.fn();
    const { result } = renderHook(() => useMissionFileOpen(task("a"), onOpened), { wrapper });
    expect(result.current.request).toBeNull();
    act(() => result.current.fileOpen.open({ path: "x.ts", outside: false }));
    act(() => result.current.fileOpen.open({ path: "x.ts", outside: false }));
    expect(result.current.request).toEqual({ target: { path: "x.ts", outside: false }, nonce: 2 });
    expect(onOpened).toHaveBeenCalledTimes(2);
  });

  it("never leaks a request into another task", () => {
    const { result, rerender } = renderHook(({ id }) => useMissionFileOpen(task(id), () => undefined), {
      wrapper,
      initialProps: { id: "a" },
    });
    act(() => result.current.fileOpen.open({ path: "/o/x.md", outside: true }));
    expect(result.current.request).not.toBeNull();
    rerender({ id: "b" });
    expect(result.current.request).toBeNull();
    rerender({ id: "a" });
    expect(result.current.request).toBeNull(); // returning to the task never replays its last chip click
  });
});
