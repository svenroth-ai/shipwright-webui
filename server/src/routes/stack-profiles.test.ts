/**
 * @covers FR-01.75
 * Routes + create-from-bundled against a fake resolver (real temp dirs for the
 * write surface; the spawn is stubbed so no uv/python is needed).
 */
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStackProfilesRoutes } from "./stack-profiles.js";
import type { CliChildSpawnFn } from "../core/cli-child-spawn.js";
import type { RunFn } from "../core/readiness-probe.js";

let dir: string;
let bundledPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sp-"));
  bundledPath = join(dir, "vite-hono.json");
  writeFileSync(bundledPath, JSON.stringify({ name: "vite-hono", schema_version: 1, stack: { frontend: "vite" } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const entry = (name: string, source: string, path: string, valid = true) => ({
  name, source, path, valid, error: valid ? null : "bad", kind: null, schema_version: 1, description: null, shadows: [],
});

/** Fake resolver: `list` reflects what is on disk; `validate` accepts any written file. */
function fakeSpawn(userDir: string): CliChildSpawnFn {
  return async (_bin, args) => {
    const sub = args.find((a) => a === "list" || a === "validate");
    if (sub === "list") {
      const profiles = [entry("vite-hono", "bundled", bundledPath)];
      if (existsSync(join(userDir, "mine.json"))) profiles.push(entry("mine", "user", join(userDir, "mine.json")));
      return { code: 0, stderr: "", stdout: JSON.stringify({ contract_version: 1, profiles, warnings: [], searched: [] }) };
    }
    const name = (args.find((a) => a.startsWith("--name=")) ?? "").slice("--name=".length);
    if (name === "mine") return { code: 0, stderr: "", stdout: `profile 'mine'\n${JSON.stringify({ valid: true, name, source: "user", path: join(userDir, "mine.json"), schema_version: 1, shadows: [], warnings: [], searched: [] })}` };
    return { code: 2, stderr: `error: Stack profile '${name}' not found.\n`, stdout: "" };
  };
}
const run: RunFn = async () => ({ ok: true, stdout: "uv", stderr: "" }) as never;

function app(userDir: string) {
  return createStackProfilesRoutes({
    getProjectPath: (id) => (id === "p1" ? join(dir, "proj") : undefined),
    deps: { run, spawn: fakeSpawn(userDir), existsFn: () => true, homeDir: dir, userProfilesDir: userDir },
  });
}
const post = (a: ReturnType<typeof app>, path: string, body: unknown) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("stack-profiles routes", () => {
  it("lists through the resolver and 404s an unknown project", async () => {
    const a = app(join(dir, "u"));
    const ok = await (await a.request("/api/stack-profiles")).json();
    expect(ok.status).toBe("ok");
    expect(ok.report.profiles[0].source).toBe("bundled");
    expect((await a.request("/api/stack-profiles?projectId=nope")).status).toBe(404);
  });

  it("creates a user profile from a bundled one, renamed, never overwriting", async () => {
    const userDir = join(dir, "u");
    const a = app(userDir);
    const res = await post(a, "/api/stack-profiles", { from: "vite-hono", name: "mine", scope: "user" });
    expect(res.status).toBe(201);
    const written = JSON.parse(readFileSync(join(userDir, "mine.json"), "utf-8"));
    expect(written.name).toBe("mine");
    expect(written.stack).toEqual({ frontend: "vite" });
    // second create of the same name → conflict, file untouched
    expect((await post(a, "/api/stack-profiles", { from: "vite-hono", name: "mine", scope: "user" })).status).toBe(409);
  });

  it("rejects bad names, reserved names, non-bundled sources and missing scope", async () => {
    const a = app(join(dir, "u"));
    for (const name of ["../evil", "Has Caps", "generic", "con", ""]) {
      expect((await post(a, "/api/stack-profiles", { from: "vite-hono", name, scope: "user" })).status).toBe(400);
    }
    expect((await post(a, "/api/stack-profiles", { from: "nope", name: "x1", scope: "user" })).status).toBe(400);
    expect((await post(a, "/api/stack-profiles", { from: "vite-hono", name: "x1" })).status).toBe(400);
    expect((await post(a, "/api/stack-profiles", { from: "vite-hono", name: "x1", scope: "project" })).status).toBe(400);
  });

  it("a user-scope create also refuses a name the chosen project already has", async () => {
    const userDir = join(dir, "u");
    const a = createStackProfilesRoutes({
      getProjectPath: (id) => (id === "p1" ? join(dir, "proj") : undefined),
      deps: {
        run, existsFn: () => true, homeDir: dir, userProfilesDir: userDir,
        spawn: async (_b, args) => {
          const sub = args.find((x) => x === "list" || x === "validate");
          // the project has "taken"; it is only visible when --project-root is passed
          const profiles = [entry("vite-hono", "bundled", bundledPath), ...(args.includes("--project-root") ? [entry("taken", "project", "/p/taken.json")] : [])];
          return sub === "list"
            ? { code: 0, stderr: "", stdout: JSON.stringify({ contract_version: 1, profiles, warnings: [], searched: [] }) }
            : { code: 0, stderr: "", stdout: JSON.stringify({ valid: true, name: "x" }) };
        },
      },
    });
    const res = await post(a, "/api/stack-profiles", { from: "vite-hono", name: "taken", scope: "user", projectId: "p1" });
    expect(res.status).toBe(409);
    expect(existsSync(join(userDir, "taken.json"))).toBe(false);
  });

  it("removes the copy when the resolver resolves the name to a DIFFERENT file", async () => {
    const userDir = join(dir, "u");
    const a = createStackProfilesRoutes({
      getProjectPath: () => undefined,
      deps: {
        run, existsFn: () => true, homeDir: dir, userProfilesDir: userDir,
        spawn: async (_b, args) =>
          args.includes("list")
            ? { code: 0, stderr: "", stdout: JSON.stringify({ contract_version: 1, profiles: [entry("vite-hono", "bundled", bundledPath)], warnings: [], searched: [] }) }
            : { code: 0, stderr: "", stdout: JSON.stringify({ valid: true, name: "dup", source: "project", path: join(dir, "elsewhere", "dup.json") }) },
      },
    });
    const res = await post(a, "/api/stack-profiles", { from: "vite-hono", name: "dup", scope: "user" });
    expect(res.status).toBe(500);
    expect(existsSync(join(userDir, "dup.json"))).toBe(false);
  });

  it("removes a created file the resolver rejects", async () => {
    const userDir = join(dir, "u");
    const a = app(userDir);
    // "zzz" is not accepted by the fake validate → create must roll back
    const res = await post(a, "/api/stack-profiles", { from: "vite-hono", name: "zzz", scope: "user" });
    expect(res.status).toBe(500);
    expect(existsSync(join(userDir, "zzz.json"))).toBe(false);
  });

  it("validate reports an unknown profile as data, not a transport failure", async () => {
    const a = app(join(dir, "u"));
    const body = await (await post(a, "/api/stack-profiles/validate", { name: "ghost" })).json();
    expect(body).toEqual({ status: "ok", report: { valid: false, name: "ghost", error: "Stack profile 'ghost' not found." } });
    expect((await post(a, "/api/stack-profiles/validate", {})).status).toBe(400);
    // an option-looking name never reaches argv
    const evil = await (await post(a, "/api/stack-profiles/validate", { name: "--project-root" })).json();
    expect(evil.report.valid).toBe(false);
  });
});
