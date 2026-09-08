import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";

import { useLeadInventory } from "./useLeadInventory";
import { fetchOrgInventory } from "../lib/leadInventoryApi";

vi.mock("../lib/leadInventoryApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/leadInventoryApi")>();
  return { ...actual, fetchOrgInventory: vi.fn() };
});

const mockedFetch = vi.mocked(fetchOrgInventory);

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLeadInventory", () => {
  it("fetches the composite inventory map and resolves with it", async () => {
    mockedFetch.mockResolvedValue({
      "acme-lead": {
        leadId: "acme-lead",
        totalBeatsInRegister: 0,
        beats: [],
        register: { status: "ok" },
        authority: { measured: false, reason: "not readable at the default charter path" },
      },
    });
    const { result } = renderHook(() => useLeadInventory(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.["acme-lead"].totalBeatsInRegister).toBe(0);
    expect(mockedFetch).toHaveBeenCalled();
  });
});
