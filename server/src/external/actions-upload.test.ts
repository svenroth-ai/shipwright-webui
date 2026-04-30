/*
 * Iterate iterate-20260430-actions-upload-ui — route-layer tests for
 *   - POST   /api/projects/:id/actions-upload  (replace .webui/actions.json)
 *   - DELETE /api/projects/:id/actions-upload  (reset to bundled default)
 *
 * Spec: FR-01.27. Server enforces JSON-parse + schema validation
 * + contract-version check before writing. Reuses the same
 * project_not_found / project_path_unavailable error codes as
 * the existing /actions-stub endpoint so the client can share
 * error-rendering paths.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import {
  createExternalRoutes,
  type ExternalRouteProjectView,
} from "./routes.js";
import { clearActionsCache } from "../core/project-actions-loader.js";

function inMemoryStoreDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

function validActionsPayload(): unknown {
  return {
    schemaVersion: 1,
    defaults: { autonomy: "guided" },
    actions: [
      {
        id: "new-task",
        label: "New task",
        kind: "external_launch",
        command_template: "claude",
      },
    ],
    phases: [{ id: "build", label: "Build" }],
    preview: { enabled: "auto" },
  };
}

describe("POST /api/projects/:id/actions-upload", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectPath: string;
  const PROJECT_ID = "project-001";

  function defaultProject(): ExternalRouteProjectView {
    return {
      id: PROJECT_ID,
      name: "demo",
      path: projectPath,
    };
  }

  beforeEach(async () => {
    clearActionsCache();
    projectPath = mkdtempSync(path.join(tmpdir(), "actions-upload-test-"));
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryStoreDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: projectPath });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        getProjectById: (id) =>
          id === PROJECT_ID ? defaultProject() : undefined,
        getKnownProjectIds: () => new Set([PROJECT_ID]),
      }),
    );
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("writes .webui/actions.json on valid payload + returns {path, written: true}", async () => {
    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validActionsPayload()),
      },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { path: string; written: boolean };
    expect(body.written).toBe(true);
    expect(body.path).toBe(path.join(projectPath, ".webui", "actions.json"));

    const onDisk = readFileSync(body.path, "utf-8");
    const parsed = JSON.parse(onDisk) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
  });

  it("creates .webui/ directory if it does not exist", async () => {
    const webuiDir = path.join(projectPath, ".webui");
    expect(existsSync(webuiDir)).toBe(false);

    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validActionsPayload()),
      },
    );
    expect(r.status).toBe(200);
    expect(existsSync(webuiDir)).toBe(true);
  });

  it("overwrites existing .webui/actions.json (replace semantics)", async () => {
    const webuiDir = path.join(projectPath, ".webui");
    mkdirSync(webuiDir, { recursive: true });
    writeFileSync(
      path.join(webuiDir, "actions.json"),
      '{"schemaVersion":1,"old":true}',
      "utf-8",
    );

    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validActionsPayload()),
      },
    );
    expect(r.status).toBe(200);

    const onDisk = JSON.parse(
      readFileSync(path.join(webuiDir, "actions.json"), "utf-8"),
    ) as { old?: boolean; actions: Array<{ id: string }> };
    expect(onDisk.old).toBeUndefined();
    expect(onDisk.actions[0].id).toBe("new-task");
  });

  it("returns 404 project_not_found for unknown project id", async () => {
    const r = await app.request("/api/projects/ghost/actions-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validActionsPayload()),
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("project_not_found");
  });

  it("returns 400 invalid_json for non-JSON body", async () => {
    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not json",
      },
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 schema_validation_failed with errors[] on schema-invalid payload", async () => {
    // Empty phases[] is one of the documented schema errors.
    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          defaults: { autonomy: "guided" },
          actions: [
            {
              id: "new-task",
              label: "New task",
              kind: "external_launch",
              command_template: "claude",
            },
          ],
          phases: [],
          preview: { enabled: "auto" },
        }),
      },
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as {
      error: string;
      errors: Array<{ code: string }>;
    };
    expect(body.error).toBe("schema_validation_failed");
    expect(body.errors.some((e) => e.code === "empty_phases")).toBe(true);
  });

  it("returns 413 payload_too_large via Content-Length pre-check (DoS guard)", async () => {
    // Send a small body but lie about Content-Length so the pre-check
    // fires before c.req.text() allocates anything.
    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(300_000),
        },
        body: "{}",
      },
    );
    expect(r.status).toBe(413);
    const body = (await r.json()) as { error: string; size: number };
    expect(body.error).toBe("payload_too_large");
    expect(body.size).toBe(300_000);
  });

  it("returns 413 payload_too_large when raw body exceeds 256 KB cap", async () => {
    // Build a payload that's structurally fine but oversized: a single
    // string field padded to >262144 bytes.
    const huge = "x".repeat(300_000);
    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          defaults: { autonomy: "guided" },
          actions: [
            {
              id: "new-task",
              label: huge,
              kind: "external_launch",
              command_template: "claude",
            },
          ],
          phases: [{ id: "build", label: "Build" }],
          preview: { enabled: "auto" },
        }),
      },
    );
    expect(r.status).toBe(413);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("payload_too_large");
  });

  it("rejects a payload with an unknown placeholder in command_template (400 invalid_placeholder)", async () => {
    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          defaults: { autonomy: "guided" },
          actions: [
            {
              id: "new-task",
              label: "New task",
              kind: "external_launch",
              command_template: "claude /shipwright-{task.priority}",
            },
          ],
          phases: [{ id: "build", label: "Build" }],
          preview: { enabled: "auto" },
        }),
      },
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as {
      error: string;
      placeholder: string;
      actionId: string;
    };
    expect(body.error).toBe("invalid_placeholder");
    expect(body.placeholder).toBe("task.priority");
    expect(body.actionId).toBe("new-task");

    // The bad payload must not have been written to disk.
    const file = path.join(projectPath, ".webui", "actions.json");
    expect(existsSync(file)).toBe(false);
  });

  it("invalidates the actions loader cache so next GET /actions reflects the upload", async () => {
    // Prime the cache with the bundled-default branch.
    const before = await app.request(
      `/api/external/projects/${PROJECT_ID}/actions`,
    );
    const beforeBody = (await before.json()) as {
      actions: Array<{ id: string }>;
    };
    // Bundled default has 4 actions (new-task, new-pipeline, new-iterate, new-plain).
    expect(beforeBody.actions.length).toBeGreaterThan(1);

    // Upload a 1-action override.
    const upload = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validActionsPayload()),
      },
    );
    expect(upload.status).toBe(200);

    const after = await app.request(
      `/api/external/projects/${PROJECT_ID}/actions`,
    );
    const afterBody = (await after.json()) as {
      actions: Array<{ id: string }>;
    };
    expect(afterBody.actions).toHaveLength(1);
    expect(afterBody.actions[0].id).toBe("new-task");
  });
});

describe("DELETE /api/projects/:id/actions-upload", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectPath: string;
  const PROJECT_ID = "project-001";

  function defaultProject(): ExternalRouteProjectView {
    return { id: PROJECT_ID, name: "demo", path: projectPath };
  }

  beforeEach(async () => {
    clearActionsCache();
    projectPath = mkdtempSync(path.join(tmpdir(), "actions-reset-test-"));
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryStoreDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: projectPath });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        getProjectById: (id) =>
          id === PROJECT_ID ? defaultProject() : undefined,
      }),
    );
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("removes existing .webui/actions.json + returns {removed: true}", async () => {
    const webuiDir = path.join(projectPath, ".webui");
    mkdirSync(webuiDir, { recursive: true });
    const file = path.join(webuiDir, "actions.json");
    writeFileSync(file, JSON.stringify(validActionsPayload()), "utf-8");

    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      { method: "DELETE" },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { removed: boolean };
    expect(body.removed).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("is idempotent — returns {removed: false} when file does not exist", async () => {
    const r = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      { method: "DELETE" },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { removed: boolean };
    expect(body.removed).toBe(false);
  });

  it("returns 404 project_not_found for unknown project id", async () => {
    const r = await app.request("/api/projects/ghost/actions-upload", {
      method: "DELETE",
    });
    expect(r.status).toBe(404);
  });

  it("invalidates the loader cache — next GET /actions returns bundled default", async () => {
    // Seed a custom file.
    const webuiDir = path.join(projectPath, ".webui");
    mkdirSync(webuiDir, { recursive: true });
    writeFileSync(
      path.join(webuiDir, "actions.json"),
      JSON.stringify(validActionsPayload()),
      "utf-8",
    );
    // Prime the cache.
    const before = await app.request(
      `/api/external/projects/${PROJECT_ID}/actions`,
    );
    const beforeBody = (await before.json()) as {
      actions: Array<{ id: string }>;
    };
    expect(beforeBody.actions).toHaveLength(1);
    expect(beforeBody.actions[0].id).toBe("new-task");

    const del = await app.request(
      `/api/projects/${PROJECT_ID}/actions-upload`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);

    const after = await app.request(
      `/api/external/projects/${PROJECT_ID}/actions`,
    );
    const afterBody = (await after.json()) as {
      actions: Array<{ id: string }>;
    };
    // Bundled default has > 1 action.
    expect(afterBody.actions.length).toBeGreaterThan(1);
  });
});
