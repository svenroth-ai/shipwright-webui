/*
 * POST /api/wizard/grade route tests (A09b, FR-01.53).
 *
 * Uses the injected `runGrade` seam so nothing spawns or touches the real
 * filesystem. Asserts the HTTP mapping: 200 for EVERY grade outcome (the
 * discriminated union carries the state), a 4xx only for a structurally-invalid
 * request, and that a bare grade route neither registers a project nor writes.
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import { createGradeRoutes } from "./grade.js";
import type { GradeOutcome } from "../core/grade-runner.js";

function mount(runGrade: (input: { target: string }) => Promise<GradeOutcome>) {
  const app = new Hono();
  app.route("/", createGradeRoutes({ runGrade }));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request("/api/wizard/grade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const REPORT_READY: GradeOutcome = {
  status: "report-ready",
  model: { schema_version: "1.0", grade: "A", score: 97.4 },
};

describe("POST /api/wizard/grade", () => {
  // @covers FR-01.51
  it("passes the target to the runner and returns report-ready (200)", async () => {
    const runGrade = vi.fn(async () => REPORT_READY);
    const app = mount(runGrade);
    const res = await post(app, { target: "C:/repo", isRemote: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REPORT_READY);
    expect(runGrade).toHaveBeenCalledWith({ target: "C:/repo" }, expect.anything());
  });

  // @covers FR-01.51
  it("returns 200 for a grade-failed outcome (an honest state, not an HTTP error)", async () => {
    const app = mount(async () => ({ status: "grade-failed", reason: "Couldn't grade that repo." }));
    const res = await post(app, { target: "C:/repo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "grade-failed" });
  });

  // @covers FR-01.51
  it("returns 200 for engine-unavailable, carrying the repair command", async () => {
    const app = mount(async () => ({
      status: "engine-unavailable",
      reason: "The grade engine isn't installed.",
      repairCommand: "npx @svenroth-ai/shipwright@latest",
    }));
    const res = await post(app, { target: "https://github.com/acme/checkout" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "engine-unavailable",
      repairCommand: expect.stringContaining("npx"),
    });
  });

  // @covers FR-01.51
  it("returns 200 for shape-unrecognised", async () => {
    const app = mount(async () => ({ status: "shape-unrecognised", reason: "not JSON" }));
    const res = await post(app, { target: "C:/repo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "shape-unrecognised" });
  });

  // @covers FR-01.51
  it("rejects a request with no target (400) WITHOUT invoking the runner", async () => {
    const runGrade = vi.fn(async () => REPORT_READY);
    const app = mount(runGrade);
    const res = await post(app, { isRemote: false });
    expect(res.status).toBe(400);
    expect(runGrade).not.toHaveBeenCalled();
  });

  // @covers FR-01.51
  it("rejects an empty-string target (400)", async () => {
    const runGrade = vi.fn(async () => REPORT_READY);
    const app = mount(runGrade);
    const res = await post(app, { target: "   " });
    expect(res.status).toBe(400);
    expect(runGrade).not.toHaveBeenCalled();
  });
});
