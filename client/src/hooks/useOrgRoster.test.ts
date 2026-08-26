import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";

import { useOrgRoster } from "./useOrgRoster";
import { fetchLeadsRoster } from "../lib/orgApi";

vi.mock("../lib/orgApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/orgApi")>();
  return { ...actual, fetchLeadsRoster: vi.fn() };
});

const mockedFetch = vi.mocked(fetchLeadsRoster);

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOrgRoster", () => {
  it("fetches the composite roster and resolves with it", async () => {
    mockedFetch.mockResolvedValue({ leads: [] });
    const { result } = renderHook(() => useOrgRoster(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ leads: [] });
    expect(mockedFetch).toHaveBeenCalled();
  });
});
