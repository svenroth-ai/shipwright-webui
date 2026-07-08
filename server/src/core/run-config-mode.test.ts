/*
 * run-config-mode.test.ts — W1 (iterate-2026-07-09-w1-mode-aware-config).
 *
 * Covers the `run_config.mode` field added for the pipeline-as-campaign
 * convergence (Spec/pipeline-as-campaign-convergence.md). Split out of
 * run-config-reader.test.ts to keep both files under the 300-line guideline
 * and to isolate the W1 mode concern.
 *
 * Contract is the authoritative monorepo schema
 * shared/schemas/run_config.v2.schema.json:
 *   - `mode` enum ["multi_session","single_session"], OPTIONAL (not required)
 *   - absent-read fallback = "multi_session" (must match config_io.run_mode)
 *   - an unrecognised value is ALSO read as "multi_session" so a typo can't
 *     select an unbuilt path — and here it never blanks the board either.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clearRunConfigReaderCache,
  readRunConfig,
  type ReadRunConfigDeps,
} from "./run-config-reader.js";
import {
  DEFAULT_RUN_MODE,
  isRunMode,
  parseRunMode,
  resolveRunMode,
  RUN_MODES,
} from "../types/run-config-v2.js";

const FIXTURE_RAW = readFileSync(
  join(__dirname, "..", "test", "fixtures", "run-config-v2-sample.json"),
  "utf-8",
);
const PROJECT_ROOT = "/proj";

/** Minimal deps: serve `contents` for both stat + read, no backoff wait. */
function depsFor(contents: string): ReadRunConfigDeps {
  return {
    readFile: async () => contents,
    stat: async () => ({ mtimeMs: 1000 }),
    sleep: async () => undefined,
    now: () => 1_000_000,
  };
}

/** Clone the bundled fixture and overlay a `mode` value. */
function fixtureWithMode(mode: unknown): string {
  const cfg = JSON.parse(FIXTURE_RAW);
  cfg.mode = mode;
  return JSON.stringify(cfg);
}

describe("readRunConfig — mode field (W1)", () => {
  beforeEach(() => clearRunConfigReaderCache());

  it("surfaces a valid mode='single_session' (no warning)", async () => {
    const r = await readRunConfig(PROJECT_ROOT, depsFor(fixtureWithMode("single_session")));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config.mode).toBe("single_session");
    expect(r.diagnostics.warnings).toEqual([]);
  });

  it("surfaces a valid mode='multi_session'", async () => {
    const r = await readRunConfig(PROJECT_ROOT, depsFor(fixtureWithMode("multi_session")));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config.mode).toBe("multi_session");
  });

  it("omits mode when absent (legacy run) — resolveRunMode defaults to multi_session", async () => {
    // The bundled fixture intentionally carries NO mode field (legacy run).
    const r = await readRunConfig(PROJECT_ROOT, depsFor(FIXTURE_RAW));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config.mode).toBeUndefined();
    expect(resolveRunMode(r.config)).toBe("multi_session");
  });

  it("drops an unrecognised mode + warns; config still ok (a typo can't select an unbuilt path)", async () => {
    const r = await readRunConfig(PROJECT_ROOT, depsFor(fixtureWithMode("turbo_session")));
    // Never rejects the whole config over one bad optional field — the board
    // must not blank over an orchestrator typo.
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config.mode).toBeUndefined();
    expect(r.diagnostics.warnings.some((w) => w.includes("mode"))).toBe(true);
    expect(resolveRunMode(r.config)).toBe("multi_session");
  });

  it("treats mode=null like absent (no warning)", async () => {
    const r = await readRunConfig(PROJECT_ROOT, depsFor(fixtureWithMode(null)));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config.mode).toBeUndefined();
    expect(r.diagnostics.warnings).toEqual([]);
  });
});

describe("run-config-v2 mode helpers (W1)", () => {
  it("DEFAULT_RUN_MODE is multi_session (schema default + framework absent-read parity)", () => {
    expect(DEFAULT_RUN_MODE).toBe("multi_session");
  });

  it("RUN_MODES lists exactly the two modes", () => {
    expect([...RUN_MODES]).toEqual(["multi_session", "single_session"]);
  });

  it("isRunMode accepts the two valid modes, rejects everything else", () => {
    expect(isRunMode("multi_session")).toBe(true);
    expect(isRunMode("single_session")).toBe(true);
    expect(isRunMode("turbo")).toBe(false);
    expect(isRunMode(undefined)).toBe(false);
    expect(isRunMode(null)).toBe(false);
    expect(isRunMode(1)).toBe(false);
  });

  it("resolveRunMode: present valid → itself; absent → default", () => {
    expect(resolveRunMode({ mode: "single_session" })).toBe("single_session");
    expect(resolveRunMode({ mode: "multi_session" })).toBe("multi_session");
    expect(resolveRunMode({})).toBe("multi_session");
    expect(resolveRunMode({ mode: undefined })).toBe("multi_session");
  });

  it("parseRunMode: valid → mode + no warning; absent/null → no mode + no warning; unknown → warning + no mode", () => {
    expect(parseRunMode("single_session")).toEqual({ mode: "single_session", warnings: [] });
    expect(parseRunMode("multi_session")).toEqual({ mode: "multi_session", warnings: [] });
    expect(parseRunMode(undefined)).toEqual({ warnings: [] });
    expect(parseRunMode(null)).toEqual({ warnings: [] });
    const bad = parseRunMode("turbo");
    expect(bad.mode).toBeUndefined();
    expect(bad.warnings[0]).toContain("mode");
  });
});
