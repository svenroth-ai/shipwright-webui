/*
 * run-config-route.test.ts — GET /api/external/projects/:projectId/run-config
 * (iterate/multi-session-run-orchestrator-v2 sub-iterate 1).
 *
 * Tests use an injected stub reader so they don't touch the filesystem;
 * the reader's own behavior (torn-read retry, last-good cache, dropped
 * rows) is covered separately in core/run-config-reader.test.ts. This
 * file focuses on the HTTP surface: status mapping, error responses,
 * readyToLaunchTasks derivation in the response.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes, type ExternalRouteProjectView } from "./routes.js";
import {
  clearRunConfigReaderCache,
  readRunConfig,
  type RunConfigReadResult,
} from "../core/run-config-reader.js";
import type { RunConfigV2 } from "../types/run-config-v2.js";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "test",
  "fixtures",
  "run-config-v2-sample.json",
);
const FIXTURE: RunConfigV2 = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

async function makeApp(args: {
  projectId?: string;
  project?: ExternalRouteProjectView | null;
  reader?: (projectPath: string) => Promise<RunConfigReadResult>;
}): Promise<Hono> {
  const projectId = args.projectId ?? "p-test";
  const project: ExternalRouteProjectView | null =
    args.project === undefined
      ? { id: projectId, name: "test", path: "/projects/test" }
      : args.project;
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const watcher = new SessionWatcher({ projectsDir: "/projects" });
  const app = new Hono();
  app.route(
    "/",
    createExternalRoutes({
      store,
      watcher,
      getProjectById: (id) =>
        project && id === projectId ? project : undefined,
      readRunConfig: args.reader,
      ptyManager: { get: () => undefined },
    }),
  );
  return app;
}

describe("GET /api/external/projects/:projectId/run-config", () => {
  let app: Hono;

  describe("project resolution", () => {
    it("404 when project is unknown", async () => {
      app = await makeApp({ project: null });
      const res = await app.request("/api/external/projects/p-test/run-config");
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("project_not_found");
    });

    it("400 when project has no path (synthesized 'unassigned' bucket)", async () => {
      app = await makeApp({
        project: { id: "p-test", name: "test", path: "" },
      });
      const res = await app.request("/api/external/projects/p-test/run-config");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("project_path_unavailable");
    });
  });

  describe("status mapping", () => {
    beforeEach(() => {
      // No-op — each test builds its own app with a custom reader.
    });

    it("returns 'missing' verbatim when no run-config exists", async () => {
      app = await makeApp({
        reader: async () => ({ status: "missing" }),
      });
      const res = await app.request("/api/external/projects/p-test/run-config");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("missing");
    });

    it("returns 'v1_legacy' verbatim", async () => {
      app = await makeApp({
        reader: async () => ({ status: "v1_legacy" }),
      });
      const res = await app.request("/api/external/projects/p-test/run-config");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("v1_legacy");
    });

    it("returns 'invalid' with reason", async () => {
      app = await makeApp({
        reader: async () => ({ status: "invalid", reason: "bad runId" }),
      });
      const res = await app.request("/api/external/projects/p-test/run-config");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; reason: string };
      expect(body.status).toBe("invalid");
      expect(body.reason).toBe("bad runId");
    });

    it("returns 'ok' with config + readyToLaunchTasks + diagnostics", async () => {
      app = await makeApp({
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
      // Fixture has two parallel awaiting_launch tasks (per_split branches).
      expect(body.readyToLaunchTasks.map((t) => t.phaseTaskId).sort()).toEqual([
        "ptk-cccc",
        "ptk-dddd",
      ]);
      expect(body.diagnostics.droppedPhaseTaskIds).toEqual([]);
    });

    it("includes diagnostics.droppedPhaseTaskIds in the 'ok' response", async () => {
      app = await makeApp({
        reader: async () => ({
          status: "ok",
          config: FIXTURE,
          diagnostics: {
            droppedPhaseTaskIds: ["ptk-bad1", "ptk-bad2"],
            warnings: [],
          },
        }),
      });
      const res = await app.request("/api/external/projects/p-test/run-config");
      const body = (await res.json()) as {
        diagnostics: { droppedPhaseTaskIds: string[] };
      };
      expect(body.diagnostics.droppedPhaseTaskIds).toEqual(["ptk-bad1", "ptk-bad2"]);
    });
  });

  describe("mode passthrough (W1) — round-trip via the REAL reader", () => {
    // AC3: the route is a verbatim passthrough of `result.config`. These wire
    // the REAL readRunConfig (stubbed readFile) through the route so the whole
    // parse → response chain is exercised, not just the stubbed passthrough.
    function realReaderFor(json: string): (p: string) => Promise<RunConfigReadResult> {
      clearRunConfigReaderCache();
      return (projectPath: string) =>
        readRunConfig(projectPath, {
          readFile: async () => json,
          stat: async () => ({ mtimeMs: 1 }),
          sleep: async () => undefined,
          now: () => 1_000_000,
        });
    }

    it("surfaces a valid mode end-to-end", async () => {
      const json = JSON.stringify({ ...FIXTURE, mode: "single_session" });
      app = await makeApp({ reader: realReaderFor(json) });
      const res = await app.request("/api/external/projects/p-test/run-config");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; config: { mode?: string } };
      expect(body.status).toBe("ok");
      expect(body.config.mode).toBe("single_session");
    });

    it("unrecognised mode → dropped + warned, route still 200/ok", async () => {
      const json = JSON.stringify({ ...FIXTURE, mode: "bogus" });
      app = await makeApp({ reader: realReaderFor(json) });
      const res = await app.request("/api/external/projects/p-test/run-config");
      const body = (await res.json()) as {
        status: string;
        config: { mode?: string };
        diagnostics: { warnings: string[] };
      };
      expect(body.status).toBe("ok");
      expect(body.config.mode).toBeUndefined();
      expect(body.diagnostics.warnings.some((w) => w.includes("mode"))).toBe(true);
    });
  });
});
