import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const dismissMock = vi.fn();
const restoreMock = vi.fn();
vi.mock("../lib/campaignsApi", () => ({
  dismissCampaign: (projectId: string, slug: string) => dismissMock(projectId, slug),
  restoreCampaign: (projectId: string, slug: string) => restoreMock(projectId, slug),
}));

import { useDismissCampaign } from "./useDismissCampaign";
import { campaignsKey } from "./useCampaigns";

function makeHarness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidateSpy, wrapper };
}

describe("useDismissCampaign", () => {
  afterEach(() => {
    dismissMock.mockReset();
    restoreMock.mockReset();
  });

  it("dismisses when the campaign is not yet dismissed, then invalidates the lane", async () => {
    dismissMock.mockResolvedValue(undefined);
    const { invalidateSpy, wrapper } = makeHarness();
    const { result } = renderHook(() => useDismissCampaign("p1"), { wrapper });

    await result.current.mutateAsync({ slug: "c1", dismissed: false });

    expect(dismissMock).toHaveBeenCalledWith("p1", "c1");
    expect(restoreMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: campaignsKey("p1") }),
    );
  });

  it("restores when the campaign is currently dismissed", async () => {
    restoreMock.mockResolvedValue(undefined);
    const { invalidateSpy, wrapper } = makeHarness();
    const { result } = renderHook(() => useDismissCampaign("p1"), { wrapper });

    await result.current.mutateAsync({ slug: "c1", dismissed: true });

    expect(restoreMock).toHaveBeenCalledWith("p1", "c1");
    expect(dismissMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: campaignsKey("p1") }),
    );
  });

  it("does NOT invalidate the lane when the write throws", async () => {
    dismissMock.mockRejectedValue(new Error("campaign dismiss failed: 503"));
    const { invalidateSpy, wrapper } = makeHarness();
    const { result } = renderHook(() => useDismissCampaign("p1"), { wrapper });

    await expect(result.current.mutateAsync({ slug: "c1", dismissed: false })).rejects.toThrow();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
