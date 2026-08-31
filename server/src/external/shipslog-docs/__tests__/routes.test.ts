/*
 * external/shipslog-docs/__tests__/routes.test.ts — router contract for
 * GET /api/external/projects/:projectId/shipslog-docs. The reader's own
 * fs-discovery behavior (curated skip-if-missing, requirements section
 * discovery, iterate-spec sort) is covered by
 * core/shipslog-docs-reader.test.ts; this file locks the HTTP-boundary
 * status codes + response envelope, mirroring tree/__tests__/routes.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import { createShipsLogDocsRouter } from "../routes.js";
import type { ExternalRouteProjectView } from "../../_shared/helpers.js";
import type { ShipsLogDocsBundle } from "../../../core/shipslog-docs-reader.js";

const EMPTY_BUNDLE: ShipsLogDocsBundle = {
  requirements: [],
  iterateSpecs: [],
  agentDocs: [],
  compliance: [],
};

function makeApp(
  project: ExternalRouteProjectView | null,
  reader = vi.fn(async () => EMPTY_BUNDLE),
): Hono {
  const app = new Hono();
  app.route(
    "/",
    createShipsLogDocsRouter({
      getProjectById: (id) => (project && id === project.id ? project : undefined),
      readShipsLogDocs: reader,
    }),
  );
  return app;
}

describe("createShipsLogDocsRouter — GET /api/external/projects/:projectId/shipslog-docs", () => {
  it("404 project_not_found", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/external/projects/p-test/shipslog-docs");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; projectId: string };
    expect(body.error).toBe("project_not_found");
    expect(body.projectId).toBe("p-test");
  });

  it("400 project_path_unavailable when path empty", async () => {
    const app = makeApp({ id: "p-test", name: "test", path: "" });
    const res = await app.request("/api/external/projects/p-test/shipslog-docs");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_path_unavailable");
  });

  it("200 status:ok with the four curated groups, sourced from the injected reader", async () => {
    const bundle: ShipsLogDocsBundle = {
      requirements: [{ path: ".shipwright/planning/01-adopted/spec.md", label: "01 — Adopted", when: "2026-08-29T00:00:00.000Z" }],
      iterateSpecs: [{ path: ".shipwright/planning/iterate/x.md", label: "x.md", when: "2026-08-30T00:00:00.000Z" }],
      agentDocs: [{ path: ".shipwright/agent_docs/architecture.md", label: "Architecture", when: "2026-08-29T00:00:00.000Z" }],
      compliance: [{ path: ".shipwright/compliance/dashboard.md", label: "Dashboard", when: "2026-08-27T00:00:00.000Z" }],
    };
    const reader = vi.fn(async () => bundle);
    const app = makeApp({ id: "p-test", name: "test", path: "/projects/test" }, reader);
    const res = await app.request("/api/external/projects/p-test/shipslog-docs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string } & ShipsLogDocsBundle;
    expect(body.status).toBe("ok");
    expect(body.requirements).toEqual(bundle.requirements);
    expect(body.iterateSpecs).toEqual(bundle.iterateSpecs);
    expect(body.agentDocs).toEqual(bundle.agentDocs);
    expect(body.compliance).toEqual(bundle.compliance);
    expect(reader).toHaveBeenCalledWith("/projects/test");
  });

  it("declares no POST/PUT/PATCH/DELETE handler (read-only observer)", async () => {
    const app = makeApp({ id: "p-test", name: "test", path: "/projects/test" });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/api/external/projects/p-test/shipslog-docs", { method });
      expect(res.status).toBe(404);
    }
  });
});
