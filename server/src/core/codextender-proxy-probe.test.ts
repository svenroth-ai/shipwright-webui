/*
 * codextender-proxy-probe.test.ts (Codextender integration Part B.3/B.5,
 * re-verify pass 2026-09-23; auth-token handling updated for the PR-review
 * BLOCK fix, second round — no built-in fallback token).
 * Covers the OpenAI-shaped `/v1/models` parse (WITH its required auth
 * header), the no-auth `/health/liveliness` probe, the never-throws
 * contract, and the timeout path.
 */

import { describe, it, expect, vi } from "vitest";

import { probeCodextenderModels, probeCodextenderLiveness } from "./codextender-proxy-probe.js";

const FIXTURE_TOKEN = "test-fixture-token";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("probeCodextenderModels", () => {
  it("parses an OpenAI-shaped /v1/models body into slug+display_name entries", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: [{ id: "sol" }, { id: "astra" }] }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result).toEqual({
      ok: true,
      models: [
        { slug: "sol", display_name: "sol" },
        { slug: "astra", display_name: "astra" },
      ],
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/v1/models",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("sends the configured bearer token on /v1/models", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
    await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    const [, init] = fetchFn.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(init.headers?.Authorization).toContain("Bearer");
    expect(init.headers?.Authorization).toContain(FIXTURE_TOKEN);
  });

  it("PR-review BLOCK (iterate-2026-09-23, second round) — resolves {ok:false, models:[]} and never calls fetch when no authToken is configured", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
    const prior = process.env.CODEXTENDER_AUTH_TOKEN;
    delete process.env.CODEXTENDER_AUTH_TOKEN;
    try {
      const result = await probeCodextenderModels(4000, { fetchFn });
      expect(result).toEqual({ ok: false, models: [] });
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      if (prior !== undefined) process.env.CODEXTENDER_AUTH_TOKEN = prior;
    }
  });

  it("uses a custom port in the probed URL", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
    await probeCodextenderModels(4100, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/v1/models",
      expect.anything(),
    );
  });

  it("skips malformed entries (missing/blank id) without throwing", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: [{ id: "sol" }, { id: "" }, { notId: "x" }, null, "bogus"] }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result).toEqual({ ok: true, models: [{ slug: "sol", display_name: "sol" }] });
  });

  it("resolves {ok:false, models:[]} on a non-2xx response, never throws", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result).toEqual({ ok: false, models: [] });
  });

  it("resolves {ok:false, models:[]} when the body isn't OpenAI-shaped", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ not: "shaped" })) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN });
    expect(result).toEqual({ ok: false, models: [] });
  });

  it("resolves {ok:false, models:[]} on a network error, never rejects", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      probeCodextenderModels(4000, { fetchFn, authToken: FIXTURE_TOKEN }),
    ).resolves.toEqual({
      ok: false,
      models: [],
    });
  });

  it("resolves {ok:false, models:[]} on a timeout (abort), never rejects or hangs", async () => {
    const fetchFn = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderModels(4000, {
      fetchFn,
      authToken: FIXTURE_TOKEN,
      timeoutMs: 5,
    });
    expect(result).toEqual({ ok: false, models: [] });
  });
});

describe("probeCodextenderLiveness", () => {
  it("resolves true on a 200 from /health/liveliness, no auth header sent", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const result = await probeCodextenderLiveness(4000, { fetchFn });
    expect(result).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(url).toBe("http://127.0.0.1:4000/health/liveliness");
    expect(init?.headers).toBeUndefined();
  });

  it("uses a custom port in the probed URL", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    await probeCodextenderLiveness(4100, { fetchFn });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/health/liveliness",
      expect.anything(),
    );
  });

  it("resolves false on a non-2xx response, never throws", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;
    const result = await probeCodextenderLiveness(4000, { fetchFn });
    expect(result).toBe(false);
  });

  it("resolves false on a network error, never rejects", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(probeCodextenderLiveness(4000, { fetchFn })).resolves.toBe(false);
  });

  it("resolves false on a timeout (abort), never rejects or hangs", async () => {
    const fetchFn = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;
    const result = await probeCodextenderLiveness(4000, { fetchFn, timeoutMs: 5 });
    expect(result).toBe(false);
  });
});
