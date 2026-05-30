import { describe, it, expect, vi } from "vitest";

import { createPrStatusRouter } from "./routes.js";

const VALID = "https://github.com/svenroth-ai/shipwright-webui/pull/78";

describe("GET /api/external/pr-status", () => {
  it("returns the fetched status as json for a valid url", async () => {
    const fetchPrStatus = vi.fn(async () => ({ state: "merged" as const, merged: true }));
    const app = createPrStatusRouter({ fetchPrStatus });

    const res = await app.request(
      `/api/external/pr-status?url=${encodeURIComponent(VALID)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "merged", merged: true });
    expect(fetchPrStatus).toHaveBeenCalledWith(VALID);
  });

  it("returns 400 for a missing url without invoking gh", async () => {
    const fetchPrStatus = vi.fn();
    const app = createPrStatusRouter({ fetchPrStatus });

    const res = await app.request("/api/external/pr-status");

    expect(res.status).toBe(400);
    expect(fetchPrStatus).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-github url without invoking gh", async () => {
    const fetchPrStatus = vi.fn();
    const app = createPrStatusRouter({ fetchPrStatus });

    const res = await app.request(
      "/api/external/pr-status?url=" +
        encodeURIComponent("https://evil.com/a/b/pull/1"),
    );

    expect(res.status).toBe(400);
    expect(fetchPrStatus).not.toHaveBeenCalled();
  });

  it("returns 200 + unknown (never 500) if fetchPrStatus ever rejects", async () => {
    const fetchPrStatus = vi.fn(async () => {
      throw new Error("boom");
    });
    const app = createPrStatusRouter({ fetchPrStatus });

    const res = await app.request(
      `/api/external/pr-status?url=${encodeURIComponent(VALID)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "unknown", merged: false });
  });
});
