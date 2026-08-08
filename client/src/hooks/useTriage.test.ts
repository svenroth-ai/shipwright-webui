/*
 * useTriage.test.ts — queryKey/shape parity between `useTriageItems` and
 * `useAllTriageItems` (iterate-2026-08-08-triage-filters-sort-parked).
 *
 * TanStack Query caches by queryKey regardless of which registered
 * queryFn populates it first. `useAllTriageItems` was drafted with a
 * queryFn returning a pre-selected `TriageItem[]` under the SAME
 * queryKey `useTriageItems` uses for the raw `TriageListResponse` — a
 * shape mismatch that would silently break whichever hook lost the
 * race to populate the cache. These tests pin both directions.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { useAllTriageItems, useTriageItems } from "./useTriage";

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

/**
 * `staleTime: Infinity` isolates the property under test — a second
 * observer on the SAME queryKey reads the cache instead of fetching —
 * from TanStack's normal (and separately expected) stale-while-
 * revalidate background refetch on mount, which the default
 * `staleTime: 0` would otherwise trigger regardless of cache sharing.
 */
function createIsolatedQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function mockFetchOnce(items: unknown[]): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ items, origin: { available: true, behind: 0 } }),
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
}

describe("useTriageItems / useAllTriageItems — cache parity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("useAllTriageItems reads the SAME cache entry useTriageItems already populated — no second fetch", async () => {
    const fetchSpy = mockFetchOnce([{ id: "trg-1" }]);
    const queryClient = createIsolatedQueryClient();
    const wrapper = createWrapper(queryClient);

    const { result: itemsResult } = renderHook(() => useTriageItems("proj-1"), { wrapper });
    await waitFor(() => expect(itemsResult.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const { result: allResult } = renderHook(() => useAllTriageItems(["proj-1"]), { wrapper });
    await waitFor(() => expect(allResult.current[0]?.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledTimes(1); // shared cache entry, no duplicate network call
    expect(allResult.current[0]?.data).toEqual(itemsResult.current.data);
  });

  it("useTriageItems still resolves correctly when useAllTriageItems populates the cache FIRST (the reverse race)", async () => {
    const fetchSpy = mockFetchOnce([{ id: "trg-1" }]);
    const queryClient = createIsolatedQueryClient();
    const wrapper = createWrapper(queryClient);

    const { result: allResult } = renderHook(() => useAllTriageItems(["proj-1"]), { wrapper });
    await waitFor(() => expect(allResult.current[0]?.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const { result: itemsResult } = renderHook(() => useTriageItems("proj-1"), { wrapper });
    await waitFor(() => expect(itemsResult.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledTimes(1); // still shared — no duplicate fetch
    // The regression this guards: if the two queryFns disagreed on shape,
    // this would resolve to `undefined` (calling `.items` on an already-
    // unwrapped array) instead of the real item list.
    expect(itemsResult.current.data).toEqual([{ id: "trg-1" }]);
  });
});
