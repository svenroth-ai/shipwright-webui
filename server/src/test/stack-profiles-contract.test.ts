/**
 * @covers FR-01.75
 * Cross-repo contract pin: `resolve_profile.py list --json` contract_version 1.
 * The fixture is a real resolver output (paths sanitized). If upstream changes
 * the shape it must bump contract_version; this suite then fails loudly
 * instead of the Settings card half-rendering.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { listStackProfiles } from "../core/stack-profiles.js";
import type { CliChildSpawnFn } from "../core/cli-child-spawn.js";
import type { RunFn } from "../core/readiness-probe.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "resolve-profile-list.v1.json"), "utf-8");

const okRun: RunFn = async () => ({ ok: true, stdout: "uv 0.5", stderr: "" }) as never;
const spawnOf = (stdout: string, code = 0, stderr = ""): CliChildSpawnFn => async () => ({ code, stdout, stderr });
const deps = (spawn: CliChildSpawnFn) => ({ run: okRun, spawn, existsFn: () => true, homeDir: "/h" });

describe("stack-profile list contract v1", () => {
  // @covers FR-01.75
  it("pins the entry shape the UI renders", () => {
    const parsed = JSON.parse(fixture);
    expect(parsed.contract_version).toBe(1);
    for (const p of parsed.profiles) {
      expect(Object.keys(p).sort()).toEqual(
        ["description", "error", "kind", "name", "path", "schema_version", "shadows", "source", "valid"],
      );
      expect(["project", "user", "bundled"]).toContain(p.source);
    }
    expect(Object.keys(parsed).sort()).toEqual(["contract_version", "profiles", "searched", "warnings"]);
  });

  // @covers FR-01.75
  it("returns the report for a supported contract and keeps invalid entries", async () => {
    const out = await listStackProfiles({}, deps(spawnOf(fixture)));
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    const bad = out.report.profiles.find((p) => !p.valid);
    expect(bad?.name).toBe("broken");
    expect(bad?.error).toMatch(/not valid JSON/);
    expect(out.report.profiles.find((p) => p.name === "my-stack")?.source).toBe("project");
  });

  // @covers FR-01.75
  it("refuses an unrecognised major instead of half-rendering", async () => {
    const v2 = JSON.stringify({ ...JSON.parse(fixture), contract_version: 2 });
    expect(await listStackProfiles({}, deps(spawnOf(v2)))).toEqual({ status: "unsupported-contract", version: "2" });
  });

  // @covers FR-01.75
  it("is engine-unavailable when the resolver script is missing", async () => {
    const out = await listStackProfiles({}, { ...deps(spawnOf(fixture)), existsFn: () => false });
    expect(out.status).toBe("engine-unavailable");
  });

  // @covers FR-01.75
  it("surfaces the CLI error line when it exits non-zero", async () => {
    const out = await listStackProfiles({}, deps(spawnOf("", 1, "error: boom\n")));
    expect(out).toEqual({ status: "failed", reason: "boom" });
  });
});

describe("validate parsing + create rollback policy", () => {
  // @covers FR-01.75
  it("parses the JSON document even when the human line before it contains a brace", async () => {
    const { validateStackProfile } = await import("../core/stack-profiles.js");
    const out = `profile 'a{b': source=user (/x/{y}.json)\n${JSON.stringify({ valid: true, name: "a", source: "user", path: "/x", schema_version: 1, shadows: [], warnings: [], searched: [] }, null, 2)}`;
    const r = await validateStackProfile({ name: "abc" }, deps(spawnOf(out)));
    expect(r.status === "ok" && r.report.valid).toBe(true);
  });

  // @covers FR-01.75
  it("does not render a validate report of a different contract as valid", async () => {
    const { validateStackProfile } = await import("../core/stack-profiles.js");
    const out = JSON.stringify({ contract_version: 2, valid: true, name: "abc" });
    expect(await validateStackProfile({ name: "abc" }, deps(spawnOf(out)))).toEqual({ status: "unsupported-contract", version: "2" });
  });

  // @covers FR-01.75
  it("rejects malformed list entries instead of trusting them", async () => {
    const bad = JSON.stringify({ contract_version: 1, profiles: [{ name: "x" }], warnings: [], searched: [] });
    expect((await listStackProfiles({}, deps(spawnOf(bad)))).status).toBe("failed");
  });

  // @covers FR-01.75
  it("never lets an option-looking name reach the resolver", async () => {
    const { validateStackProfile } = await import("../core/stack-profiles.js");
    let called = false;
    const spy: CliChildSpawnFn = async () => ((called = true), { code: 0, stdout: "", stderr: "" });
    const r = await validateStackProfile({ name: "--project-root" }, deps(spy));
    expect(called).toBe(false);
    expect(r.status === "ok" && !r.report.valid).toBe(true);
  });
});

describe("validate failure classes", () => {
  // @covers FR-01.75
  it("a crash (no resolver error line) is an outage, not a verdict on the profile", async () => {
    const { validateStackProfile } = await import("../core/stack-profiles.js");
    const r = await validateStackProfile({ name: "abc" }, deps(spawnOf("", 1, "Traceback (most recent call last):\n  boom")));
    expect(r.status).toBe("failed");
  });
  // @covers FR-01.75
  it("the resolver's own not-found line is a verdict", async () => {
    const { validateStackProfile } = await import("../core/stack-profiles.js");
    const r = await validateStackProfile({ name: "abc" }, deps(spawnOf("", 2, "error: Stack profile 'abc' not found.")));
    expect(r).toEqual({ status: "ok", report: { valid: false, name: "abc", error: "Stack profile 'abc' not found." } });
  });
});
