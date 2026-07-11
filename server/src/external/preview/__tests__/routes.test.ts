/*
 * external/preview/__tests__/routes.test.ts — per-router contract for
 * POST /api/external/projects/:projectId/preview.
 *
 * ADR-044 / CLAUDE.md rule 9 invariant: the route MUST NOT contain a
 * parallel spawn path; the only way to start a dev-server is via the
 * injected `previewManager.spawn(...)`. Tests inject a mock manager and
 * assert that every error-path code maps to the documented status +
 * response keys per `_c2_api_baseline.json`.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createPreviewRouter } from "../routes.js";
import {
  PreviewExitedEarlyError,
  PreviewPortInUseError,
  PreviewProfileInvalidError,
  PreviewSessionManager,
  PreviewSpawnFailedError,
  PreviewTimeoutError,
  type PreviewProfile,
} from "../../../core/preview-session-manager.js";
import type { ExternalRouteProjectView } from "../../_shared/helpers.js";

const DEFAULT_PROJECT: ExternalRouteProjectView = {
  id: "p-test",
  name: "test",
  path: "/projects/test",
  profile: "vite-react",
};

const DEFAULT_PROFILE: PreviewProfile = {
  id: "vite-react",
  command: "npm run dev",
  cwd: ".",
  ready: { type: "stdout", pattern: "Local: " },
  timeoutSeconds: 30,
} as PreviewProfile;

function makeApp(args: {
  project?: ExternalRouteProjectView | null;
  profile?: PreviewProfile | null;
  previewManager?: PreviewSessionManager | null;
  spawnImpl?: PreviewSessionManager["spawn"];
}): Hono {
  const project = args.project === undefined ? DEFAULT_PROJECT : args.project;
  const previewManager =
    args.previewManager === null
      ? undefined
      : args.previewManager ?? ({
          spawn: args.spawnImpl ??
            (async () => ({ url: "http://127.0.0.1:5173/", sessionId: "px-1" })),
        } as unknown as PreviewSessionManager);
  // Distinguish "args.profile not specified" from explicit "args.profile = null".
  const profile = "profile" in args ? args.profile : DEFAULT_PROFILE;
  const app = new Hono();
  app.route(
    "/",
    createPreviewRouter({
      getProjectById: (id) =>
        project && id === project.id ? project : undefined,
      previewManager,
      loadProfile: () => profile,
    }),
  );
  return app;
}

describe("createPreviewRouter — POST /api/external/projects/:projectId/preview", () => {
  it("501 preview_unavailable when no previewManager injected", async () => {
    const app = makeApp({ previewManager: null });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "preview_unavailable" });
  });

  it("404 project_not_found when project missing", async () => {
    const app = makeApp({ project: null });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; projectId: string };
    expect(body.error).toBe("project_not_found");
    expect(body.projectId).toBe("p-test");
  });

  it("400 preview_profile_invalid when project has no profile", async () => {
    const app = makeApp({
      project: { id: "p-test", name: "test", path: "/p", profile: undefined },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("preview_profile_invalid");
    expect(body.detail).toBe("project has no profile");
  });

  it("400 preview_profile_invalid when loadProfile returns null", async () => {
    const app = makeApp({ profile: null });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("preview_profile_invalid");
    expect(body.detail).toBe("profile not found");
  });

  it("200 returns { url, sessionId } on success", async () => {
    const app = makeApp({
      spawnImpl: async () => ({ url: "http://127.0.0.1:5173/", sessionId: "px-1" }) as Awaited<
        ReturnType<PreviewSessionManager["spawn"]>
      >,
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "http://127.0.0.1:5173/",
      sessionId: "px-1",
    });
  });

  it("400 maps PreviewProfileInvalidError → preview_profile_invalid", async () => {
    const app = makeApp({
      spawnImpl: async () => {
        throw new PreviewProfileInvalidError("shell metacharacter");
      },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("preview_profile_invalid");
    expect(body.detail).toBe("shell metacharacter");
  });

  it("400 maps a missing-port PreviewProfileInvalidError → preview_profile_invalid", async () => {
    // F30: the manager rejects a profile without dev_server.port up front; the
    // route must surface it as the 4xx config-omission code, not a 5xx spawn error.
    const app = makeApp({
      spawnImpl: async () => {
        throw new PreviewProfileInvalidError(
          "dev_server.port must be a positive integer",
        );
      },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("preview_profile_invalid");
    expect(body.detail).toBe("dev_server.port must be a positive integer");
  });

  it("500 maps PreviewPortInUseError → preview_port_in_use with port", async () => {
    const app = makeApp({
      spawnImpl: async () => {
        throw new PreviewPortInUseError(5173);
      },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; port: number };
    expect(body.error).toBe("preview_port_in_use");
    expect(body.port).toBe(5173);
  });

  it("500 maps PreviewSpawnFailedError → preview_spawn_failed", async () => {
    const app = makeApp({
      spawnImpl: async () => {
        throw new PreviewSpawnFailedError("ENOENT npm");
      },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("preview_spawn_failed");
    expect(body.detail).toBe("ENOENT npm");
  });

  it("500 maps PreviewExitedEarlyError → preview_exited_early", async () => {
    const app = makeApp({
      spawnImpl: async () => {
        throw new PreviewExitedEarlyError(1);
      },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("preview_exited_early");
    expect(body.detail).toBe("exited with code 1");
  });

  it("500 maps PreviewTimeoutError → preview_timeout with seconds", async () => {
    const app = makeApp({
      spawnImpl: async () => {
        throw new PreviewTimeoutError(30);
      },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; seconds: number };
    expect(body.error).toBe("preview_timeout");
    expect(body.seconds).toBe(30);
  });

  it("500 unknown failure → preview_unknown_error", async () => {
    const app = makeApp({
      spawnImpl: async () => {
        throw new Error("something weird happened");
      },
    });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("preview_unknown_error");
    expect(body.detail).toContain("something weird happened");
  });

  // ADR-044 / CLAUDE.md rule 9 — the ONLY way to start a dev-server is
  // through the injected previewManager. The route MUST NOT contain a
  // parallel spawn path. This test asserts that:
  //   (a) the injected manager's `spawn` is called exactly once per POST,
  //   (b) it is called with the project's cwd (the route does no other
  //       subprocess work).
  // An implementation that bypassed the manager (e.g. via
  // child_process.spawn directly) would skip this call and fail.
  it("ADR-044: spawn dispatches to the injected manager (no parallel spawn path)", async () => {
    const spawnCalls: Array<{
      projectId: string;
      profile: PreviewProfile;
      opts: { cwd?: string };
    }> = [];
    const manager = {
      spawn: async (
        projectId: string,
        profile: PreviewProfile,
        opts: { cwd?: string },
      ) => {
        spawnCalls.push({ projectId, profile, opts });
        return { url: "http://127.0.0.1:5173/", sessionId: "px-record" };
      },
    } as unknown as PreviewSessionManager;
    const app = makeApp({ previewManager: manager });
    const res = await app.request("/api/external/projects/p-test/preview", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].projectId).toBe("p-test");
    expect(spawnCalls[0].opts.cwd).toBe(DEFAULT_PROJECT.path);
    // The shell:false guarantee is owned by `core/preview-session-manager.ts`
    // — see preview-session-manager.test.ts. This route's contract is
    // "exactly one delegation, no parallel path"; the assertion above
    // proves the delegation. A parallel spawn path would have to also
    // call into `child_process` (which we don't mock here) and would
    // either fail tests or leak subprocesses.
  });
});
