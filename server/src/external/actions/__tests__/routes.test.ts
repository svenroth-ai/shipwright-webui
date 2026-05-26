/*
 * external/actions/__tests__/routes.test.ts — per-router contract for the
 * 4 actions endpoints (GET /actions, POST /actions-stub, POST/DELETE
 * /actions-upload). The full-fat behavior is covered by
 * actions-routes.test.ts + actions-upload.test.ts at the createExternalRoutes
 * level; this file locks the response-key contract per `_c2_api_baseline.json`
 * against the isolated sub-router so the slice can be reasoned about
 * standalone.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createActionsRouter } from "../routes.js";
import type { ExternalRouteProjectView } from "../../_shared/helpers.js";
import type { PreviewProfile } from "../../../core/preview-session-manager.js";

const DEFAULT_PROFILE = {
  id: "vite-react",
  command: "npm run dev",
  cwd: ".",
  ready: { type: "stdout", pattern: "Local: " },
  timeoutSeconds: 30,
} as unknown as PreviewProfile;

function makeApp(
  project: ExternalRouteProjectView | null = {
    id: "p-test",
    name: "test",
    path: "/projects/test",
  },
): Hono {
  const app = new Hono();
  app.route(
    "/",
    createActionsRouter({
      getProjectById: (id) =>
        project && id === project.id ? project : undefined,
      loadProfile: () => DEFAULT_PROFILE,
    }),
  );
  return app;
}

describe("createActionsRouter — GET /api/external/projects/:projectId/actions", () => {
  it("404 project_not_found", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/external/projects/p-test/actions");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; projectId: string };
    expect(body.error).toBe("project_not_found");
    expect(body.projectId).toBe("p-test");
  });

  it("200 response surfaces the documented key contract", async () => {
    const app = makeApp();
    const res = await app.request("/api/external/projects/p-test/actions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Per _c2_api_baseline.json — keys: actions, phases, defaults,
    // preview, diagnostics, fromUser.
    expect(Object.keys(body).sort()).toEqual([
      "actions",
      "defaults",
      "diagnostics",
      "fromUser",
      "phases",
      "preview",
    ]);
  });
});

describe("createActionsRouter — POST /api/projects/:id/actions-stub", () => {
  it("404 project_not_found", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/projects/p-test/actions-stub", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; projectId: string };
    expect(body.error).toBe("project_not_found");
  });

  it("400 project_path_unavailable when path is empty", async () => {
    const app = makeApp({ id: "p-test", name: "test", path: "" });
    const res = await app.request("/api/projects/p-test/actions-stub", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_path_unavailable");
  });
});

describe("createActionsRouter — POST /api/projects/:id/actions-upload", () => {
  it("404 project_not_found", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_not_found");
  });

  it("400 project_path_unavailable when path is empty", async () => {
    const app = makeApp({ id: "p-test", name: "test", path: "" });
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_path_unavailable");
  });

  it("413 payload_too_large when declared content-length exceeds cap", async () => {
    const app = makeApp();
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "POST",
      body: "{}",
      headers: { "content-length": String(1024 * 1024) },
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    expect(body.error).toBe("payload_too_large");
    expect(body.maxBytes).toBe(256 * 1024);
  });

  it("400 invalid_json on malformed body", async () => {
    const app = makeApp();
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "POST",
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_json");
  });

  it("400 invalid_json when top level is not an object", async () => {
    const app = makeApp();
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "POST",
      body: "[]",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("invalid_json");
    expect(body.detail).toBe("expected JSON object at top level");
  });
});

describe("createActionsRouter — DELETE /api/projects/:id/actions-upload", () => {
  it("404 project_not_found", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_not_found");
  });

  it("400 project_path_unavailable when path is empty", async () => {
    const app = makeApp({ id: "p-test", name: "test", path: "" });
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_path_unavailable");
  });

  it("200 returns { path, removed: false } when no file exists (idempotent)", async () => {
    const app = makeApp({
      id: "p-test",
      name: "test",
      path: "/nonexistent/projects/test",
    });
    const res = await app.request("/api/projects/p-test/actions-upload", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; removed: boolean };
    expect(body.removed).toBe(false);
    expect(typeof body.path).toBe("string");
  });
});
