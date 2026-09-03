import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";

import { useOrgThreads } from "./useOrgThreads";
import { fetchOrgThreads } from "../lib/orgApi";

vi.mock("../lib/orgApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/orgApi")>();
  return { ...actual, fetchOrgThreads: vi.fn() };
});

const mockedFetch = vi.mocked(fetchOrgThreads);

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOrgThreads", () => {
  it("fetches the composite threads map and resolves with it", async () => {
    mockedFetch.mockResolvedValue({
      "acme-lead": [{ cardId: "task-1", cardTitle: "Follow-up", rounds: [] }],
    });
    const { result } = renderHook(() => useOrgThreads(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      "acme-lead": [{ cardId: "task-1", cardTitle: "Follow-up", rounds: [] }],
    });
    expect(mockedFetch).toHaveBeenCalled();
  });
});
