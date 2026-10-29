// @covers FR-01.03
/**
 * iterate-2026-10-29-standalone-mode — review-driven gaps: autonomy write,
 * PATCH validation, cache across a flag flip, hostile id, middleware order.
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
import { standaloneRootForTask } from "../terminal/standalone-target.js";
import type { ServerConfig } from "../config.js";

function pmWithSpyWrites() {
  const writes: string[] = [];
  const deps: ProjectManagerDeps = {
    readFile: vi.fn(async () => "[]"),
    writeFile: vi.fn(async (p: string) => void writes.push(p)),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
  return { pm: new ProjectManager("/tmp/projects.json", deps), writes };
}

describe("updateAutonomy", () => {
  // @covers FR-01.03
  it("never writes shipwright_run_config.json into a standalone repo", async () => {
    const { pm, writes } = pmWithSpyWrites();
    const p = pm.create({ name: "C", path: "/tmp/cust", profile: "x", status: "active", standalone: true });
    await pm.updateAutonomy(p.id, "autonomous");
    expect(writes.some((w) => w.endsWith("shipwright_run_config.json"))).toBe(false);
  });

  // @covers FR-01.03
  it("still writes it for a regular project", async () => {
    const { pm, writes } = pmWithSpyWrites();
    const p = pm.create({ name: "R", path: "/tmp/mine", profile: "x", status: "active" });
    await pm.updateAutonomy(p.id, "autonomous");
    expect(writes.some((w) => w.endsWith("shipwright_run_config.json"))).toBe(true);
  });
});

describe("PATCH /api/projects/:id standalone validation", () => {
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
    expect((await patch({ standalone: "yes" })).status).toBe(400);
  });
  // @covers FR-01.03
  it("accepts a boolean", async () => {
    expect((await patch({ standalone: true })).status).toBe(200);
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
    expect(() => projectDataDir({ id: "../x", path: repo, standalone: true })).toThrow();
  });

  // @covers FR-01.03
  it("a relative SHIPWRIGHT_DATA_DIR is made absolute", () => {
    process.env.SHIPWRIGHT_DATA_DIR = path.relative(process.cwd(), data);
    expect(path.isAbsolute(projectDataDir({ id: "a", path: repo, standalone: true }))).toBe(true);
  });

  // @covers FR-01.03
  it("flipping the flag switches which actions.json is read (no stale cache)", () => {
    const body = JSON.stringify({ schemaVersion: 1, defaults: { autonomy: "guided" }, actions: [], phases: [], preview: { enabled: "auto" } });
    fs.mkdirSync(path.join(data, "projects", "p1"), { recursive: true });
    fs.writeFileSync(path.join(data, "projects", "p1", "actions.json"), body);
    const standalone = { id: "p1", path: repo, standalone: true };
    const regular = { id: "p1", path: repo };
    expect(loadActionsForProjectRecord(standalone).fromUser).toBe(true);
    expect(loadActionsForProjectRecord(regular).fromUser).toBe(false); // repo has none
    expect(loadActionsForProjectRecord(standalone).fromUser).toBe(true);
  });
});

describe("index.ts wiring", () => {
  // @covers FR-01.03
  it("mounts standaloneGuard BEFORE every route family it protects", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../index.ts"), "utf8");
    const guard = src.indexOf("app.use(\"/api/*\", standaloneGuard(");
    expect(guard).toBeGreaterThan(-1);
    for (const mount of ["createExternalRoutes(", "createTriageRoutes({", "createCampaignsRoutes({"]) {
      const at = src.indexOf(mount, src.indexOf("app.route", 0));
      expect(src.lastIndexOf(mount)).toBeGreaterThan(guard);
      expect(at).toBeGreaterThan(-1);
    }
  });
});

describe("production wiring keeps the standalone flag (doubt D1)", () => {
  // @covers FR-01.03
  it("getProjectById handed to the external routes carries standalone", () => {
    const projectManager = {
      getAll: () => [],
      getById: (id: string) =>
        id === "sa"
          ? { id: "sa", name: "C", path: "/abs/c", profile: "x", standalone: true }
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
    expect(args.getProjectById?.("sa")?.standalone).toBe(true);
  });
});

describe("standaloneRootForTask (doubt D2)", () => {
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

  const projects = () => [{ id: "sa", path: repo, standalone: true }, { id: "r", path: "/elsewhere" }];

  // @covers FR-01.03
  it("matches by projectId", () => {
    expect(standaloneRootForTask({ projectId: "sa", cwd: "/x" }, projects)).toBe(path.join(data, "projects", "sa"));
  });

  // @covers FR-01.03
  it("matches a task with NO resolvable projectId by cwd inside the repo", () => {
    const sub = path.join(repo, "src");
    fs.mkdirSync(sub);
    expect(standaloneRootForTask({ projectId: "unassigned", cwd: repo }, projects)).toBe(path.join(data, "projects", "sa"));
    expect(standaloneRootForTask({ cwd: sub }, projects)).toBe(path.join(data, "projects", "sa"));
  });

  // @covers FR-01.03
  it("does not match a sibling folder or a regular project", () => {
    expect(standaloneRootForTask({ cwd: repo + "-other" }, projects)).toBeNull();
    expect(standaloneRootForTask({ projectId: "r", cwd: "/elsewhere" }, projects)).toBeNull();
  });
});
