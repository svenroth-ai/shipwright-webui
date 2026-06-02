import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const listCampaignsMock = vi.fn();
vi.mock("../lib/campaignsApi", () => ({
  listCampaigns: (id: string) => listCampaignsMock(id),
}));

import { useCampaigns, POLL_MS } from "./useCampaigns";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useCampaigns", () => {
  afterEach(() => {
    listCampaignsMock.mockReset();
  });

  it("polls at 3 s (AC-6 contract)", () => {
    expect(POLL_MS).toBe(3_000);
  });

  it("fetches campaigns for a real projectId", async () => {
    listCampaignsMock.mockResolvedValue([{ slug: "c1" }]);
    const { result } = renderHook(() => useCampaigns("p1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual([{ slug: "c1" }]));
    expect(listCampaignsMock).toHaveBeenCalledWith("p1");
  });

  it("is disabled (no fetch) when projectId is null/undefined", () => {
    renderHook(() => useCampaigns(undefined), { wrapper: wrapper() });
    expect(listCampaignsMock).not.toHaveBeenCalled();
  });
});
