import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDesignScreens } from "./useDesignScreens";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const MANIFEST = [
  "## Screens",
  "| # | Screen | File | Status | Linked FRs |",
  "|---|--------|------|--------|-----------|",
  "| 01 | dashboard | screens/01-dashboard.html | complete | FR-01.09 |",
].join("\n");

/** Mock the /file route the hook reads the manifest through. */
function mockFetch(status: number, body: string) {
  globalThis.fetch = vi.fn(async () =>
    new Response(body, { status, headers: { "Content-Type": "text/markdown" } }),
  ) as unknown as typeof fetch;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("useDesignScreens — honest empty vs real error (A14, AC5)", () => {
  it("parses the manifest into screens", async () => {
    mockFetch(200, MANIFEST);
    const { result } = renderHook(() => useDesignScreens("p1", true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.screens).toHaveLength(1);
    expect(result.current.isError).toBe(false);
  });

  it("a MISSING manifest (404) → honest empty list, NOT an error", async () => {
    mockFetch(404, JSON.stringify({ error: "not_found" }));
    const { result } = renderHook(() => useDesignScreens("p1", true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.screens).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it("a REAL failure (500) surfaces as isError, never masquerading as 'no previews'", async () => {
    mockFetch(500, JSON.stringify({ error: "server_error" }));
    const { result } = renderHook(() => useDesignScreens("p1", true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.screens).toEqual([]);
  });

  it("does not fetch when disabled", () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    renderHook(() => useDesignScreens("p1", false), { wrapper: wrapper() });
    expect(spy).not.toHaveBeenCalled();
  });
});
