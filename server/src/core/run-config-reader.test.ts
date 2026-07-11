import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clearRunConfigReaderCache,
  readRunConfig,
  type ReadRunConfigDeps,
} from "./run-config-reader.js";
import { deriveReadyToLaunchTasks } from "../types/run-config-v2.js";

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "test",
  "fixtures",
  "run-config-v2-sample.json",
);
const FIXTURE_RAW = readFileSync(FIXTURE_PATH, "utf-8");

const PROJECT_ROOT = "/proj";
const RUN_CONFIG_PATH = join(PROJECT_ROOT, "shipwright_run_config.json");

function depsWith(args: {
  contents?: string;
  /** A retryable error to throw on read. */
  failingRead?: NodeJS.ErrnoException | SyntaxError;
  failingStat?: NodeJS.ErrnoException;
  now?: () => number;
}): { deps: ReadRunConfigDeps; readCount: () => number } {
  let reads = 0;
  let failingReadShots = args.failingRead ? 1 : 0;
  return {
    readCount: () => reads,
    deps: {
      readFile: async () => {
        reads++;
        if (failingReadShots > 0 && args.failingRead) {
          failingReadShots--;
          throw args.failingRead;
        }
        if (args.contents === undefined) {
          throw Object.assign(new Error(`ENOENT`), { code: "ENOENT" });
        }
        return args.contents;
      },
      stat: async () => {
        if (args.failingStat) throw args.failingStat;
        if (args.contents === undefined) return null;
        return { mtimeMs: 1000 };
      },
      sleep: async () => undefined,
      now: args.now ?? (() => 1_000_000),
    },
  };
}

describe("readRunConfig — file presence", () => {
  beforeEach(() => clearRunConfigReaderCache());

  it("returns missing when file is absent", async () => {
    const { deps } = depsWith({});
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("missing");
  });

  it("returns invalid when stat throws an unexpected error", async () => {
    const { deps } = depsWith({
      failingStat: Object.assign(new Error("disk gone"), { code: "EIO" }),
    });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("invalid");
  });
});

describe("readRunConfig — schema-version routing", () => {
  beforeEach(() => clearRunConfigReaderCache());

  it("returns v1_legacy when schemaVersion is missing", async () => {
    const { deps } = depsWith({ contents: JSON.stringify({ runId: "anything" }) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("v1_legacy");
  });

  it("returns v1_legacy when schemaVersion === 1", async () => {
    const { deps } = depsWith({ contents: JSON.stringify({ schemaVersion: 1 }) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("v1_legacy");
  });

  it("returns invalid when schemaVersion is not 1 or 2", async () => {
    const { deps } = depsWith({ contents: JSON.stringify({ schemaVersion: 3 }) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("invalid");
  });

  it('treats schemaVersion "2" (string) as not 2 — guard against quoted version', async () => {
    const { deps } = depsWith({ contents: JSON.stringify({ schemaVersion: "2" }) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("invalid");
  });
});

describe("readRunConfig — fixture parity (drift safety net)", () => {
  beforeEach(() => clearRunConfigReaderCache());

  it("parses the bundled fixture cleanly with no dropped rows", async () => {
    const { deps } = depsWith({ contents: FIXTURE_RAW });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.diagnostics.droppedPhaseTaskIds).toEqual([]);
    expect(r.config.runId).toBe("run-a1b2c3d4");
    expect(r.config.phase_tasks.length).toBe(5);
    expect(r.config.runConditions.splitMode).toBe("per_split");
    expect(r.config.splits_frozen).toEqual(["01-core", "02-ui-shell"]);
  });

  it("derives readyToLaunchTasks for the fixture (parallel branches)", async () => {
    const { deps } = depsWith({ contents: FIXTURE_RAW });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const ready = deriveReadyToLaunchTasks(r.config);
    // Fixture has plan/02-ui-shell awaiting (prereq ptk-aaaa done) and
    // build/01-core awaiting (prereq ptk-bbbb done) — both parallel.
    expect(ready.map((t) => t.phaseTaskId).sort()).toEqual(["ptk-cccc", "ptk-dddd"]);
  });
});

describe("readRunConfig — per-row fault isolation", () => {
  beforeEach(() => clearRunConfigReaderCache());

  it("drops malformed phase_task rows but keeps good ones, surfaced via diagnostics", async () => {
    const cfg = JSON.parse(FIXTURE_RAW);
    // Insert a malformed row: missing sessionUuid.
    cfg.phase_tasks.push({
      phaseTaskId: "ptk-bad1",
      phase: "test",
      splitId: null,
      version: 1,
      status: "awaiting_launch",
      title: "bad row",
      slashCommand: "/shipwright-test",
      prerequisites: [],
      executionCount: 0,
      createdAt: "now",
      // sessionUuid intentionally missing
    });
    // Insert a row whose phaseTaskId is malformed too — falls back to index_ key.
    cfg.phase_tasks.push({
      phaseTaskId: "not-a-ptk",
      phase: "deploy",
      splitId: null,
      sessionUuid: "55555555-6666-4777-8888-999999999999",
      version: 1,
      status: "backlog",
      title: "another bad",
      slashCommand: "/shipwright-deploy",
      prerequisites: [],
      executionCount: 0,
      createdAt: "now",
    });
    const { deps } = depsWith({ contents: JSON.stringify(cfg) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config.phase_tasks.length).toBe(5);
    expect(r.diagnostics.droppedPhaseTaskIds).toEqual([
      "ptk-bad1",
      "not-a-ptk",
    ]);
  });

  it("rejects a row whose splitId is set on a non-plan/build phase", async () => {
    const cfg = JSON.parse(FIXTURE_RAW);
    cfg.phase_tasks.push({
      phaseTaskId: "ptk-eeee",
      phase: "test",
      splitId: "should-be-null",
      sessionUuid: "55555555-6666-4777-8888-999999999999",
      version: 1,
      status: "backlog",
      title: "wrong split",
      slashCommand: "/shipwright-test",
      prerequisites: [],
      executionCount: 0,
      createdAt: "now",
    });
    const { deps } = depsWith({ contents: JSON.stringify(cfg) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.diagnostics.droppedPhaseTaskIds).toContain("ptk-eeee");
  });

  it("returns invalid when the top-level shape is wrong", async () => {
    const { deps } = depsWith({ contents: JSON.stringify([1, 2, 3]) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("invalid");
  });

  it("returns invalid when runId regex fails", async () => {
    const cfg = JSON.parse(FIXTURE_RAW);
    cfg.runId = "not-a-run-id";
    const { deps } = depsWith({ contents: JSON.stringify(cfg) });
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("invalid");
  });
});

describe("readRunConfig — torn-read retry + last-good cache", () => {
  beforeEach(() => clearRunConfigReaderCache());

  it("retries on EBUSY and succeeds on a later attempt", async () => {
    const ebusy = Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    let calls = 0;
    const deps: ReadRunConfigDeps = {
      readFile: async () => {
        calls++;
        if (calls <= 2) throw ebusy;
        return FIXTURE_RAW;
      },
      stat: async () => ({ mtimeMs: 1 }),
      sleep: async () => undefined,
      now: () => 1_000_000,
    };
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("ok");
    expect(calls).toBe(3); // failed twice, succeeded third
  });

  it("falls back to last-good cache after retries exhaust", async () => {
    const ebusy = Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    let mode: "ok" | "fail" = "ok";
    const deps: ReadRunConfigDeps = {
      readFile: async () => {
        if (mode === "fail") throw ebusy;
        return FIXTURE_RAW;
      },
      stat: async () => ({ mtimeMs: 1 }),
      sleep: async () => undefined,
      now: () => 1_000_000,
    };
    const ok = await readRunConfig(PROJECT_ROOT, deps);
    expect(ok.status).toBe("ok");
    mode = "fail";
    const stale = await readRunConfig(PROJECT_ROOT, deps);
    expect(stale.status).toBe("ok");
    if (stale.status === "ok") {
      expect(stale.diagnostics.warnings.some((w) => w.includes("last-good"))).toBe(true);
    }
  });

  it("expires the last-good cache after TTL", async () => {
    const ebusy = Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    let mode: "ok" | "fail" = "ok";
    let clock = 1_000_000;
    const deps: ReadRunConfigDeps = {
      readFile: async () => {
        if (mode === "fail") throw ebusy;
        return FIXTURE_RAW;
      },
      stat: async () => ({ mtimeMs: 1 }),
      sleep: async () => undefined,
      now: () => clock,
    };
    const ok = await readRunConfig(PROJECT_ROOT, deps);
    expect(ok.status).toBe("ok");
    mode = "fail";
    clock += 31_000; // > 30s TTL (raised above the poll cadence for F15)
    const expired = await readRunConfig(PROJECT_ROOT, deps);
    expect(expired.status).toBe("invalid");
  });

  it("recovers a torn JSON parse on a re-read", async () => {
    let calls = 0;
    const deps: ReadRunConfigDeps = {
      readFile: async () => {
        calls++;
        if (calls === 1) return FIXTURE_RAW.slice(0, 50); // torn
        return FIXTURE_RAW;
      },
      stat: async () => ({ mtimeMs: 1 }),
      sleep: async () => undefined,
      now: () => 1_000_000,
    };
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("ok");
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
