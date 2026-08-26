/*
 * useOrgChartPresence.test.ts — the 4-state contract (iterate spec Design
 * Notes, "Nav presence"): `absent` fires ONLY on a confirmed
 * `org_chart_missing` 404, never on network error or a 502.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";

import { useOrgChartPresence } from "./useOrgChartPresence";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function mockFetchOnce(res: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: res.ok,
      status: res.status,
      json: res.json ?? (async () => ({})),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOrgChartPresence", () => {
  it("starts loading, then resolves 'present' on a 200", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ version: 1, po: "sven", leads: {} }) });
    const { result } = renderHook(() => useOrgChartPresence(), { wrapper: createWrapper() });
    expect(result.current).toBe("loading");
    await waitFor(() => expect(result.current).toBe("present"));
  });

  it("resolves 'absent' ONLY on a confirmed org_chart_missing 404", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({ error: "org_chart_missing" }) });
    const { result } = renderHook(() => useOrgChartPresence(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe("absent"));
  });

  it("resolves 'broken' on a 502 org_chart_invalid — never 'absent'", async () => {
    mockFetchOnce({ ok: false, status: 502, json: async () => ({ error: "org_chart_invalid" }) });
    const { result } = renderHook(() => useOrgChartPresence(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe("broken"));
  });

  it("resolves 'broken' on a network error — never 'absent'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));
    const { result } = renderHook(() => useOrgChartPresence(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe("broken"));
  });

  it("resolves 'absent' on a 404 with an unrelated error code — treated as a generic failure, not the nav-gating signal", async () => {
    // A 404 whose body ISN'T org_chart_missing is a different failure (e.g. a
    // proxy 404) — fetchOrgChart throws a plain ApiError for it, which this
    // hook still classifies as 'broken', not 'absent' (only the specific
    // OrgChartMissingError maps to absent).
    mockFetchOnce({ ok: false, status: 404, json: async () => ({ error: "some_other_404" }) });
    const { result } = renderHook(() => useOrgChartPresence(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe("broken"));
  });
});
