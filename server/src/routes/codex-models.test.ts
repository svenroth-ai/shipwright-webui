/*
 * codex-models route tests (iterate-2026-09-19-codex-model-catalog).
 * Mirrors readiness.test.ts's memoisation/coalescing shape, plus the
 * stale/unavailable degrade branches and the separate failure TTL.
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import { createCodexModelsRoutes } from "./codex-models.js";
import type { CodexModelsProbeResult } from "../core/codex-models-probe.js";

const MODELS = [
  { slug: "gpt-6-astra", display_name: "GPT-6-Astra" },
  { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol" },
];
const OK_RESULT: CodexModelsProbeResult = { ok: true, models: MODELS };
const FAIL_RESULT: CodexModelsProbeResult = { ok: false, models: [] };

describe("GET /api/codex-models", () => {
  it("returns ok + the filtered catalog on a successful probe", async () => {
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe: async () => OK_RESULT }));
    const res = await app.request("/api/codex-models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", models: MODELS });
  });

  it("memoises within the TTL — the probe is not re-run on every request", async () => {
    const probe = vi.fn(async () => OK_RESULT);
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe, ttlMs: 10_000 }));
    await app.request("/api/codex-models");
    await app.request("/api/codex-models");
    await app.request("/api/codex-models");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent cold requests onto one in-flight probe", async () => {
    let calls = 0;
    const probe = vi.fn(() => {
      calls++;
      return new Promise<CodexModelsProbeResult>((resolve) => setTimeout(() => resolve(OK_RESULT), 20));
    });
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe }));
    const [a, b, c] = await Promise.all([
      app.request("/api/codex-models"),
      app.request("/api/codex-models"),
      app.request("/api/codex-models"),
    ]);
    expect(calls).toBe(1);
    expect(await a.json()).toEqual({ status: "ok", models: MODELS });
    expect(await b.json()).toEqual({ status: "ok", models: MODELS });
    expect(await c.json()).toEqual({ status: "ok", models: MODELS });
  });

  it("re-probes after the success TTL expires", async () => {
    const probe = vi.fn(async () => OK_RESULT);
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe, ttlMs: -1 }));
    await app.request("/api/codex-models");
    await app.request("/api/codex-models");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("degrades to unavailable (still 200, never a 500) when the probe REJECTS with no prior cache (external code-review fix)", async () => {
    const app = new Hono();
    app.route(
      "/",
      createCodexModelsRoutes({
        probe: () => Promise.reject(new Error("subprocess helper crashed")),
      }),
    );
    const res = await app.request("/api/codex-models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unavailable", models: [] });
  });

  it("degrades to stale (still 200, never a 500) when a later probe REJECTS (external code-review fix)", async () => {
    let succeed = true;
    const probe = vi.fn(() => (succeed ? Promise.resolve(OK_RESULT) : Promise.reject(new Error("boom"))));
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe, ttlMs: -1 }));
    await app.request("/api/codex-models"); // ok, populates cache
    succeed = false;
    const res = await app.request("/api/codex-models"); // rejects, falls back to cache
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stale", models: MODELS });
  });

  it("degrades to unavailable (empty list, still 200) when the probe fails with no prior cache", async () => {
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe: async () => FAIL_RESULT }));
    const res = await app.request("/api/codex-models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unavailable", models: [] });
  });

  it("degrades to stale (last good list) when a later probe fails", async () => {
    let succeed = true;
    const probe = vi.fn(async () => (succeed ? OK_RESULT : FAIL_RESULT));
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe, ttlMs: -1 }));
    await app.request("/api/codex-models"); // ok, populates cache
    succeed = false;
    const res = await app.request("/api/codex-models"); // fails, falls back to cache
    expect(await res.json()).toEqual({ status: "stale", models: MODELS });
  });

  it("suppresses re-probing for failureTtlMs after a failure (unavailable branch)", async () => {
    const probe = vi.fn(async () => FAIL_RESULT);
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe, ttlMs: -1, failureTtlMs: 60_000 }));
    await app.request("/api/codex-models");
    await app.request("/api/codex-models");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("suppresses re-probing for failureTtlMs after a failure (stale branch)", async () => {
    let succeed = true;
    const probe = vi.fn(async () => (succeed ? OK_RESULT : FAIL_RESULT));
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe, ttlMs: -1, failureTtlMs: 60_000 }));
    await app.request("/api/codex-models"); // ok
    succeed = false;
    await app.request("/api/codex-models"); // fails once, caches the failure
    const res = await app.request("/api/codex-models"); // within failureTtlMs — no re-probe
    expect(probe).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({ status: "stale", models: MODELS });
  });

  it("re-probes again once failureTtlMs has elapsed", async () => {
    let succeed = false;
    const probe = vi.fn(async () => (succeed ? OK_RESULT : FAIL_RESULT));
    const app = new Hono();
    app.route("/", createCodexModelsRoutes({ probe, ttlMs: -1, failureTtlMs: -1 }));
    await app.request("/api/codex-models");
    succeed = true;
    const res = await app.request("/api/codex-models");
    expect(probe).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({ status: "ok", models: MODELS });
  });
});
