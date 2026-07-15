/*
 * external/events/routes.test.ts — GET /api/external/projects/:projectId/events
 * (A01, campaign webui-wow-usability-2026-07-10).
 *
 * Injected stub reader so the HTTP surface is tested in isolation; the
 * reader's own parsing/tolerance is covered in core/event-log-reader.test.ts.
 * Focus: project resolution (404/400) + runId query threading + ok payload.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { createEventsRouter } from "./routes.js";
import { EVENT_FILE } from "../../core/event-log-reader.js";
import type { EventLogProjection } from "../../core/event-log-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

const EMPTY: EventLogProjection = {
  runs: [],
  phaseTransitions: [],
  runCount: 0,
  latestRun: null,
  totalLines: 0,
  parsedLines: 0,
  skippedLines: 0,
};

const OK: EventLogProjection = {
  ...EMPTY,
  runs: [
    {
      runId: "iterate-2026-07-10-aa11",
      eventId: "evt-aa11",
      ts: "2026-07-10T10:00:00Z",
      source: "iterate",
      intent: "feature",
      changeType: "feature",
      description: "d",
      summary: "s",
      commit: "abc1234",
      specImpact: "modify",
      affectedFrs: ["FR-01.28"],
      newFrs: [],
      tests: { passed: 10, total: 10 },
      phaseTimings: null,
      campaign: null,
      subIterateId: null,
    },
  ],
  runCount: 1,
  latestRun: null,
  totalLines: 1,
  parsedLines: 1,
};

function makeApp(args: {
  project?: ExternalRouteProjectView | null;
  reader?: (root: string, opts?: { runId?: string }) => EventLogProjection;
}): Hono {
  const projectId = "p-test";
  const project =
    args.project === undefined
      ? { id: projectId, name: "test", path: "/projects/test" }
      : args.project;
  const app = new Hono();
  app.route(
    "/",
    createEventsRouter({
      getProjectById: (id) =>
        project && id === projectId ? project : undefined,
      readEvents: args.reader ?? (() => OK),
    }),
  );
  return app;
}

describe("GET /api/external/projects/:projectId/events", () => {
  it("404 when the project is unknown", async () => {
    const app = makeApp({ project: null });
    const res = await app.request("/api/external/projects/p-test/events");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_not_found");
  });

  it("400 when the project has no path", async () => {
    const app = makeApp({ project: { id: "p-test", name: "t", path: "" } });
    const res = await app.request("/api/external/projects/p-test/events");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_path_unavailable");
  });

  it("passes the resolved project.path into the reader", async () => {
    let seenPath: string | null = null;
    const app = makeApp({
      reader: (root) => {
        seenPath = root;
        return OK;
      },
    });
    await app.request("/api/external/projects/p-test/events");
    expect(seenPath).toBe("/projects/test");
  });

  it("returns 200 + ok payload with the projection spread in", async () => {
    const app = makeApp({ reader: () => OK });
    const res = await app.request("/api/external/projects/p-test/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLogProjection & { status: string };
    expect(body.status).toBe("ok");
    expect(body.runCount).toBe(1);
    expect(body.runs[0].runId).toBe("iterate-2026-07-10-aa11");
  });

  it("returns an ok payload with empty runs when the log is absent (graceful)", async () => {
    const app = makeApp({ reader: () => EMPTY });
    const res = await app.request("/api/external/projects/p-test/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; runCount: number };
    expect(body.status).toBe("ok");
    expect(body.runCount).toBe(0);
  });

  it("threads ?runId through to the reader opts", async () => {
    let seenOpts: { runId?: string } | undefined;
    const app = makeApp({
      reader: (_root, opts) => {
        seenOpts = opts;
        return OK;
      },
    });
    await app.request(
      "/api/external/projects/p-test/events?runId=iterate-2026-07-10-aa11",
    );
    expect(seenOpts).toEqual({ runId: "iterate-2026-07-10-aa11" });
  });

  it("omits opts when no runId query is present", async () => {
    let seenOpts: { runId?: string } | undefined = { runId: "sentinel" };
    const app = makeApp({
      reader: (_root, opts) => {
        seenOpts = opts;
        return OK;
      },
    });
    await app.request("/api/external/projects/p-test/events");
    expect(seenOpts).toBeUndefined();
  });
});

// Integration: the DEFAULT reader (no stub) → real pathGuard + filesystem read,
// proving the route→reader→disk chain, not just router plumbing.
describe("GET .../events — default reader integration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "evroute-"));
    dirs.push(d);
    return d;
  };
  const appFor = (root: string): Hono => {
    const app = new Hono();
    app.route(
      "/",
      createEventsRouter({
        getProjectById: (id) =>
          id === "p" ? { id: "p", name: "t", path: root } : undefined,
      }),
    );
    return app;
  };

  it("reads a real on-disk event log through the endpoint", async () => {
    const root = tmp();
    writeFileSync(
      path.join(root, EVENT_FILE),
      JSON.stringify({
        type: "work_completed",
        adr_id: "iterate-2026-07-10-int01",
        commit: "deadbeef",
        tests: { passed: 3, total: 3 },
      }),
      "utf-8",
    );
    const res = await appFor(root).request("/api/external/projects/p/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLogProjection & { status: string };
    expect(body.status).toBe("ok");
    expect(body.runCount).toBe(1);
    expect(body.runs[0].runId).toBe("iterate-2026-07-10-int01");
    expect(body.runs[0].commit).toBe("deadbeef");
  });

  it("returns a graceful empty ok payload when the log is absent", async () => {
    const res = await appFor(tmp()).request("/api/external/projects/p/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; runCount: number };
    expect(body.status).toBe("ok");
    expect(body.runCount).toBe(0);
  });
});
