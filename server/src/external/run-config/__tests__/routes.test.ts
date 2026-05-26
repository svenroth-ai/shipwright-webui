/*
 * external/run-config/__tests__/routes.test.ts — per-router test for the
 * /api/external/projects/:projectId/run-config sub-router.
 *
 * Mirrors run-config-route.test.ts (which tests the full createExternalRoutes
 * assembly) but instantiates only the run-config router so the slice's
 * contract is asserted in isolation. CLAUDE.md rule 12 — webui is a
 * READ-ONLY observer of run-config; this file also locks the
 * no-POST/PATCH/PUT/DELETE invariant via Hono's default 404 for
 * undeclared methods on the same path.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createRunConfigRouter } from "../routes.js";
import type { ExternalRouteProjectView } from "../../_shared/helpers.js";
import type { RunConfigReadResult } from "../../../core/run-config-reader.js";
import type { RunConfigV2 } from "../../../types/run-config-v2.js";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "test",
  "fixtures",
  "run-config-v2-sample.json",
);
const FIXTURE: RunConfigV2 = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

function makeApp(args: {
  project?: ExternalRouteProjectView | null;
  reader?: (projectPath: string) => Promise<RunConfigReadResult>;
}): Hono {
  const projectId = "p-test";
  const project: ExternalRouteProjectView | null =
    args.project === undefined
      ? { id: projectId, name: "test", path: "/projects/test" }
      : args.project;
  const app = new Hono();
  app.route(
    "/",
    createRunConfigRouter({
      getProjectById: (id) =>
        project && id === projectId ? project : undefined,
      readRunConfig:
        args.reader ?? (async () => ({ status: "missing" }) satisfies RunConfigReadResult),
    }),
  );
  return app;
}

describe("createRunConfigRouter — GET /api/external/projects/:projectId/run-config", () => {
  it("404 project_not_found when the project is unknown", async () => {
    const app = makeApp({ project: null });
    const res = await app.request("/api/external/projects/p-test/run-config");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; projectId: string };
    expect(body.error).toBe("project_not_found");
    expect(body.projectId).toBe("p-test");
  });

  it("400 project_path_unavailable when the project has no path", async () => {
    const app = makeApp({
      project: { id: "p-test", name: "test", path: "" },
    });
    const res = await app.request("/api/external/projects/p-test/run-config");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; projectId: string };
    expect(body.error).toBe("project_path_unavailable");
  });

  it("200 status=missing when no run-config exists on disk", async () => {
    const app = makeApp({ reader: async () => ({ status: "missing" }) });
    const res = await app.request("/api/external/projects/p-test/run-config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "missing" });
  });

  it("200 status=v1_legacy verbatim (no v1 fields leaked)", async () => {
    const app = makeApp({ reader: async () => ({ status: "v1_legacy" }) });
    const res = await app.request("/api/external/projects/p-test/run-config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "v1_legacy" });
  });

  it("200 status=invalid with reason", async () => {
    const app = makeApp({
      reader: async () => ({ status: "invalid", reason: "bad runId" }),
    });
    const res = await app.request("/api/external/projects/p-test/run-config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "invalid", reason: "bad runId" });
  });

  it("200 status=ok with config + readyToLaunchTasks + diagnostics", async () => {
    const app = makeApp({
      reader: async () => ({
        status: "ok",
        config: FIXTURE,
        diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
      }),
    });
    const res = await app.request("/api/external/projects/p-test/run-config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      config: RunConfigV2;
      readyToLaunchTasks: Array<{ phaseTaskId: string }>;
      diagnostics: { droppedPhaseTaskIds: string[]; warnings: string[] };
    };
    expect(body.status).toBe("ok");
    expect(body.config.runId).toBe("run-a1b2c3d4");
    expect(body.readyToLaunchTasks.map((t) => t.phaseTaskId).sort()).toEqual([
      "ptk-cccc",
      "ptk-dddd",
    ]);
    expect(body.diagnostics.droppedPhaseTaskIds).toEqual([]);
  });

  // CLAUDE.md rule 12 — webui is a READ-ONLY observer.
  // Hono returns 404 for undeclared method-on-known-path (default not-matched).
  it.each(["POST", "PATCH", "PUT", "DELETE"] as const)(
    "%s /run-config is NOT routable (Hono default not-matched 404)",
    async (method) => {
      const app = makeApp({ reader: async () => ({ status: "missing" }) });
      const res = await app.request("/api/external/projects/p-test/run-config", {
        method,
      });
      expect(res.status).toBe(404);
    },
  );
});
