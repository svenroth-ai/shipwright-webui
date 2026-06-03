import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const startCampaignMock = vi.fn();
vi.mock("../lib/campaignsApi", () => ({
  startCampaign: (projectId: string, slug: string) =>
    startCampaignMock(projectId, slug),
}));

import { useStartCampaign } from "./useStartCampaign";
import { campaignsKey } from "./useCampaigns";

function makeHarness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, invalidateSpy, wrapper };
}

describe("useStartCampaign", () => {
  afterEach(() => {
    startCampaignMock.mockReset();
  });

  it("calls startCampaign(projectId, slug) and invalidates the lane query on success", async () => {
    startCampaignMock.mockResolvedValue({
      ok: true,
      data: { slug: "c1", status: "active" },
    });
    const { invalidateSpy, wrapper } = makeHarness();
    const { result } = renderHook(() => useStartCampaign("p1"), { wrapper });

    const outcome = await result.current.mutateAsync("c1");

    expect(startCampaignMock).toHaveBeenCalledWith("p1", "c1");
    expect(outcome).toEqual({ ok: true, data: { slug: "c1", status: "active" } });
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: campaignsKey("p1"),
      }),
    );
  });

  it("does NOT invalidate the lane when the start fails (409/422/503)", async () => {
    startCampaignMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: "campaign_already_complete",
    });
    const { invalidateSpy, wrapper } = makeHarness();
    const { result } = renderHook(() => useStartCampaign("p1"), { wrapper });

    const outcome = await result.current.mutateAsync("c1");

    expect(outcome.ok).toBe(false);
    // Give onSuccess a tick; assert it never invalidated.
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
