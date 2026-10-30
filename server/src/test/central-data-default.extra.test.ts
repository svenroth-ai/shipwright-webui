// @covers FR-01.03
/**
 * iterate-2026-10-30-central-data-default — autonomy write, PATCH validation,
 * cache across a flag flip, hostile id, wiring, task-level paste root.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectManager, type ProjectManagerDeps } from "../core/project-manager.js";
import { createProjectRoutes } from "../routes/projects.js";
import { errorHandler } from "../middleware/error-handler.js";
import { projectDataDir } from "../core/project-data-dir.js";
import { loadActionsForProjectRecord } from "../core/project-actions-loader.js";
import { buildExternalRoutesArgs } from "../external-routes-wiring.js";
import { centralRootForTask } from "../terminal/data-target.js";
import type { ServerConfig } from "../config.js";

function pmWithSpyWrites(runConfigExists: boolean) {
  const writes: string[] = [];
  const deps: ProjectManagerDeps = {
    readFile: vi.fn(async () => "[]"),
    writeFile: vi.fn(async (p: string) => void writes.push(p)),
    existsSync: vi.fn((p: string) => (String(p).endsWith("shipwright_run_config.json") ? runConfigExists : true)),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
  return { pm: new ProjectManager("/tmp/projects.json", deps), writes };
}

describe("updateAutonomy", () => {
  // @covers FR-01.03
  it("does not create shipwright_run_config.json when the repo has none", async () => {
    const { pm, writes } = pmWithSpyWrites(false);
    const p = pm.create({ name: "C", path: "/tmp/cust", profile: "x", status: "active" });
    await pm.updateAutonomy(p.id, "autonomous");
    expect(writes.some((w) => w.endsWith("shipwright_run_config.json"))).toBe(false);
  });

  // @covers FR-01.03
  it("still syncs an existing run_config", async () => {
    const { pm, writes } = pmWithSpyWrites(true);
    const p = pm.create({ name: "R", path: "/tmp/mine", profile: "x", status: "active" });
    await pm.updateAutonomy(p.id, "autonomous");
    expect(writes.some((w) => w.endsWith("shipwright_run_config.json"))).toBe(true);
  });
});

describe("PATCH /api/projects/:id shared validation", () => {
  const app = () => {
    const a = new Hono();
    a.onError(errorHandler);
    const manager = { update: (_id: string, patch: object) => ({ id: "p", ...patch }) };
    a.route("/", createProjectRoutes(manager as never));
    return a;
  };
  const patch = (body: object) =>
    app().request("/api/projects/p", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // @covers FR-01.03
  it("rejects a non-boolean", async () => {
    expect((await patch({ shared: "yes" })).status).toBe(400);
  });
  // @covers FR-01.03
  it("accepts a boolean", async () => {
    expect((await patch({ shared: true })).status).toBe(200);
  });
});

describe("data dir resolution", () => {
  let repo: string;
  let data: string;
  let prev: string | undefined;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "sx-repo-"));
    data = fs.mkdtempSync(path.join(os.tmpdir(), "sx-data-"));
    prev = process.env.SHIPWRIGHT_DATA_DIR;
    process.env.SHIPWRIGHT_DATA_DIR = data;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SHIPWRIGHT_DATA_DIR;
    else process.env.SHIPWRIGHT_DATA_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });

  // @covers FR-01.03
  it("refuses an id that could leave projects/", () => {
    expect(() => projectDataDir({ id: "../x", path: repo })).toThrow();
  });

  // @covers FR-01.03
  it("a relative SHIPWRIGHT_DATA_DIR is made absolute", () => {
    process.env.SHIPWRIGHT_DATA_DIR = path.relative(process.cwd(), data);
    expect(path.isAbsolute(projectDataDir({ id: "a", path: repo }))).toBe(true);
  });

  // @covers FR-01.03
  it("flipping the flag switches which actions.json is read (no stale cache)", () => {
    fs.mkdirSync(path.join(data, "projects", "p1"), { recursive: true });
    fs.writeFileSync(path.join(data, "projects", "p1", "actions.json"), JSON.stringify({ schemaVersion: 1, defaults: { autonomy: "guided" }, actions: [], phases: [], preview: { enabled: "auto" } }));
    const central = { id: "p1", path: repo };
    const shared = { id: "p1", path: repo, shared: true };
    expect(loadActionsForProjectRecord(central).fromUser).toBe(true);
    expect(loadActionsForProjectRecord(shared).fromUser).toBe(true); // mirror fallback to central
    expect(loadActionsForProjectRecord(central).fromUser).toBe(true);
  });
});

describe("index.ts wiring", () => {
  // @covers FR-01.03
  it("no longer mounts a repo-write guard", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../index.ts"), "utf8");
    expect(src).not.toContain("standaloneGuard");
    expect(fs.existsSync(path.resolve(__dirname, "../middleware/standalone-guard.ts"))).toBe(false);
  });
});

describe("production wiring keeps the shared flag (doubt D1)", () => {
  // @covers FR-01.03
  it("getProjectById handed to the external routes carries shared", () => {
    const projectManager = {
      getAll: () => [],
      getById: (id: string) =>
        id === "sa"
          ? { id: "sa", name: "C", path: "/abs/c", profile: "x", shared: true }
          : undefined,
    } as unknown as ProjectManager;
    const args = buildExternalRoutesArgs({
      sdkSessionsStore: {} as never,
      sessionWatcher: {} as never,
      projectManager,
      previewManager: {} as never,
      scrollbackStore: { clearBestEffort: vi.fn() } as never,
      snapshotStore: { clearBestEffort: vi.fn() } as never,
      ptyManager: { get: vi.fn(), kill: vi.fn(), peekTerminalText: vi.fn() } as never,
      honoHost: "localhost",
      config: { leadsRoot: "/l", leadsRouteSecret: "s", leadwrightCheckoutRoot: "/lw" } as unknown as ServerConfig,
    });
    expect(args.getProjectById?.("sa")?.shared).toBe(true);
  });
});

describe("centralRootForTask", () => {
  let repo: string;
  let data: string;
  let prev: string | undefined;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "st-repo-"));
    data = fs.mkdtempSync(path.join(os.tmpdir(), "st-data-"));
    prev = process.env.SHIPWRIGHT_DATA_DIR;
    process.env.SHIPWRIGHT_DATA_DIR = data;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SHIPWRIGHT_DATA_DIR;
    else process.env.SHIPWRIGHT_DATA_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });

  const projects = () => [{ id: "sa", path: repo }, { id: "r", path: "/elsewhere", shared: true }];

  // @covers FR-01.03
  it("matches by projectId", () => {
    expect(centralRootForTask({ projectId: "sa", cwd: "/x" }, projects)).toBe(path.join(data, "projects", "sa"));
  });

  // @covers FR-01.03
  it("matches a task with NO resolvable projectId by cwd inside the repo", () => {
    const sub = path.join(repo, "src");
    fs.mkdirSync(sub);
    expect(centralRootForTask({ projectId: "unassigned", cwd: repo }, projects)).toBe(path.join(data, "projects", "sa"));
    expect(centralRootForTask({ cwd: sub }, projects)).toBe(path.join(data, "projects", "sa"));
  });

  // @covers FR-01.03
  it("does not match a sibling folder or a shared project", () => {
    expect(centralRootForTask({ cwd: repo + "-other" }, projects)).toBeNull();
    expect(centralRootForTask({ projectId: "r", cwd: "/elsewhere" }, projects)).toBeNull();
  });
});

describe("shared flip keeps central actions.json readable (doubt D1)", () => {
  // @covers FR-01.03
  it("falls back to the central file when the repo has none, and reset clears it", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "sf-repo-"));
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "sf-data-"));
    const prev = process.env.SHIPWRIGHT_DATA_DIR;
    process.env.SHIPWRIGHT_DATA_DIR = data;
    try {
      fs.mkdirSync(path.join(data, "projects", "f1"), { recursive: true });
      const file = path.join(data, "projects", "f1", "actions.json");
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, defaults: { autonomy: "guided" }, actions: [], phases: [], preview: { enabled: "auto" } }));
      const shared = { id: "f1", path: repo, shared: true };
      expect(loadActionsForProjectRecord(shared).fromUser).toBe(true);
      const { registerActionsUploadDelete } = await import("../external/actions/upload-delete.js");
      const app = new Hono();
      registerActionsUploadDelete(app, { getProjectById: () => ({ ...shared, name: "n" }) });
      await app.request("/api/projects/f1/actions-upload", { method: "DELETE" });
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.SHIPWRIGHT_DATA_DIR;
      else process.env.SHIPWRIGHT_DATA_DIR = prev;
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(data, { recursive: true, force: true });
    }
  });
});
