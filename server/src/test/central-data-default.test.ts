// @covers FR-01.03
/**
 * iterate-2026-10-30-central-data-default — the webui keeps its OWN files
 * (actions.json, pasted screenshots, .code-workspace) in the central data dir
 * by default; `shared` keeps them in the repo. Nothing restricts writes to the
 * user's own repo files. Real filesystem, no mocks of fs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectDataDir, projectActionsReadDir, projectDataGuardRoot } from "../core/project-data-dir.js";
import { dataStatus, migrateProjectData } from "../core/project-data-migrate.js";
import { loadActionsForProjectRecord } from "../core/project-actions-loader.js";
import { createProjectRoutes } from "../routes/projects.js";
import { registerActionsStub } from "../external/actions/stub.js";
import { registerActionsUploadDelete } from "../external/actions/upload-delete.js";
import { savePastedImage } from "../terminal/image-paste.js";
import { centralPasteRoot } from "../terminal/data-target.js";
import { buildCopyCommands } from "../core/launcher.js";
import { readShipwrightPluginVersion } from "../core/shipwright-plugin-version-reader.js";
import { errorHandler } from "../middleware/error-handler.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ACTIONS = JSON.stringify({ schemaVersion: 1, defaults: { autonomy: "guided" }, actions: [], phases: [], preview: { enabled: "auto" } });

/** path -> "size:mtimeMs" for every entry under root (dirs included). */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      out[path.relative(root, abs)] = `${st.isDirectory() ? "d" : st.size}:${st.mtimeMs}`;
      if (st.isDirectory()) walk(abs);
    }
  };
  walk(root);
  return out;
}

function realFsDeps() {
  return {
    existsSync: fs.existsSync,
    mkdirSync: (p: string, o?: { recursive: boolean }) => void fs.mkdirSync(p, o),
    writeFileSync: (p: string, d: string) => fs.writeFileSync(p, d),
    renameSync: fs.renameSync,
  };
}

let repo: string;
let dataRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cd-repo-"));
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# customer repo\n");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cd-data-"));
  prevEnv = process.env.SHIPWRIGHT_DATA_DIR;
  process.env.SHIPWRIGHT_DATA_DIR = dataRoot;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.SHIPWRIGHT_DATA_DIR;
  else process.env.SHIPWRIGHT_DATA_DIR = prevEnv;
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("projectDataDir", () => {
  // @covers FR-01.03
  it("default project resolves under SHIPWRIGHT_DATA_DIR/projects/<id>", () => {
    const p = { id: "abc", path: repo };
    expect(projectDataDir(p)).toBe(path.join(dataRoot, "projects", "abc"));
    expect(projectDataGuardRoot(p)).toBe(projectDataDir(p));
  });

  // @covers FR-01.03
  it("shared project keeps the in-repo dir", () => {
    const p = { id: "a", path: repo, shared: true };
    expect(projectDataDir(p)).toBe(path.join(repo, ".shipwright-webui"));
    expect(projectDataGuardRoot(p)).toBe(repo);
  });

  // @covers FR-01.03
  it("reads a legacy in-repo actions.json until a central one exists", () => {
    const p = { id: "l1", path: repo };
    fs.mkdirSync(path.join(repo, ".shipwright-webui"));
    fs.writeFileSync(path.join(repo, ".shipwright-webui", "actions.json"), ACTIONS);
    expect(projectActionsReadDir(p)).toBe(path.join(repo, ".shipwright-webui"));
    expect(loadActionsForProjectRecord(p).fromUser).toBe(true);
    fs.mkdirSync(projectDataDir(p), { recursive: true });
    fs.writeFileSync(path.join(projectDataDir(p), "actions.json"), ACTIONS);
    expect(projectActionsReadDir(p)).toBe(projectDataDir(p));
  });
});

describe("default project leaves the repo untouched", () => {
  const project = () => ({ id: "c1", name: "Customer", path: repo });

  // @covers FR-01.03
  it("POST /api/projects writes no repo file; the workspace file is central with an absolute path", async () => {
    const before = snapshot(repo);
    const app = new Hono();
    app.onError(errorHandler);
    const manager = { create: (d: object) => ({ id: "c1", ...d }) };
    app.route("/", createProjectRoutes(manager as never, realFsDeps()));
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Customer", path: repo, profile: "x" }),
    });
    expect(res.status).toBe(201);
    expect(snapshot(repo)).toEqual(before);
    const ws = JSON.parse(fs.readFileSync(path.join(dataRoot, "projects", "c1", "customer.code-workspace"), "utf8"));
    expect(ws.folders[0].path).toBe(repo);
  });

  // @covers FR-01.03
  it("a shared project still gets .shipwright-webui in the repo", async () => {
    const app = new Hono();
    const manager = { create: (d: object) => ({ id: "s1", ...d }) };
    app.route("/", createProjectRoutes(manager as never, realFsDeps()));
    await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Mine", path: repo, profile: "x", shared: true }),
    });
    expect(fs.existsSync(path.join(repo, ".shipwright-webui", "mine.code-workspace"))).toBe(true);
  });

  // @covers FR-01.03
  it("actions stub/reset use the central dir; the loader reads it back", async () => {
    const before = snapshot(repo);
    const app = new Hono();
    const deps = { getProjectById: (id: string) => (id === "c1" ? project() : undefined) };
    registerActionsStub(app, deps);
    registerActionsUploadDelete(app, deps);

    expect((await app.request("/api/projects/c1/actions-stub", { method: "POST" })).status).toBe(200);
    const central = path.join(dataRoot, "projects", "c1", "actions.json");
    expect(fs.existsSync(central)).toBe(true);
    expect(snapshot(repo)).toEqual(before);
    expect(loadActionsForProjectRecord(project()).fromUser).toBe(true);

    const del = await app.request("/api/projects/c1/actions-upload", { method: "DELETE" });
    expect((await del.json()).removed).toBe(true);
    expect(fs.existsSync(central)).toBe(false);
  });

  // @covers FR-01.03
  it("reset removes a legacy in-repo actions.json too", async () => {
    fs.mkdirSync(path.join(repo, ".shipwright-webui"));
    const legacy = path.join(repo, ".shipwright-webui", "actions.json");
    fs.writeFileSync(legacy, ACTIONS);
    const app = new Hono();
    registerActionsUploadDelete(app, { getProjectById: () => project() });
    await app.request("/api/projects/c1/actions-upload", { method: "DELETE" });
    expect(fs.existsSync(legacy)).toBe(false);
  });

  // @covers FR-01.03
  it("pasted images land in the central dir; no gitignore suggestion", async () => {
    const before = snapshot(repo);
    const root = centralPasteRoot("c1", (id) => (id === "c1" ? project() : undefined));
    expect(root).toBe(path.join(dataRoot, "projects", "c1"));
    const res = await savePastedImage({ cwd: repo, bytes: PNG, keepLast: 5, centralDir: root ?? undefined });
    expect(res.absolutePath.startsWith(path.join(dataRoot, "projects", "c1", "pastes"))).toBe(true);
    expect(res.gitignoreSuggestion).toBe(false);
    expect(snapshot(repo)).toEqual(before);
  });

  // @covers FR-01.03
  it("a shared project pastes into <cwd>/.shipwright-webui/pastes", async () => {
    expect(centralPasteRoot("s1", () => ({ id: "s1", path: repo, shared: true }))).toBeNull();
    const res = await savePastedImage({ cwd: repo, bytes: PNG, keepLast: 5 });
    expect(res.absolutePath).toContain(path.join(".shipwright-webui", "pastes"));
  });
});

describe("migrate-data", () => {
  const legacy = () => path.join(repo, ".shipwright-webui");
  const seed = () => {
    fs.mkdirSync(path.join(legacy(), "pastes"), { recursive: true });
    fs.writeFileSync(path.join(legacy(), "actions.json"), ACTIONS);
    fs.writeFileSync(path.join(legacy(), "pastes", "a.png"), PNG);
  };

  // @covers FR-01.03
  it("moves actions.json + pastes centrally and removes the emptied legacy dir", () => {
    seed();
    const p = { id: "m1", path: repo };
    expect(dataStatus(p).legacyPresent).toBe(true);
    const r = migrateProjectData(p);
    expect(r.moved.sort()).toEqual(["actions.json", path.join("pastes", "a.png")].sort());
    expect(fs.existsSync(path.join(dataRoot, "projects", "m1", "actions.json"))).toBe(true);
    expect(fs.existsSync(legacy())).toBe(false);
    expect(dataStatus(p).legacyPresent).toBe(false);
    expect(migrateProjectData(p).moved).toEqual([]); // idempotent
  });

  // @covers FR-01.03
  it("never overwrites an existing central file", () => {
    seed();
    const p = { id: "m2", path: repo };
    fs.mkdirSync(projectDataDir(p), { recursive: true });
    fs.writeFileSync(path.join(projectDataDir(p), "actions.json"), "{\"keep\":true}");
    const r = migrateProjectData(p);
    expect(r.conflicts).toEqual(["actions.json"]);
    expect(fs.readFileSync(path.join(projectDataDir(p), "actions.json"), "utf8")).toBe("{\"keep\":true}");
    expect(fs.existsSync(path.join(legacy(), "actions.json"))).toBe(true);
  });

  // @covers FR-01.03
  it("is a no-op for a shared project", () => {
    seed();
    const p = { id: "m3", path: repo, shared: true };
    expect(dataStatus(p).legacyPresent).toBe(false);
    expect(migrateProjectData(p).moved).toEqual([]);
    expect(fs.existsSync(path.join(legacy(), "actions.json"))).toBe(true);
  });
});

describe("runs without Shipwright plugins", () => {
  // @covers FR-01.03
  it("a default launch command carries no --plugin-dir", () => {
    const c = buildCopyCommands({ sessionUuid: "00000000-0000-4000-8000-000000000000", cwd: repo });
    for (const form of [c.powershell, c.cmd, c.posix]) expect(form).not.toContain("--plugin-dir");
  });

  // @covers FR-01.03
  it("a missing plugin marketplace resolves to null instead of throwing", async () => {
    expect(await readShipwrightPluginVersion({ homedir: () => dataRoot })).toBeNull();
  });
});

describe("migrate-data / data-status routes", () => {
  const appFor = (project: object | undefined) => {
    const app = new Hono();
    app.onError(errorHandler);
    app.route("/", createProjectRoutes({ getById: () => project } as never));
    return app;
  };

  // @covers FR-01.03
  it("data-status reports legacy files; migrate-data moves them", async () => {
    fs.mkdirSync(path.join(repo, ".shipwright-webui"));
    fs.writeFileSync(path.join(repo, ".shipwright-webui", "actions.json"), ACTIONS);
    const app = appFor({ id: "h1", path: repo });
    expect((await (await app.request("/api/projects/h1/data-status")).json()).data.legacyPresent).toBe(true);
    const res = await app.request("/api/projects/h1/migrate-data", { method: "POST" });
    expect((await res.json()).data.moved).toEqual(["actions.json"]);
    expect(fs.existsSync(path.join(dataRoot, "projects", "h1", "actions.json"))).toBe(true);
  });

  // @covers FR-01.03
  it("404s for an unknown project", async () => {
    const app = appFor(undefined);
    expect((await app.request("/api/projects/x/data-status")).status).toBe(404);
    expect((await app.request("/api/projects/x/migrate-data", { method: "POST" })).status).toBe(404);
  });
});
