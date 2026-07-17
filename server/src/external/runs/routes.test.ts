/*
 * external/runs/routes.test.ts — GET .../runs, .../runs/:runId, .../grade-trend
 * (A02, campaign webui-wow-usability-2026-07-10).
 *
 * Injected stub reader so the HTTP surface is tested in isolation; the join's
 * own semantics are covered in core/run-data-join.test.ts. Focus: project
 * resolution (404/400), runId threading, and the graceful unknown-runId path
 * (200 + run:null, never a 404/500). Integration proves the default reader
 * reaches disk. HEX adr_id fixtures — non-hex ids are rejected upstream.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { createRunsRouter } from "./routes.js";
import type { RunDataBundle, RunDataJoin } from "../../core/run-data-join.js";
import { EVENT_FILE } from "../../core/event-log-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

const HEX_ADR = "iterate-2026-07-14-abc1234";

const RUN: RunDataJoin = {
  runId: HEX_ADR,
  ts: "2026-07-14T10:00:00Z",
  source: "iterate",
  intent: "feature",
  changeType: "feature",
  summary: "s",
  description: "d",
  commit: "deadbeef",
  specImpact: "modify",
  specImpactRaw: "Modify",
  affectedFrs: ["FR-01.47"],
  newFrs: [],
  tests: { passed: 10, total: 10 },
  gates: { derived: true, test: "pass", review: "unknown", security: "unknown" },
  phaseDurations: null,
  campaign: null,
  subIterateId: null,
};

const EMPTY: RunDataBundle = {
  runs: [],
  runCount: 0,
  gradeTrend: [],
  pipelinePhaseDurations: [],
  skippedLines: 0,
};

const FULL: RunDataBundle = {
  ...EMPTY,
  runs: [RUN],
  runCount: 1,
  gradeTrend: [{ ts: "2026-07-14T09:00:00Z", grade: "A", score: 98.2 }],
};

function makeApp(args: {
  project?: ExternalRouteProjectView | null;
  reader?: (root: string, opts?: { runId?: string }) => RunDataBundle;
}): Hono {
  const projectId = "p-test";
  const project =
    args.project === undefined
      ? { id: projectId, name: "test", path: "/projects/test" }
      : args.project;
  const app = new Hono();
  app.route(
    "/",
    createRunsRouter({
      getProjectById: (id) => (project && id === projectId ? project : undefined),
      readRunData: args.reader ?? (() => FULL),
    }),
  );
  return app;
}

describe("GET /api/external/projects/:projectId/runs", () => {
  // @covers FR-01.47
  it("404 when the project is unknown", async () => {
    const res = await makeApp({ project: null }).request(
      "/api/external/projects/p-test/runs",
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("project_not_found");
  });

  // @covers FR-01.47
  it("400 when the project has no path", async () => {
    const res = await makeApp({ project: { id: "p-test", name: "t", path: "" } }).request(
      "/api/external/projects/p-test/runs",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("project_path_unavailable");
  });

  // @covers FR-01.47
  it("200 + ok payload with the bundle spread in", async () => {
    const res = await makeApp({ reader: () => FULL }).request(
      "/api/external/projects/p-test/runs",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunDataBundle & { status: string };
    expect(body.status).toBe("ok");
    expect(body.runCount).toBe(1);
    expect(body.runs[0].runId).toBe(HEX_ADR);
    expect(body.gradeTrend).toHaveLength(1);
  });

  // @covers FR-01.47
  it("graceful empty ok payload when the log is absent", async () => {
    const res = await makeApp({ reader: () => EMPTY }).request(
      "/api/external/projects/p-test/runs",
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { runCount: number }).runCount).toBe(0);
  });

  // @covers FR-01.47
  it("passes the resolved project.path into the reader", async () => {
    let seen: string | null = null;
    await makeApp({
      reader: (root) => {
        seen = root;
        return FULL;
      },
    }).request("/api/external/projects/p-test/runs");
    expect(seen).toBe("/projects/test");
  });
});

describe("GET /api/external/projects/:projectId/runs/:runId", () => {
  // @covers FR-01.47
  it("threads :runId into the reader opts and returns the run", async () => {
    let seenOpts: { runId?: string } | undefined;
    const res = await makeApp({
      reader: (_root, opts) => {
        seenOpts = opts;
        return FULL;
      },
    }).request(`/api/external/projects/p-test/runs/${HEX_ADR}`);
    expect(res.status).toBe(200);
    expect(seenOpts).toEqual({ runId: HEX_ADR });
    const body = (await res.json()) as { status: string; run: RunDataJoin | null };
    expect(body.run?.runId).toBe(HEX_ADR);
  });

  // @covers FR-01.47
  it("unknown runId → 200 { run: null } (graceful, never a 404/500)", async () => {
    const res = await makeApp({ reader: () => EMPTY }).request(
      "/api/external/projects/p-test/runs/iterate-2026-07-14-nomatch0",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; run: RunDataJoin | null };
    expect(body.status).toBe("ok");
    expect(body.run).toBeNull();
  });
});

describe("GET /api/external/projects/:projectId/grade-trend", () => {
  // @covers FR-01.47
  it("returns the grade trend series", async () => {
    const res = await makeApp({ reader: () => FULL }).request(
      "/api/external/projects/p-test/grade-trend",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; gradeTrend: unknown[] };
    expect(body.status).toBe("ok");
    expect(body.gradeTrend).toHaveLength(1);
  });

  // @covers FR-01.47
  it("404 on unknown project", async () => {
    const res = await makeApp({ project: null }).request(
      "/api/external/projects/p-test/grade-trend",
    );
    expect(res.status).toBe(404);
  });
});

// Integration: the DEFAULT reader (no stub) → real pathGuard + filesystem read.
describe("runs routes — default reader integration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "runsroute-"));
    dirs.push(d);
    return d;
  };
  const appFor = (root: string): Hono => {
    const app = new Hono();
    app.route(
      "/",
      createRunsRouter({
        getProjectById: (id) => (id === "p" ? { id: "p", name: "t", path: root } : undefined),
      }),
    );
    return app;
  };

  // @covers FR-01.47
  it("reads a real on-disk log through /runs", async () => {
    const root = tmp();
    writeFileSync(
      path.join(root, EVENT_FILE),
      [
        JSON.stringify({ type: "work_completed", adr_id: HEX_ADR, tests: { passed: 3, total: 3 } }),
        JSON.stringify({ type: "grade_snapshot", ts: "2026-07-14T09:00:00Z", grade: "A", score: 100 }),
      ].join("\n"),
      "utf-8",
    );
    const res = await appFor(root).request("/api/external/projects/p/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunDataBundle & { status: string };
    expect(body.runCount).toBe(1);
    expect(body.runs[0].gates?.test).toBe("pass");
    expect(body.gradeTrend).toHaveLength(1);
  });

  // @covers FR-01.47
  it("graceful empty ok payload when the log is absent", async () => {
    const res = await appFor(tmp()).request("/api/external/projects/p/runs");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { runCount: number }).runCount).toBe(0);
  });
});
