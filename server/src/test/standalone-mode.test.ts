// @covers FR-01.03
/**
 * iterate-2026-10-29-standalone-mode — a STANDALONE project leaves its repo
 * byte-identical: every webui file for it lives in the central data dir, and
 * the repo-writing surfaces are refused. Real filesystem, no mocks of fs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectDataDir, projectDataGuardRoot } from "../core/project-data-dir.js";
import { loadActionsForProjectRecord } from "../core/project-actions-loader.js";
import { createProjectRoutes } from "../routes/projects.js";
import { registerActionsStub } from "../external/actions/stub.js";
import { registerActionsUploadDelete } from "../external/actions/upload-delete.js";
import { standaloneGuard } from "../middleware/standalone-guard.js";
import { savePastedImage } from "../terminal/image-paste.js";
import { standalonePasteRoot } from "../terminal/standalone-target.js";
import { buildCopyCommands } from "../core/launcher.js";
import { readShipwrightPluginVersion } from "../core/shipwright-plugin-version-reader.js";
import { errorHandler } from "../middleware/error-handler.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "sa-repo-"));
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# customer repo\n");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa-data-"));
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
  it("regular project keeps the in-repo dir", () => {
    const p = { id: "a", path: repo };
    expect(projectDataDir(p)).toBe(path.join(repo, ".shipwright-webui"));
    expect(projectDataGuardRoot(p)).toBe(repo);
  });

  it("standalone project resolves under SHIPWRIGHT_DATA_DIR/projects/<id>", () => {
    const p = { id: "abc", path: repo, standalone: true };
    expect(projectDataDir(p)).toBe(path.join(dataRoot, "projects", "abc"));
    expect(projectDataGuardRoot(p)).toBe(projectDataDir(p));
  });
});

describe("standalone project leaves the repo untouched", () => {
  const project = () => ({ id: "sa1", name: "Customer", path: repo, standalone: true });

  it("POST /api/projects writes no .shipwright-webui and no .code-workspace", async () => {
    const before = snapshot(repo);
    const app = new Hono();
    app.onError(errorHandler);
    const manager = { create: (d: object) => ({ id: "sa1", ...d }) };
    app.route("/", createProjectRoutes(manager as never, realFsDeps()));
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Customer", path: repo, profile: "x", standalone: true }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.standalone).toBe(true);
    expect(snapshot(repo)).toEqual(before);
  });

  it("a regular project still gets .shipwright-webui (behaviour unchanged)", async () => {
    const app = new Hono();
    const manager = { create: (d: object) => ({ id: "r1", ...d }) };
    app.route("/", createProjectRoutes(manager as never, realFsDeps()));
    await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Mine", path: repo, profile: "x" }),
    });
    expect(fs.existsSync(path.join(repo, ".shipwright-webui", "mine.code-workspace"))).toBe(true);
  });

  it("actions stub/reset use the central dir; the loader reads it back", async () => {
    const before = snapshot(repo);
    const app = new Hono();
    const deps = { getProjectById: (id: string) => (id === "sa1" ? project() : undefined) };
    registerActionsStub(app, deps);
    registerActionsUploadDelete(app, deps);

    const stub = await app.request("/api/projects/sa1/actions-stub", { method: "POST" });
    expect(stub.status).toBe(200);
    const central = path.join(dataRoot, "projects", "sa1", "actions.json");
    expect(fs.existsSync(central)).toBe(true);
    expect(snapshot(repo)).toEqual(before);
    expect(loadActionsForProjectRecord(project()).fromUser).toBe(true);

    const del = await app.request("/api/projects/sa1/actions-upload", { method: "DELETE" });
    expect((await del.json()).removed).toBe(true);
    expect(fs.existsSync(central)).toBe(false);
    expect(snapshot(repo)).toEqual(before);
  });

  it("pasted images land in the central dir; no gitignore suggestion", async () => {
    const before = snapshot(repo);
    const root = standalonePasteRoot("sa1", (id) => (id === "sa1" ? project() : undefined));
    expect(root).toBe(path.join(dataRoot, "projects", "sa1"));
    const res = await savePastedImage({
      cwd: repo,
      bytes: PNG,
      keepLast: 5,
      centralDir: root ?? undefined,
    });
    expect(res.absolutePath.startsWith(path.join(dataRoot, "projects", "sa1", "pastes"))).toBe(true);
    expect(res.gitignoreSuggestion).toBe(false);
    expect(snapshot(repo)).toEqual(before);
  });

  it("a regular project still pastes into <cwd>/.shipwright-webui/pastes", async () => {
    expect(standalonePasteRoot("r1", () => ({ id: "r1", path: repo }))).toBeNull();
    const res = await savePastedImage({ cwd: repo, bytes: PNG, keepLast: 5 });
    expect(res.absolutePath).toContain(path.join(".shipwright-webui", "pastes"));
  });
});

describe("standaloneGuard", () => {
  const makeApp = () => {
    const a = new Hono();
    const projects: Record<string, { id: string; path: string; standalone?: boolean }> = {
      sa: { id: "sa", path: "/x", standalone: true },
      reg: { id: "reg", path: "/y" },
    };
    a.use("/api/*", standaloneGuard((id) => projects[id]));
    a.all("/api/*", (c) => c.json({ ok: true }));
    return a;
  };

  it.each([
    ["PUT", "/api/external/projects/sa/file?path=a.md"],
    ["POST", "/api/external/projects/sa/design-feedback"],
    ["POST", "/api/triage/sa/dismiss"],
    ["POST", "/api/campaigns/sa/slug/start"],
    ["GET", "/api/campaigns/sa/slug/readiness"],
  ])("refuses %s %s for a standalone project", async (method, url) => {
    const res = await makeApp().request(url, { method });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("standalone_project_read_only");
  });

  it("lets reads and regular projects through", async () => {
    expect((await makeApp().request("/api/triage/sa/items")).status).toBe(200);
    expect((await makeApp().request("/api/triage/reg/dismiss", { method: "POST" })).status).toBe(200);
    expect((await makeApp().request("/api/projects/sa/anything", { method: "POST" })).status).toBe(200);
  });
});

describe("runs without Shipwright plugins", () => {
  it("a default launch command carries no --plugin-dir", () => {
    const c = buildCopyCommands({ sessionUuid: "00000000-0000-4000-8000-000000000000", cwd: repo });
    for (const form of [c.powershell, c.cmd, c.posix]) expect(form).not.toContain("--plugin-dir");
  });

  it("a missing plugin marketplace resolves to null instead of throwing", async () => {
    const v = await readShipwrightPluginVersion({ homedir: () => dataRoot });
    expect(v).toBeNull();
  });
});
