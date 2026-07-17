import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import type { ExternalTask } from "../lib/externalApi";
import type { Campaign } from "../lib/campaignsApi";

// FR-01.67 AC3: prove the HOOK wiring — a `campaign: <slug>` title enables the
// (pre-existing) campaigns poll and threads its payload into the model, while a
// normal title leaves it DORMANT (`enabled: false`). All three composed observers
// are mocked so this needs no QueryClient and no network.
const useCampaignsMock = vi.fn<(projectId: unknown, opts: unknown) => { data: Campaign[] }>();
vi.mock("./useCampaigns", () => ({
  useCampaigns: (projectId: unknown, opts: unknown) => useCampaignsMock(projectId, opts),
}));
vi.mock("./useMissionState", () => ({ useMissionState: () => "live" }));
vi.mock("./useRunData", () => ({ useRunDetail: () => ({ data: { status: "ok", run: null } }) }));

import { useMissionLive } from "./useMissionLive";

const CAMPAIGN: Campaign = {
  slug: "wow-usability",
  intent: "polish",
  branchStrategy: null,
  expandsTriage: null,
  status: "active",
  steps: [
    { id: "A21", slug: "a21", title: "A21", status: "in_progress", specPath: null, commit: null, branch: null, planFirst: false },
  ],
  done: 21,
  total: 22,
  nextPending: { id: "A22", specPath: null },
};

const task = (over: Partial<ExternalTask>): ExternalTask =>
  ({ projectId: "p1", title: "Login task", ...over }) as unknown as ExternalTask;

beforeEach(() => {
  useCampaignsMock.mockReset();
  useCampaignsMock.mockReturnValue({ data: [CAMPAIGN] });
});

describe("useMissionLive — campaign poll enablement (FR-01.67 AC3)", () => {
  it("a `campaign: <slug>` title ENABLES useCampaigns and threads the payload in", () => {
    const { result } = renderHook(() =>
      useMissionLive(task({ title: "campaign: wow-usability" }), ""),
    );
    expect(useCampaignsMock).toHaveBeenCalledWith("p1", { enabled: true });
    expect(result.current.campaign).toEqual({
      slug: "wow-usability",
      done: 21,
      total: 22,
      activeSubIterate: "A21",
    });
    expect(result.current.businessSummary).toBe("wow-usability");
  });

  it("a normal title leaves useCampaigns DORMANT (enabled:false) and campaign null", () => {
    const { result } = renderHook(() => useMissionLive(task({ title: "Login task" }), ""));
    expect(useCampaignsMock).toHaveBeenCalledWith("p1", { enabled: false });
    expect(result.current.campaign).toBeNull();
    expect(result.current.businessSummary).toBe("Login task");
  });
});
