/*
 * external/tree/__tests__/routes.test.ts — per-router contract for
 * GET /api/external/projects/:projectId/tree.
 *
 * The full-fat behavior (.gitignore directory-form negation regression
 * for commit 5c7f539; symlink escape; realpath guard) is covered by
 * tree-route.test.ts at the createExternalRoutes level. This file locks
 * the response-key contract for the standalone sub-router against the
 * documented status codes in _c2_api_baseline.json.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createTreeRouter } from "../routes.js";
import type { ExternalRouteProjectView } from "../../_shared/helpers.js";

function makeApp(project: ExternalRouteProjectView | null): Hono {
  const app = new Hono();
  app.route(
    "/",
    createTreeRouter({
      getProjectById: (id) =>
        project && id === project.id ? project : undefined,
    }),
  );
  return app;
}

describe("createTreeRouter — GET /api/external/projects/:projectId/tree", () => {
  it("404 project_not_found", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/external/projects/p-test/tree");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; projectId: string };
    expect(body.error).toBe("project_not_found");
  });

  it("400 project_path_unavailable when path empty", async () => {
    const app = makeApp({ id: "p-test", name: "test", path: "" });
    const res = await app.request("/api/external/projects/p-test/tree");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_path_unavailable");
  });

  it("400 path_traversal on relative ..", async () => {
    const app = makeApp({
      id: "p-test",
      name: "test",
      path: "/projects/test",
    });
    const res = await app.request(
      "/api/external/projects/p-test/tree?path=" + encodeURIComponent("../etc"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("path_traversal");
  });

  it("400 absolute_input on absolute path", async () => {
    const app = makeApp({
      id: "p-test",
      name: "test",
      path: "/projects/test",
    });
    const res = await app.request(
      "/api/external/projects/p-test/tree?path=" + encodeURIComponent("/etc"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("absolute_input");
  });

  it("404 not_found when path does not exist", async () => {
    const app = makeApp({
      id: "p-test",
      name: "test",
      path: "/projects/does-not-exist",
    });
    const res = await app.request("/api/external/projects/p-test/tree");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
