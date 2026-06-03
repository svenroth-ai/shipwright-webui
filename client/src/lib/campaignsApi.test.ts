import { describe, it, expect, vi, afterEach } from "vitest";

import {
  listCampaigns,
  selectActiveCampaigns,
  startCampaign,
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

describe("campaignsApi: startCampaign (FR-01.33)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to the slug-scoped start endpoint and returns the active result", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ slug: "2026-06-03-x", status: "active" }),
    }));
    vi.stubGlobal("fetch", spy);
    const out = await startCampaign("p1", "2026-06-03-x");
    expect(spy).toHaveBeenCalledWith("/api/campaigns/p1/2026-06-03-x/start", {
      method: "POST",
    });
    expect(out).toEqual({ ok: true, data: { slug: "2026-06-03-x", status: "active" } });
  });

  it("encodes both path segments", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ slug: "a b", status: "active" }),
    }));
    vi.stubGlobal("fetch", spy);
    await startCampaign("p/1", "a b");
    expect(spy).toHaveBeenCalledWith("/api/campaigns/p%2F1/a%20b/start", {
      method: "POST",
    });
  });

  it("maps a 409 to a structured failure carrying error + message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error: "campaign_already_complete",
          message: "Campaign is already complete.",
        }),
      })),
    );
    await expect(startCampaign("p1", "done-one")).resolves.toEqual({
      ok: false,
      status: 409,
      error: "campaign_already_complete",
      message: "Campaign is already complete.",
    });
  });

  it("falls back to unknown_error when the error body is unparseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    await expect(startCampaign("p1", "x")).resolves.toEqual({
      ok: false,
      status: 500,
      error: "unknown_error",
      message: undefined,
    });
  });
});
