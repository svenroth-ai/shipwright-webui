/**
 * @covers FR-01.75
 * Adopt-screen scan: read-only, one at a time, never writes into the repo,
 * tolerant of snapshot 1.0, refuses an unknown major. The analyzer spawn is
 * faked (it writes the snapshot to the `--output` it was given, like the real one).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractProfile, resolveAnalyzerScript, scanRepoProfile } from "./adopt-scan.js";
import { createAdoptScanRoutes } from "../routes/adopt-scan.js";
import type { CliChildSpawnFn } from "./cli-child-spawn.js";
import type { RunFn } from "./readiness-probe.js";

let root: string;
let repo: string;
let home: string;
let script: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "as-"));
  repo = join(root, "repo");
  home = join(root, "home");
  mkdirSync(repo);
  mkdirSync(home);
  script = join(root, "analyze_codebase.py");
  writeFileSync(script, "# fake");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run: RunFn = async () => ({ ok: true, stdout: "uv", stderr: "" }) as never;
const snap = (profile: unknown, schema_version: unknown = "1.1") => ({ schema_version, profile });
function spawnWriting(body: unknown, extra: Partial<{ code: number; stderr: string; spawnError: string }> = {}): CliChildSpawnFn {
  return async (_bin, args) => {
    const out = args[args.indexOf("--output") + 1];
    if (out && body !== undefined) writeFileSync(out, JSON.stringify(body));
    return { code: extra.code ?? 0, stdout: "", stderr: extra.stderr ?? "", spawnError: extra.spawnError };
  };
}
const deps = (spawn: CliChildSpawnFn, tmpRoot?: string) => ({ run, spawn, homeDir: home, scriptOverride: script, tmpRoot: tmpRoot ?? root });

describe("scanRepoProfile", () => {
  it("// @covers FR-01.75 returns the detected profile with source + warnings and cleans up", async () => {
    const tmp = join(root, "tmp");
    mkdirSync(tmp);
    const r = await scanRepoProfile({ path: repo }, deps(spawnWriting(snap({ matched: "vite-hono", confidence: 0.9, source: "user", warnings: ["skipped x: invalid"] })), tmp));
    expect(r).toEqual({ status: "ok", findings: {}, profile: { matched: "vite-hono", confidence: 0.9, source: "user", warnings: ["skipped x: invalid"] } });
    expect(readdirSync(tmp)).toEqual([]);
    expect(readdirSync(repo)).toEqual([]);
  });

  it("// @covers FR-01.75 always points the analyzer's output outside the repo", async () => {
    let seen: string[] = [];
    await scanRepoProfile({ path: repo }, deps(async (_b, args) => {
      seen = args;
      return { code: 1, stdout: "", stderr: "" };
    }));
    const out = seen[seen.indexOf("--output") + 1];
    expect(out).toBeTruthy();
    expect(out.startsWith(repo)).toBe(false);
    expect(seen).toContain("--project-root");
  });

  it("// @covers FR-01.75 a 1.0 snapshot (no source / warnings) stays readable", async () => {
    const r = await scanRepoProfile({ path: repo }, deps(spawnWriting(snap({ matched: "vite-hono", confidence: 0.8 }, "1.0"))));
    expect(r).toEqual({ status: "ok", findings: {}, profile: { matched: "vite-hono", confidence: 0.8, source: null, warnings: [] } });
  });

  it("// @covers FR-01.75 an unknown or non-positive major is refused on the server", async () => {
    expect((await scanRepoProfile({ path: repo }, deps(spawnWriting(snap({}, "2.0"))))).status).toBe("unsupported-schema");
    expect((await scanRepoProfile({ path: repo }, deps(spawnWriting(snap({}, "0.9"))))).status).toBe("unsupported-schema");
  });

  it("// @covers FR-01.75 caps and cleans warnings that come from the untrusted repo", () => {
    const many = Array.from({ length: 50 }, (_, i) => `w${i}‮\u0007${"x".repeat(500)}`);
    const r = extractProfile(snap({ matched: "a", warnings: many }));
    expect(r.status === "ok" && r.profile.warnings).toHaveLength(20);
    expect(r.status === "ok" && r.profile.warnings[0].length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(r)).not.toMatch(/\\u202e|\\u0007/);
  });

  it("// @covers FR-01.75 refuses a relative path, a missing folder, a file, a drive root and the home folder", async () => {
    const d = deps(spawnWriting(snap({})));
    const file = join(root, "f.txt");
    writeFileSync(file, "x");
    for (const p of ["relative/dir", "\\\\host\\share", join(root, "nope"), file, "", undefined, 5, parse(root).root, home]) {
      const r = await scanRepoProfile({ path: p }, d);
      expect(r.status, String(p)).toBe("invalid-path");
    }
  });

  it("// @covers FR-01.75 a UNC path is refused before any filesystem access", async () => {
    for (const p of ["\\\\host\\share\\repo", "//host/share/repo", "\\\\?\\UNC\\host\\share"]) {
      const r = await scanRepoProfile({ path: p }, deps(spawnWriting(snap({}))));
      // "Pick a folder" comes from the up-front shape check; a realpath miss would say "doesn't exist"
      expect(r, p).toMatchObject({ status: "invalid-path", reason: "Pick a folder on this computer." });
    }
  });

  it("// @covers FR-01.75 says so honestly when the analyzer or uv is missing", async () => {
    const noScript = await scanRepoProfile({ path: repo }, { run, spawn: spawnWriting(snap({})), homeDir: home, scriptOverride: join(root, "missing.py") });
    expect(noScript.status).toBe("engine-unavailable");
    const noUv = await scanRepoProfile({ path: repo }, { ...deps(spawnWriting(snap({}))), run: (async () => ({ ok: false, stdout: "", stderr: "" })) as never });
    expect(noUv.status).toBe("engine-unavailable");
  });

  it("// @covers FR-01.75 a timeout or a crash is a failure with the sample rows kept, not a profile", async () => {
    expect((await scanRepoProfile({ path: repo }, deps(spawnWriting(undefined, { code: 124, spawnError: "timeout" })))).status).toBe("failed");
    const crash = await scanRepoProfile({ path: repo }, deps(spawnWriting(undefined, { code: 1, stderr: "Traceback\nERROR: boom" })));
    expect(crash).toEqual({ status: "failed", reason: "ERROR: boom" });
  });

  it("// @covers FR-01.75 only one scan runs at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: CliChildSpawnFn = async (_b, args) => {
      await gate;
      writeFileSync(args[args.indexOf("--output") + 1], JSON.stringify(snap({ matched: "a" })));
      return { code: 0, stdout: "", stderr: "" };
    };
    const first = scanRepoProfile({ path: repo }, deps(slow));
    await new Promise((r) => setTimeout(r, 20));
    expect((await scanRepoProfile({ path: repo }, deps(slow))).status).toBe("busy");
    release();
    expect((await first).status).toBe("ok");
    expect((await scanRepoProfile({ path: repo }, deps(spawnWriting(snap({ matched: "a" }))))).status).toBe("ok");
  });
});

describe("resolveAnalyzerScript", () => {
  it("// @covers FR-01.75 picks the newest installed shipwright-adopt version", () => {
    for (const v of ["0.2.1", "0.10.0", "0.9.5"]) {
      const d = join(home, ".claude", "plugins", "cache", "shipwright", "shipwright-adopt", v, "scripts", "tools");
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "analyze_codebase.py"), "#");
    }
    expect(resolveAnalyzerScript({ homeDir: home })).toContain(join("0.10.0", "scripts"));
    expect(existsSync(resolveAnalyzerScript({ homeDir: home }) ?? "")).toBe(true);
  });
  it("// @covers FR-01.75 is null when nothing is installed", () => {
    expect(resolveAnalyzerScript({ homeDir: home })).toBeNull();
  });
});

describe("findings ride along the profile", () => {
  it("// @covers FR-01.75 are additive: the profile block is unchanged and the response is never cached", async () => {
    const body = { ...snap({ matched: "vite-hono", confidence: 0.9, source: "bundled", warnings: [] }), ci_pipeline: { provider: "github-actions", workflows: ["a.yml"] } };
    const route = createAdoptScanRoutes(deps(spawnWriting(body)));
    const r = await route.request("/api/adopt/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: repo }) });
    expect(r.headers.get("cache-control")).toBe("no-store");
    const json = (await r.json()) as { status: string; profile: unknown; findings: unknown };
    expect(json.profile).toEqual({ matched: "vite-hono", confidence: 0.9, source: "bundled", warnings: [] });
    expect(json.findings).toEqual({ ci: "github-actions · 1 workflow" });
  });
});

describe("POST /api/adopt/scan", () => {
  const app = () => createAdoptScanRoutes(deps(spawnWriting(snap({ matched: "vite-hono", warnings: [] }))));
  it("// @covers FR-01.75 requires a JSON content-type (a cross-site form post cannot start a scan)", async () => {
    const r = await app().request("/api/adopt/scan", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ path: repo }) });
    expect(r.status).toBe(415);
  });
  it("// @covers FR-01.75 rejects a non-object body and answers a scan as data", async () => {
    const h = { "content-type": "application/json" };
    expect((await app().request("/api/adopt/scan", { method: "POST", headers: h, body: "[1]" })).status).toBe(400);
    const ok = await app().request("/api/adopt/scan", { method: "POST", headers: h, body: JSON.stringify({ path: repo }) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("ok");
  });
});
