/**
 * @covers FR-01.75
 * The Preview gate (actions GET) and the spawn (preview POST) both go through
 * an ASYNC profile loader that resolves the user's own profiles: they must
 * await it, hand it the project path, make spawn bypass the cache, and treat
 * a loader failure as "no Preview" rather than a 500.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

import { createPreviewRouter } from "../routes.js";
import { createActionsRouter } from "../../actions/routes.js";
import type { PreviewProfile, PreviewSessionManager } from "../../../core/preview-session-manager.js";
import type { ExternalRouteProjectView } from "../../_shared/helpers.js";

const project: ExternalRouteProjectView = { id: "p1", name: "t", path: "", profile: "mine" };
const custom = { dev_server: { command: "npm run dev", port: 5190 }, stack: { frontend: "vite" } } as unknown as PreviewProfile;

type Loader = (n: string, p?: string, o?: { fresh?: boolean }) => Promise<PreviewProfile | null> | PreviewProfile | null;

function previewApp(loadProfile: Loader, spawn = vi.fn(async () => ({ url: "http://127.0.0.1:5190/", sessionId: "s1" }))) {
  const app = new Hono();
  app.route("/", createPreviewRouter({
    getProjectById: (id) => (id === project.id ? project : undefined),
    previewManager: { spawn } as unknown as PreviewSessionManager,
    loadProfile,
  }));
  return { app, spawn };
}
const post = (app: Hono) => app.request("/api/external/projects/p1/preview", { method: "POST" });

function actionsApp(loadProfile: Loader) {
  const app = new Hono();
  app.route("/", createActionsRouter({ getProjectById: (id) => (id === project.id ? project : undefined), loadProfile }));
  return app;
}

describe("Preview with an async custom-profile loader", () => {
  it("// @covers FR-01.75 spawn awaits the loader, passes the project path and bypasses the cache", async () => {
    const loader = vi.fn(async () => custom);
    const { app, spawn } = previewApp(loader);
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(loader).toHaveBeenCalledWith("mine", "", { fresh: true });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("// @covers FR-01.75 no profile (invalid / outside / refused command) => 400 and nothing is spawned", async () => {
    const { app, spawn } = previewApp(async () => null);
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("preview_profile_invalid");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("// @covers FR-01.75 a throwing loader is a refusal, not a 500", async () => {
    const { app, spawn } = previewApp(async () => {
      throw new Error("kaboom");
    });
    expect((await post(app)).status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("// @covers FR-01.75 the button gate enables Preview for a resolved custom profile", async () => {
    const res = await actionsApp(async () => custom).request("/api/external/projects/p1/actions");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { preview: { enabled: boolean; port: number } }).preview).toMatchObject({ enabled: true, port: 5190 });
  });

  it("// @covers FR-01.75 the button gate stays off when the loader finds nothing or throws", async () => {
    for (const loader of [async () => null, async () => { throw new Error("x"); }] as Loader[]) {
      const res = await actionsApp(loader).request("/api/external/projects/p1/actions");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { preview: { enabled: boolean } }).preview.enabled).toBe(false);
    }
  });

  it("// @covers FR-01.75 existing sync loaders keep working", async () => {
    const res = await actionsApp(() => custom).request("/api/external/projects/p1/actions");
    expect(((await res.json()) as { preview: { enabled: boolean } }).preview.enabled).toBe(true);
  });
});
