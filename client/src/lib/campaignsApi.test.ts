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
    status: null,
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
  it("status is authoritative: only `active` is shown; draft + complete hidden", () => {
    const active = makeCampaign({ slug: "active", status: "active", done: 0, total: 3 });
    const draft = makeCampaign({ slug: "draft", status: "draft", done: 0, total: 3 });
    const complete = makeCampaign({ slug: "complete", status: "complete", done: 3, total: 3 });
    const result = selectActiveCampaigns([active, draft, complete]);
    expect(result.map((c) => c.slug)).toEqual(["active"]);
  });

  it("draft is hidden even with work remaining (done < total)", () => {
    const draft = makeCampaign({ slug: "draft", status: "draft", done: 1, total: 3 });
    expect(selectActiveCampaigns([draft])).toEqual([]);
  });

  it("active is shown even when nothing is done yet (done=0)", () => {
    const active = makeCampaign({ slug: "active", status: "active", done: 0, total: 3 });
    expect(selectActiveCampaigns([active]).map((c) => c.slug)).toEqual(["active"]);
  });

  it("legacy (status=null) falls back to done < total", () => {
    const running = makeCampaign({ slug: "running", status: null, done: 1, total: 3 });
    const done = makeCampaign({ slug: "done", status: null, done: 3, total: 3 });
    const empty = makeCampaign({ slug: "empty", status: null, done: 0, total: 0 });
    const result = selectActiveCampaigns([running, done, empty]);
    expect(result.map((c) => c.slug)).toEqual(["running"]);
  });
});
