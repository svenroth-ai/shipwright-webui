import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createProjectRoutes } from "./projects.js";
import { AppError, errorHandler } from "../middleware/error-handler.js";

const mockProject = {
  id: "p1",
  name: "Test",
  path: "/tmp",
  profile: "default",
  status: "active",
  createdAt: "2026-01-01",
  lastActive: "2026-01-01",
};

function setup(
  opts: {
    onProjectDeleted?: (projectId: string) => number | Promise<number>;
    deleteThrows?: boolean;
  } = {},
) {
  const projectManager = {
    getAll: vi.fn(() => [mockProject]),
    getById: vi.fn((id: string) => (id === "p1" ? mockProject : undefined)),
    create: vi.fn((data: Partial<typeof mockProject>) => ({ ...mockProject, ...data })),
    update: vi.fn((_id: string, patch: Partial<typeof mockProject>) => ({ ...mockProject, ...patch })),
    delete: vi.fn((_id: string) => {
      if (opts.deleteThrows) throw new AppError("Project not found", 404);
    }),
  } as unknown as import("../core/project-manager.js").ProjectManager;

  const fsDeps = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  };

  const app = new Hono();
  app.onError(errorHandler);
  app.route(
    "/",
    createProjectRoutes(projectManager, fsDeps, opts.onProjectDeleted),
  );
  return { app, projectManager, fsDeps };
}

describe("Project Routes (Plan D'' simplified)", () => {
  it("GET /api/projects returns 200 with array", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("GET /api/projects/:id returns 200 when known", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects/p1");
    expect(res.status).toBe(200);
  });

  it("GET /api/projects/:id returns 404 when unknown", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects/missing");
    expect(res.status).toBe(404);
  });

  it("POST /api/projects with valid body returns 201", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", path: "/tmp/new" }),
    });
    expect(res.status).toBe(201);
  });

  // iterate-2026-07-06-fix-launch-path-quote-strip — a path pasted from a
  // shell context arrives wrapped in surrounding quotes. Normalise at the
  // route boundary so the fs probes AND the stored project.path are clean;
  // otherwise the quoted path feeds a broken `cd ''\''…'\'''` launch prefix.
  it("POST /api/projects strips a surrounding quote pair before fs probes + create", async () => {
    const { app, projectManager, fsDeps } = setup();
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Quoted",
        path: "'/Users/marcelburkart/Projects/Claude Command Center'",
      }),
    });
    expect(res.status).toBe(201);
    expect(projectManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/Users/marcelburkart/Projects/Claude Command Center",
      }),
    );
    // The existsSync probe must see the CLEAN path, never the quoted literal.
    expect(fsDeps.existsSync).toHaveBeenCalledWith(
      "/Users/marcelburkart/Projects/Claude Command Center",
    );
  });

  it("PATCH /api/projects/:id strips a surrounding quote pair from path", async () => {
    const { app, projectManager } = setup();
    const res = await app.request("/api/projects/p1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: '"C:\\Users\\me\\My Project"' }),
    });
    expect(res.status).toBe(200);
    expect(projectManager.update).toHaveBeenCalledWith("p1", {
      path: "C:\\Users\\me\\My Project",
    });
  });

  it("POST /api/projects missing name returns 400", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/projects/:id returns 200 for known id", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects/p1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/projects/:id returns 200", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects/p1", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  // iterate-2026-07-06-project-delete-cascades-tasks — deleting a project must
  // cascade to its tasks so no orphaned "Unassigned" bucket lingers. The route
  // delegates the cascade to the injected callback and reports how many tasks
  // it removed.
  it("DELETE /api/projects/:id cascades: calls onProjectDeleted(id) and returns deletedTaskCount", async () => {
    const onProjectDeleted = vi.fn(async () => 3);
    const { app } = setup({ onProjectDeleted });
    const res = await app.request("/api/projects/p1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(onProjectDeleted).toHaveBeenCalledWith("p1");
    expect(await res.json()).toEqual({ ok: true, deletedTaskCount: 3 });
  });

  it("DELETE /api/projects/:id does NOT cascade when the project is unknown (404)", async () => {
    const onProjectDeleted = vi.fn(async () => 0);
    const { app } = setup({ onProjectDeleted, deleteThrows: true });
    const res = await app.request("/api/projects/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(onProjectDeleted).not.toHaveBeenCalled();
  });

  // Iterate 3.7e-b3 (2026-04-22) — PATCH body flows through project-manager
  // update() which merges settings. This route-level test only asserts the
  // body is forwarded intact; the merge semantics are covered by the
  // project-manager unit tests separately.
  it("PATCH /api/projects/:id forwards settings.color to projectManager.update", async () => {
    const { app, projectManager } = setup();
    const res = await app.request("/api/projects/p1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { color: "#B8A590" } }),
    });
    expect(res.status).toBe(200);
    expect(projectManager.update).toHaveBeenCalledWith("p1", {
      settings: { color: "#B8A590" },
    });
  });

  // Iterate 3.7e-b3 (2026-04-22) — root-cause test for the "Create Project
  // erstellt nichts" UAT regression. When the route throws a 500 (e.g.
  // mkdirSync fails on Windows EACCES), the client must see a JSON error
  // body so ProjectWizard can render the inline banner.
  it("POST /api/projects surfaces mkdirSync failures as 500 with JSON error body", async () => {
    const { app, fsDeps } = setup();
    fsDeps.existsSync.mockReturnValue(false);
    fsDeps.mkdirSync.mockImplementation(() => {
      const err = new Error("EACCES: permission denied, mkdir 'C:\\forbidden'");
      throw err;
    });
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", path: "C:/forbidden" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    // The generic error handler returns {error: "Internal server error"} —
    // the important contract for the UI is just that a JSON body exists so
    // ProjectWizard's inline error banner has something non-empty to show.
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  // iterate-2026-05-01-vscode-workspace — POST emits a portable
  // .code-workspace file inside .shipwright-webui/ so the user can open
  // the project in VS Code with one double-click.
  describe("VS Code workspace generation on POST", () => {
    it("POST creates <slug>.code-workspace with relative '..' folder + editor terminal default", async () => {
      const { app, fsDeps } = setup();
      // Project dir + .shipwright-webui exist; workspace file does NOT.
      const wsPath = "/tmp/new/.shipwright-webui/shipwright-webui.code-workspace";
      fsDeps.existsSync.mockImplementation((p: string) => p !== wsPath);
      const res = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Shipwright WebUI", path: "/tmp/new" }),
      });
      expect(res.status).toBe(201);
      // writeFileSync called against the temp path (atomic write convention),
      // followed by renameSync to the final path.
      const writeCalls = fsDeps.writeFileSync.mock.calls;
      const renameCalls = fsDeps.renameSync.mock.calls;
      const writeCall = writeCalls.find(([p]) => String(p).endsWith(".code-workspace.tmp"));
      expect(writeCall).toBeDefined();
      const json = JSON.parse(writeCall![1] as string);
      expect(json).toEqual({
        folders: [{ path: ".." }],
        settings: {
          "terminal.integrated.defaultLocation": "editor",
          "explorer.compactFolders": false,
        },
      });
      const renameCall = renameCalls.find(([, dst]) => dst === wsPath);
      expect(renameCall).toBeDefined();
    });

    it("POST does not overwrite an existing .code-workspace", async () => {
      const { app, fsDeps } = setup();
      // Pre-existing workspace file — must be left alone.
      const wsPath = "/tmp/new/.shipwright-webui/shipwright-webui.code-workspace";
      fsDeps.existsSync.mockImplementation(() => true);
      const res = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Shipwright WebUI", path: "/tmp/new" }),
      });
      expect(res.status).toBe(201);
      const writeCalls = fsDeps.writeFileSync.mock.calls;
      const renameCalls = fsDeps.renameSync.mock.calls;
      // No write to the workspace path — neither final nor temp.
      expect(writeCalls.some(([p]) => String(p).startsWith(wsPath))).toBe(false);
      expect(renameCalls.some(([, dst]) => String(dst) === wsPath)).toBe(false);
    });

    it.each([
      ["Shipwright WebUI", "shipwright-webui"],
      ["foo  bar", "foo-bar"],
      ["  --weird name--  ", "weird-name"],
    ])("slugifies project name %j -> %j", async (inputName, expectedSlug) => {
      const { app, fsDeps } = setup();
      const wsPath = `/tmp/proj/.shipwright-webui/${expectedSlug}.code-workspace`;
      fsDeps.existsSync.mockImplementation((p: string) => p !== wsPath);
      const res = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: inputName, path: "/tmp/proj" }),
      });
      expect(res.status).toBe(201);
      const renameCall = fsDeps.renameSync.mock.calls.find(([, dst]) => dst === wsPath);
      expect(renameCall).toBeDefined();
    });

    it("PATCH /api/projects/:id does NOT touch the workspace file", async () => {
      const { app, fsDeps } = setup();
      const res = await app.request("/api/projects/p1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      });
      expect(res.status).toBe(200);
      expect(fsDeps.writeFileSync).not.toHaveBeenCalled();
      expect(fsDeps.renameSync).not.toHaveBeenCalled();
      expect(fsDeps.mkdirSync).not.toHaveBeenCalled();
    });
  });
});
