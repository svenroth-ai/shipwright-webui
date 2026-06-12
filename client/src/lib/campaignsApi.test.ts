import { describe, it, expect, vi, afterEach } from "vitest";

import {
  listCampaigns,
  launchCampaignRun,
  launchCampaignStepRun,
  startCampaign,
  dismissCampaign,
  restoreCampaign,
  type Campaign,
} from "./campaignsApi";

// Pure-selector coverage (selectActiveCampaigns / isCampaignDone /
// selectRiskyPendingSteps) lives in campaignsApi.selectors.test.ts — split out
// to keep each test file under the 300-LOC ceiling. This file covers the
// HTTP/fetch wrappers only.

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

describe("campaignsApi: launchCampaignRun", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs { campaignSlug } to the task launch endpoint and returns { task, commands }", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        task: { taskId: "t-1" },
        commands: { powershell: "p", cmd: "c", posix: "x" },
      }),
    }));
    vi.stubGlobal("fetch", spy);

    const out = await launchCampaignRun("t-1", "2026-06-02-x");
    expect(out.task.taskId).toBe("t-1");
    expect(out.commands.posix).toBe("x");

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/external/tasks/t-1/launch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ campaignSlug: "2026-06-02-x" });
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => "invalid_campaign_slug" })),
    );
    await expect(launchCampaignRun("t-1", "bad slug")).rejects.toThrow(/HTTP 400/);
  });
});

describe("campaignsApi: launchCampaignStepRun (FR-01.36)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs { campaignStep: { slug, stepId } } to the task launch endpoint", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        task: { taskId: "t-1" },
        commands: { powershell: "p", cmd: "c", posix: "x" },
      }),
    }));
    vi.stubGlobal("fetch", spy);

    const out = await launchCampaignStepRun("t-1", "2026-06-02-x", "C1");
    expect(out.task.taskId).toBe("t-1");
    expect(out.commands.posix).toBe("x");

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/external/tasks/t-1/launch");
    expect(init.method).toBe("POST");
    // The exact body shape the server's campaign-step branch parses (the seam).
    expect(JSON.parse(init.body as string)).toEqual({
      campaignStep: { slug: "2026-06-02-x", stepId: "C1" },
    });
  });

  it("throws on a non-ok response (e.g. campaign_step_spec_missing)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => "campaign_step_spec_missing" })),
    );
    await expect(launchCampaignStepRun("t-1", "s", "C1")).rejects.toThrow(/HTTP 400/);
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

describe("campaignsApi: dismissCampaign / restoreCampaign", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to the slug-scoped dismiss endpoint", async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", spy);
    await dismissCampaign("p1", "2026-06-07-x");
    expect(spy).toHaveBeenCalledWith("/api/campaigns/p1/2026-06-07-x/dismiss", {
      method: "POST",
    });
  });

  it("POSTs to the slug-scoped restore endpoint", async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", spy);
    await restoreCampaign("p1", "2026-06-07-x");
    expect(spy).toHaveBeenCalledWith("/api/campaigns/p1/2026-06-07-x/restore", {
      method: "POST",
    });
  });

  it("encodes both path segments", async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", spy);
    await dismissCampaign("p/1", "a b");
    expect(spy).toHaveBeenCalledWith("/api/campaigns/p%2F1/a%20b/dismiss", {
      method: "POST",
    });
  });

  it("throws on a non-2xx (e.g. 503 lock busy) so the mutation surfaces it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(dismissCampaign("p1", "x")).rejects.toThrow(/campaign dismiss failed: 503/);
  });
});
