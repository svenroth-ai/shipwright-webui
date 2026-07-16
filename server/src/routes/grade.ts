/*
 * POST /api/wizard/grade — the read-only Grade door route (A09b, FR-01.53).
 *
 * Runs `shipwright-grade`'s `grade.py <target> --format json` via
 * `core/grade-runner.ts` (shell:false, fixed python binary, validated target)
 * and returns the plugin's real `ReportModel` — or an HONEST degraded state.
 * Grade registers NO project and writes NOTHING (a bare grade is read-only);
 * this is a pure observer route, so it is POST only for a request body, never a
 * mutation.
 *
 * Response contract — 200 for EVERY grade OUTCOME (the discriminated union
 * carries the state, so the client renders an honest card for each and never
 * has to distinguish an HTTP error from a grade state):
 *   { status: "report-ready", model }        — the raw ReportModel (client-guarded)
 *   { status: "grade-failed", reason }        — TargetError / non-zero exit
 *   { status: "engine-unavailable", reason, repairCommand }
 *   { status: "shape-unrecognised", reason }  — non-JSON output
 * A structurally-invalid REQUEST (no target) is the one 4xx.
 */

import { Hono } from "hono";

import { runGrade, type GradeOutcome } from "../core/grade-runner.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function createGradeRoutes(args?: {
  /** Runner override (test seam) — defaults to the real spawn runner. */
  runGrade?: (input: { target: string }, deps?: { timeoutMs?: number }) => Promise<GradeOutcome>;
  /** Per-grade timeout override (test seam). */
  timeoutMs?: number;
}) {
  const app = new Hono();
  const run = args?.runGrade ?? runGrade;

  app.post("/api/wizard/grade", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ status: "grade-failed", reason: "The request wasn't valid JSON." }, 400);
    }
    const target = isObject(body) ? body.target : undefined;
    if (typeof target !== "string" || target.trim().length === 0) {
      return c.json({ status: "grade-failed", reason: "No repo was given." }, 400);
    }

    const outcome = await run({ target }, { timeoutMs: args?.timeoutMs });
    return c.json(outcome);
  });

  return app;
}
