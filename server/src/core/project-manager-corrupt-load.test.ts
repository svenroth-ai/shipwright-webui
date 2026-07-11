/*
 * project-manager-corrupt-load.test.ts — F07 (D08): ProjectManager.load()
 * tolerates a corrupt/truncated projects.json instead of exiting FATAL, and
 * persist() writes atomically (tmp+rename).
 *
 * Lives in its own file (not project-manager.test.ts) because that file is at
 * its bloat ceiling. The ProjectManager-level cases here are the regression
 * proof: they are RED on pre-fix `main` (bare JSON.parse throws → load()
 * rejects) and green after. The project-registry-io block unit-tests the
 * extracted helpers directly.
 */

import { describe, it, expect, vi } from "vitest";

import { ProjectManager, type ProjectManagerDeps } from "./project-manager.js";
import {
  parseProjectRegistry,
  loadProjectRegistry,
  atomicWriteRegistry,
  quarantineCorruptRegistry,
  type RegistryIoDeps,
} from "./project-registry-io.js";

// ── ProjectManager end-to-end (RED on pre-fix main) ──────────────────────────
describe("ProjectManager corrupt projects.json tolerance (F07 / D08)", () => {
  function corruptDeps(initial: string): {
    deps: ProjectManagerDeps;
    store: Record<string, string>;
    renameCalls: Array<[string, string]>;
  } {
    const store: Record<string, string> = { "/reg/projects.json": initial };
    const renameCalls: Array<[string, string]> = [];
    const deps: ProjectManagerDeps = {
      readFile: vi.fn(async (p: string) => store[p] ?? ""),
      writeFile: vi.fn(async (p: string, d: string) => { store[p] = d; }),
      existsSync: vi.fn((p: string) => {
        if (p === "/reg/projects.json") return "/reg/projects.json" in store;
        if (p.includes(".corrupt-") || p.includes(".tmp-")) return p in store;
        return true; // parent dir + project paths always "exist"
      }),
      mkdirSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      rename: vi.fn(async (from: string, to: string) => {
        renameCalls.push([from, to]);
        if (from in store) {
          store[to] = store[from];
          delete store[from];
        }
      }),
    };
    return { deps, store, renameCalls };
  }

  it("load over an empty file does not throw and yields an empty registry", async () => {
    const { deps, renameCalls } = corruptDeps("");
    const pm = new ProjectManager("/reg/projects.json", deps);
    await expect(pm.load()).resolves.toBeUndefined();
    expect(pm.getAll()).toHaveLength(0);
    expect(renameCalls).toHaveLength(0); // empty ≠ corrupt: nothing to preserve
  });

  it("load over whitespace-only content yields an empty registry (no quarantine)", async () => {
    const { deps, renameCalls } = corruptDeps("   \n  ");
    const pm = new ProjectManager("/reg/projects.json", deps);
    await pm.load();
    expect(pm.getAll()).toHaveLength(0);
    expect(renameCalls).toHaveLength(0);
  });

  it("load over truncated JSON does not throw, renames the file aside, yields empty", async () => {
    const { deps, store, renameCalls } = corruptDeps(
      '[\n  {\n    "id": "p1",\n    "name": "Half',
    );
    const pm = new ProjectManager("/reg/projects.json", deps);
    await expect(pm.load()).resolves.toBeUndefined();
    expect(pm.getAll()).toHaveLength(0);
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0][0]).toBe("/reg/projects.json");
    expect(renameCalls[0][1]).toMatch(/\.corrupt-\d+-[0-9a-f-]+$/);
    // Original path no longer holds the corrupt bytes (moved aside).
    expect(store["/reg/projects.json"]).toBeUndefined();
  });

  it("load over valid JSON that is not an array quarantines and yields empty", async () => {
    const { deps, renameCalls } = corruptDeps('{"not":"an array"}');
    const pm = new ProjectManager("/reg/projects.json", deps);
    await pm.load();
    expect(pm.getAll()).toHaveLength(0);
    expect(renameCalls).toHaveLength(1);
  });

  it("load over a well-formed array still populates the registry", async () => {
    const projects = [{ id: "p1", name: "Ok", path: "/tmp/a", profile: "default", status: "active", createdAt: "2026-01-01", lastActive: "2026-01-01" }];
    const { deps } = corruptDeps(JSON.stringify(projects));
    const pm = new ProjectManager("/reg/projects.json", deps);
    await pm.load();
    expect(pm.getById("p1")).toBeDefined();
  });

  it("persist writes atomically via a tmp file + rename when a rename dep is present", async () => {
    const { deps, store, renameCalls } = corruptDeps("[]");
    const pm = new ProjectManager("/reg/projects.json", deps);
    await pm.load();
    pm.create({ name: "Test", path: "/tmp/proj", profile: "default", status: "active" });
    // Fire-and-forget persist — let it settle.
    await new Promise((r) => setTimeout(r, 10));
    const tmpWrites = (deps.writeFile as any).mock.calls.filter(
      ([p]: [string]) => /\.tmp-/.test(p),
    );
    expect(tmpWrites.length).toBeGreaterThanOrEqual(1);
    const tmpRename = renameCalls.find(([, to]) => to === "/reg/projects.json");
    expect(tmpRename).toBeDefined();
    expect(tmpRename![0]).toMatch(/\.tmp-/);
    // Prove the final path was populated via rename, not a direct write — a
    // non-atomic impl writing both paths directly must NOT satisfy this test.
    const directWrites = (deps.writeFile as any).mock.calls.filter(
      ([p]: [string]) => p === "/reg/projects.json",
    );
    expect(directWrites).toHaveLength(0);
    const onDisk = JSON.parse(store["/reg/projects.json"]) as Array<{ name: string }>;
    expect(onDisk.some((p) => p.name === "Test")).toBe(true);
  });

  it("persist falls back to a plain in-place write when no rename dep is injected", async () => {
    const store: Record<string, string> = { "/reg/projects.json": "[]" };
    const deps: ProjectManagerDeps = {
      readFile: vi.fn(async (p: string) => store[p] ?? ""),
      writeFile: vi.fn(async (p: string, d: string) => { store[p] = d; }),
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
      readdirSync: vi.fn(() => []),
    };
    const pm = new ProjectManager("/reg/projects.json", deps);
    await pm.load();
    pm.create({ name: "Test", path: "/tmp/proj", profile: "default", status: "active" });
    await new Promise((r) => setTimeout(r, 10));
    const tmpWrites = (deps.writeFile as any).mock.calls.filter(
      ([p]: [string]) => /\.tmp-/.test(p),
    );
    expect(tmpWrites).toHaveLength(0);
    const onDisk = JSON.parse(store["/reg/projects.json"]) as Array<{ name: string }>;
    expect(onDisk.some((p) => p.name === "Test")).toBe(true);
  });
});

// ── project-registry-io unit tests ───────────────────────────────────────────
describe("project-registry-io (F07 / D08)", () => {
  function ioDeps(files: Record<string, string> = {}): {
    deps: RegistryIoDeps;
    files: Record<string, string>;
    renameCalls: Array<[string, string]>;
  } {
    const renameCalls: Array<[string, string]> = [];
    const deps: RegistryIoDeps = {
      readFile: vi.fn(async (p: string) => files[p] ?? ""),
      writeFile: vi.fn(async (p: string, d: string) => { files[p] = d; }),
      existsSync: vi.fn((p: string) => p in files),
      mkdirSync: vi.fn(),
      rename: vi.fn(async (from: string, to: string) => {
        renameCalls.push([from, to]);
        if (from in files) { files[to] = files[from]; delete files[from]; }
      }),
    };
    return { deps, files, renameCalls };
  }

  it("parseProjectRegistry classifies empty / whitespace / corrupt / array", () => {
    expect(parseProjectRegistry("")).toEqual({ kind: "empty" });
    expect(parseProjectRegistry("   \n")).toEqual({ kind: "empty" });
    expect(parseProjectRegistry("[oops")).toEqual({ kind: "corrupt" });
    expect(parseProjectRegistry("null")).toEqual({ kind: "corrupt" });
    expect(parseProjectRegistry('{"a":1}')).toEqual({ kind: "corrupt" });
    const arr = parseProjectRegistry("[]");
    expect(arr.kind).toBe("projects");
  });

  it("loadProjectRegistry creates an empty registry when the file is missing", async () => {
    const { deps, files } = ioDeps({});
    const map = await loadProjectRegistry(deps, "/reg/projects.json");
    expect(map.size).toBe(0);
    expect(files["/reg/projects.json"]).toBe("[]");
  });

  it("loadProjectRegistry skips rows without a string id", async () => {
    const rows = JSON.stringify([{ id: "ok", name: "A" }, { name: "no-id" }, null, 42]);
    const { deps } = ioDeps({ "/reg/projects.json": rows });
    const map = await loadProjectRegistry(deps, "/reg/projects.json");
    expect(map.size).toBe(1);
    expect(map.get("ok")).toBeDefined();
  });

  it("loadProjectRegistry quarantines corrupt bytes and returns an empty map", async () => {
    const { deps, files, renameCalls } = ioDeps({ "/reg/projects.json": "[trunc" });
    const map = await loadProjectRegistry(deps, "/reg/projects.json");
    expect(map.size).toBe(0);
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0][1]).toMatch(/\.corrupt-\d+-[0-9a-f-]+$/);
    expect(files["/reg/projects.json"]).toBeUndefined();
  });

  // Finding 1 (coordinator) — a boot load must never throw-and-brick. An
  // unreadable projects.json (transient EBUSY/EPERM/EACCES lock, the same
  // force-kill class F07 targets) is retried on the rule-6 budget, then degrades
  // to an empty registry instead of a FATAL exit.
  it("loadProjectRegistry retries then starts empty (no throw) when the read persistently fails (EBUSY)", async () => {
    vi.useFakeTimers();
    try {
      const err = Object.assign(new Error("locked"), { code: "EBUSY" });
      const deps: RegistryIoDeps = {
        readFile: vi.fn(async () => { throw err; }),
        writeFile: vi.fn(async () => {}),
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
      };
      const pending = loadProjectRegistry(deps, "/reg/projects.json");
      await vi.runAllTimersAsync();
      const map = await pending;
      expect(map.size).toBe(0);
      // Exhausted the full rule-6 budget (6 attempts) before degrading to empty.
      expect((deps.readFile as any).mock.calls.length).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("quarantineCorruptRegistry copies bytes aside via writeFile when no rename dep", async () => {
    const files: Record<string, string> = { "/reg/projects.json": "[bad" };
    const deps: RegistryIoDeps = {
      readFile: vi.fn(async (p: string) => files[p] ?? ""),
      writeFile: vi.fn(async (p: string, d: string) => { files[p] = d; }),
      existsSync: vi.fn((p: string) => p in files),
      mkdirSync: vi.fn(),
    };
    await quarantineCorruptRegistry(deps, "/reg/projects.json", "[bad");
    const aside = Object.keys(files).filter((k) => /\.corrupt-\d+-[0-9a-f-]+$/.test(k));
    expect(aside).toHaveLength(1);
    expect(files[aside[0]]).toBe("[bad");
  });

  it("quarantineCorruptRegistry never throws even if the fs op fails", async () => {
    const deps: RegistryIoDeps = {
      readFile: vi.fn(async () => ""),
      writeFile: vi.fn(async () => {}),
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
      rename: vi.fn(async () => { throw new Error("EPERM"); }),
    };
    await expect(
      quarantineCorruptRegistry(deps, "/reg/projects.json", "[bad"),
    ).resolves.toBeUndefined();
  });

  it("atomicWriteRegistry stages to a tmp file then renames into place", async () => {
    const { deps, files, renameCalls } = ioDeps({});
    await atomicWriteRegistry(deps, "/reg/projects.json", "[1]");
    expect(files["/reg/projects.json"]).toBe("[1]");
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0][0]).toMatch(/\.tmp-/);
    expect(renameCalls[0][1]).toBe("/reg/projects.json");
    // The staging write targets ONLY the tmp path — never the live file directly.
    const writeTargets = (deps.writeFile as any).mock.calls.map(([p]: [string]) => p);
    expect(writeTargets).not.toContain("/reg/projects.json");
    expect(writeTargets.every((p: string) => p.includes(".tmp-"))).toBe(true);
  });

  it("atomicWriteRegistry falls back to a plain write when no rename dep", async () => {
    const files: Record<string, string> = {};
    const deps: RegistryIoDeps = {
      readFile: vi.fn(async () => ""),
      writeFile: vi.fn(async (p: string, d: string) => { files[p] = d; }),
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
    };
    await atomicWriteRegistry(deps, "/reg/projects.json", "[2]");
    expect(files["/reg/projects.json"]).toBe("[2]");
    const tmpKeys = Object.keys(files).filter((k) => /\.tmp-/.test(k));
    expect(tmpKeys).toHaveLength(0);
  });
});
