/*
 * compliance-route.test.ts — GET /api/external/projects/:projectId/compliance
 * (iterate-2026-06-30-compliance-grade-webui, FR-01.43).
 *
 * Injected stub reader so tests don't touch the filesystem; the reader's own
 * markdown parsing is covered in core/compliance-reader.test.ts. This file
 * focuses on the HTTP surface: project resolution + status mapping.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes, type ExternalRouteProjectView } from "./routes.js";
import type { ComplianceReadResult } from "../core/compliance-reader.js";

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

const OK_RESULT: ComplianceReadResult = {
  status: "ok",
  data: {
    grade: "A",
    score: 99,
    verdict: "Under full control. Primarily capped by requirement traceability.",
    generatedAt: "2026-06-28T21:55:11.404445+00:00",
    controlVerdictMarkdown: "## ✅ Control Verdict\n\n### Control Grade: **A** (99/100)",
    ciSecurityMarkdown: "## 🛡️ CI Security\n\n| Critical | 0 |",
  },
};

async function makeApp(args: {
  projectId?: string;
  project?: ExternalRouteProjectView | null;
  reader?: (projectPath: string) => Promise<ComplianceReadResult>;
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
      readCompliance: args.reader ?? (async () => OK_RESULT),
      ptyManager: { get: () => undefined },
    }),
  );
  return app;
}

describe("GET /api/external/projects/:projectId/compliance", () => {
  it("404 when project is unknown (AC-D)", async () => {
    const app = await makeApp({ project: null });
    const res = await app.request("/api/external/projects/p-test/compliance");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_not_found");
  });

  it("400 when project has no path (AC-D)", async () => {
    const app = await makeApp({
      project: { id: "p-test", name: "test", path: "" },
    });
    const res = await app.request("/api/external/projects/p-test/compliance");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_path_unavailable");
  });

  it("passes the resolved project.path into the reader (routing contract)", async () => {
    let seenPath: string | null = null;
    const app = await makeApp({
      project: { id: "p-test", name: "test", path: "/projects/test" },
      reader: async (p) => {
        seenPath = p;
        return OK_RESULT;
      },
    });
    await app.request("/api/external/projects/p-test/compliance");
    expect(seenPath).toBe("/projects/test");
  });

  it("returns ok with grade/score/verdict/markdown slices (AC-A)", async () => {
    const app = await makeApp({ reader: async () => OK_RESULT });
    const res = await app.request("/api/external/projects/p-test/compliance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      grade: string;
      score: number;
      verdict: string;
      generatedAt: string;
      controlVerdictMarkdown: string;
      ciSecurityMarkdown: string;
    };
    expect(body.status).toBe("ok");
    expect(body.grade).toBe("A");
    expect(body.score).toBe(99);
    expect(body.verdict).toContain("Under full control");
    expect(body.generatedAt).toBe("2026-06-28T21:55:11.404445+00:00");
    expect(body.controlVerdictMarkdown).toContain("Control Grade");
    expect(body.ciSecurityMarkdown).toContain("CI Security");
  });

  it("returns missing verbatim when no dashboard exists (AC-B)", async () => {
    const app = await makeApp({ reader: async () => ({ status: "missing" }) });
    const res = await app.request("/api/external/projects/p-test/compliance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("missing");
  });

  it("returns invalid with reason (AC-C)", async () => {
    const app = await makeApp({
      reader: async () => ({ status: "invalid", reason: "no grade" }),
    });
    const res = await app.request("/api/external/projects/p-test/compliance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reason: string };
    expect(body.status).toBe("invalid");
    expect(body.reason).toBe("no grade");
  });
});
