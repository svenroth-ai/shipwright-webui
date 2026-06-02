import { describe, it, expect, vi, afterEach } from "vitest";

import {
  listCampaigns,
  selectActiveCampaigns,
  type Campaign,
} from "./campaignsApi";

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    slug: "2026-06-02-x",
    intent: "do the thing",
    branchStrategy: "stacked",
    expandsTriage: null,
    steps: [],
    done: 0,
    total: 3,
    nextPending: { id: "B0", specPath: ".shipwright/.../B0-x.md" },
    ...overrides,
  };
}

describe("campaignsApi: listCampaigns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses the {campaigns} envelope on 200", async () => {
    const campaigns = [makeCampaign()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ campaigns }),
      })),
    );
    await expect(listCampaigns("p1")).resolves.toEqual(campaigns);
  });

  it("returns [] on 404 (unknown / synthesized project)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(listCampaigns("nope")).resolves.toEqual([]);
  });

  it("throws on a non-404 error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    await expect(listCampaigns("p1")).rejects.toThrow(/campaigns list failed: 500/);
  });

  it("encodes the projectId in the URL", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ campaigns: [] }),
    }));
    vi.stubGlobal("fetch", spy);
    await listCampaigns("a/b");
    expect(spy).toHaveBeenCalledWith("/api/campaigns/a%2Fb");
  });
});

describe("campaignsApi: selectActiveCampaigns", () => {
  it("keeps only campaigns with work remaining (done < total)", () => {
    const active = makeCampaign({ slug: "active", done: 1, total: 3 });
    const complete = makeCampaign({ slug: "complete", done: 3, total: 3 });
    const empty = makeCampaign({ slug: "empty", done: 0, total: 0 });
    const result = selectActiveCampaigns([active, complete, empty]);
    expect(result.map((c) => c.slug)).toEqual(["active"]);
  });
});
