/*
 * readiness route tests (FR-01.51) — the wizard/First-Contact gate endpoint.
 * Uses the injected `probe` + `versionInfo` seams so nothing spawns or touches
 * the real filesystem, and asserts the memoisation coalesces probe execution.
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import { createReadinessRoutes } from "./readiness.js";
import type { ReadinessReport } from "../core/readiness-probe.js";

const REPORT: ReadinessReport = {
  ready: true,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [{ key: "uv", label: "uv", ok: true, detail: "0.5.11", why: "", critical: true }],
};

function versionInfoStub() {
  return () => ({
    raw: "2.1.9 (Claude Code)",
    parsed: { major: 2, minor: 1, patch: 9 },
    supported: true,
  });
}

describe("GET /api/readiness", () => {
  it("returns the (async) probe report as JSON", async () => {
    const app = new Hono();
    app.route("/", createReadinessRoutes({ versionInfo: versionInfoStub(), probe: async () => REPORT }));
    const res = await app.request("/api/readiness");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REPORT);
  });

  it("passes the live Claude verdict (supported + raw) into the probe", async () => {
    const probe = vi.fn(async () => REPORT);
    const app = new Hono();
    app.route("/", createReadinessRoutes({ versionInfo: versionInfoStub(), probe }));
    await app.request("/api/readiness");
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        claude: expect.objectContaining({ supported: true, raw: "2.1.9 (Claude Code)" }),
      }),
    );
  });

  it("memoises within the TTL — the probe is not re-run on every request", async () => {
    const probe = vi.fn(async () => REPORT);
    const app = new Hono();
    app.route("/", createReadinessRoutes({ versionInfo: versionInfoStub(), probe, ttlMs: 10_000 }));
    await app.request("/api/readiness");
    await app.request("/api/readiness");
    await app.request("/api/readiness");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent cold-cache requests onto ONE in-flight probe", async () => {
    // The probe stays pending until we release it; three requests dispatched
    // synchronously must all await the same in-flight probe, not fan out.
    let release!: () => void;
    const probe = vi.fn(
      () => new Promise<ReadinessReport>((resolve) => (release = () => resolve(REPORT))),
    );
    const app = new Hono();
    app.route("/", createReadinessRoutes({ versionInfo: versionInfoStub(), probe, ttlMs: 10_000 }));
    const reqs = [
      app.request("/api/readiness"),
      app.request("/api/readiness"),
      app.request("/api/readiness"),
    ];
    release();
    const bodies = await Promise.all((await Promise.all(reqs)).map((r) => r.json()));
    expect(probe).toHaveBeenCalledTimes(1);
    for (const b of bodies) expect(b).toEqual(REPORT);
  });

  it("re-probes after the TTL expires", async () => {
    const probe = vi.fn(async () => REPORT);
    const app = new Hono();
    app.route("/", createReadinessRoutes({ versionInfo: versionInfoStub(), probe, ttlMs: 0 }));
    await app.request("/api/readiness");
    await app.request("/api/readiness");
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
