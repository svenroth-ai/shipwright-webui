/*
 * codextender-models route tests (Codextender integration Part B.5).
 * Structural mirror of codex-models.test.ts's TTL-cache/inflight-coalescing
 * coverage, plus the `getPort` indirection this route adds (the proxy's
 * port is a live setting, re-read on every cold probe, not baked in at
 * router-construction time).
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import { createCodextenderModelsRoutes } from "./codextender-models.js";
import type { CodextenderProbeResult } from "../core/codextender-proxy-probe.js";

const MODELS = [
  { slug: "sol", display_name: "sol" },
  { slug: "astra", display_name: "astra" },
];
const OK_RESULT: CodextenderProbeResult = { ok: true, models: MODELS };
const FAIL_RESULT: CodextenderProbeResult = { ok: false, models: [] };

describe("GET /api/codextender-models", () => {
  it("returns ok + the catalog on a successful probe", async () => {
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({ getPort: async () => 4000, probe: async () => OK_RESULT }),
    );
    const res = await app.request("/api/codextender-models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", models: MODELS });
  });

  it("passes the CURRENT getPort() value to the probe on a cold request", async () => {
    const probe = vi.fn(async () => OK_RESULT);
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({ getPort: async () => 4100, probe }),
    );
    await app.request("/api/codextender-models");
    expect(probe).toHaveBeenCalledWith(4100);
  });

  it("memoises within the TTL — the probe is not re-run on every request", async () => {
    const probe = vi.fn(async () => OK_RESULT);
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({ getPort: async () => 4000, probe, ttlMs: 10_000 }),
    );
    await app.request("/api/codextender-models");
    await app.request("/api/codextender-models");
    await app.request("/api/codextender-models");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent cold requests onto one in-flight probe", async () => {
    let calls = 0;
    const probe = vi.fn(() => {
      calls++;
      return new Promise<CodextenderProbeResult>((resolve) =>
        setTimeout(() => resolve(OK_RESULT), 20),
      );
    });
    const app = new Hono();
    app.route("/", createCodextenderModelsRoutes({ getPort: async () => 4000, probe }));
    const [a, b, c] = await Promise.all([
      app.request("/api/codextender-models"),
      app.request("/api/codextender-models"),
      app.request("/api/codextender-models"),
    ]);
    expect(calls).toBe(1);
    expect(await a.json()).toEqual({ status: "ok", models: MODELS });
    expect(await b.json()).toEqual({ status: "ok", models: MODELS });
    expect(await c.json()).toEqual({ status: "ok", models: MODELS });
  });

  it("degrades to unavailable (still 200, never a 500) with no prior cache", async () => {
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({ getPort: async () => 4000, probe: async () => FAIL_RESULT }),
    );
    const res = await app.request("/api/codextender-models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unavailable", models: [] });
  });

  it("degrades to stale (last good list) when a later probe fails", async () => {
    let succeed = true;
    const probe = vi.fn(async () => (succeed ? OK_RESULT : FAIL_RESULT));
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({ getPort: async () => 4000, probe, ttlMs: -1 }),
    );
    await app.request("/api/codextender-models"); // ok, populates cache
    succeed = false;
    const res = await app.request("/api/codextender-models"); // fails, falls back to cache
    expect(await res.json()).toEqual({ status: "stale", models: MODELS });
  });

  // PR-review BLOCK fix, iterate-2026-09-23 fourth round: cache/failure state
  // is scoped to the port it was fetched against, so a `codextenderPort`
  // change re-probes immediately instead of serving the previous proxy's
  // list for up to `ttlMs`.
  it("re-probes immediately when the resolved port changes, even within the TTL", async () => {
    let port = 4000;
    const probe = vi.fn(async (p: number) =>
      p === 4000 ? OK_RESULT : { ok: true, models: [{ slug: "other", display_name: "other" }] },
    );
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({ getPort: async () => port, probe, ttlMs: 300_000 }),
    );
    const first = await app.request("/api/codextender-models");
    expect(await first.json()).toEqual({ status: "ok", models: MODELS });

    port = 5000;
    const second = await app.request("/api/codextender-models");
    expect(probe).toHaveBeenCalledWith(5000);
    expect(await second.json()).toEqual({
      status: "ok",
      models: [{ slug: "other", display_name: "other" }],
    });
  });

  it("a stale-port failure never masks with a different port's cached list", async () => {
    let port = 4000;
    const probe = vi.fn(async (p: number) => (p === 4000 ? OK_RESULT : FAIL_RESULT));
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({ getPort: async () => port, probe, ttlMs: -1 }),
    );
    await app.request("/api/codextender-models"); // caches MODELS under port 4000
    port = 5000;
    const res = await app.request("/api/codextender-models"); // fails under port 5000
    expect(await res.json()).toEqual({ status: "unavailable", models: [] });
  });

  // PR-review round 4: an older port's slow probe resolving AFTER a newer
  // port's probe has already replaced the module-level `inflight` entry
  // must not null it out from under the newer entry — that would make a
  // request landing during the newer probe's own window start a SECOND,
  // redundant probe for that same port instead of coalescing onto it.
  it("an older port's finally() never clears a newer port's still-pending inflight entry", async () => {
    let port = 4000;
    const probe = vi.fn(
      (p: number) =>
        new Promise<CodextenderProbeResult>((resolve) =>
          setTimeout(() => resolve(OK_RESULT), p === 4000 ? 10 : 40),
        ),
    );
    const app = new Hono();
    app.route("/", createCodextenderModelsRoutes({ getPort: async () => port, probe }));

    const reqA = app.request("/api/codextender-models"); // starts the port-4000 probe (10ms)
    await new Promise((resolve) => setTimeout(resolve, 2));
    port = 5000;
    const reqB = app.request("/api/codextender-models"); // starts the port-5000 probe (40ms), replaces inflight
    await new Promise((resolve) => setTimeout(resolve, 20)); // port-4000 probe resolves; its finally() must not clear port 5000's entry
    const reqC = app.request("/api/codextender-models"); // still port 5000 — must coalesce onto reqB's inflight

    await Promise.all([reqA, reqB, reqC]);
    expect(probe.mock.calls.filter(([p]) => p === 5000)).toHaveLength(1);
  });

  it("suppresses re-probing for failureTtlMs after a failure", async () => {
    const probe = vi.fn(async () => FAIL_RESULT);
    const app = new Hono();
    app.route(
      "/",
      createCodextenderModelsRoutes({
        getPort: async () => 4000,
        probe,
        ttlMs: -1,
        failureTtlMs: 60_000,
      }),
    );
    await app.request("/api/codextender-models");
    await app.request("/api/codextender-models");
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
