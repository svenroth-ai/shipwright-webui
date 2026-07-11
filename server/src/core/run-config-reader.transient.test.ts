import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clearRunConfigReaderCache,
  readRunConfig,
  type ReadRunConfigDeps,
} from "./run-config-reader.js";

/*
 * F15 regression suite — a transient run-config read must not vanish the lane.
 *
 * Split out of run-config-reader.test.ts so the primary reader suite stays
 * under the 300-line source guideline (campaign bloat contract: new cohesive
 * *.test.ts rather than growing a footprint test past its ceiling).
 *
 * Two independent defects, both surfacing as a spurious {status:"invalid"}:
 *   1. The existence stat probe had no retry / no last-good fallback for a
 *      non-ENOENT fault (Windows rename-window EPERM/EBUSY/EACCES).
 *   2. LAST_GOOD_TTL_MS (5000) equalled the client poll cadence, so the cache
 *      was already expired at fallback time — one torn poll flapped the lane.
 */

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "test",
  "fixtures",
  "run-config-v2-sample.json",
);
const FIXTURE_RAW = readFileSync(FIXTURE_PATH, "utf-8");

const PROJECT_ROOT = "/proj";

describe("readRunConfig — F15 transient stat + TTL resilience", () => {
  beforeEach(() => clearRunConfigReaderCache());

  it("serves last-good cache when the stat probe throws EPERM", async () => {
    // Windows rename window: the orchestrator's atomic rewrite makes one poll's
    // stat throw EPERM. Pre-fix this returned {status:"invalid"} immediately,
    // escaping the torn-read mitigations and vanishing the lane mid-run.
    const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
    let statMode: "ok" | "fail" = "ok";
    const deps: ReadRunConfigDeps = {
      readFile: async () => FIXTURE_RAW,
      stat: async () => {
        if (statMode === "fail") throw eperm;
        return { mtimeMs: 1 };
      },
      sleep: async () => undefined,
      now: () => 1_000_000,
    };
    const ok = await readRunConfig(PROJECT_ROOT, deps);
    expect(ok.status).toBe("ok");
    statMode = "fail";
    const served = await readRunConfig(PROJECT_ROOT, deps);
    expect(served.status).toBe("ok"); // RED on pre-fix main: was "invalid"
    if (served.status === "ok") {
      expect(
        served.diagnostics.warnings.some((w) => w.includes("last-good")),
      ).toBe(true);
    }
  });

  it("still returns invalid on a non-retryable stat error with no cache", async () => {
    // EIO is not a rename-window flap; with no last-good entry it must surface.
    const deps: ReadRunConfigDeps = {
      readFile: async () => FIXTURE_RAW,
      stat: async () => {
        throw Object.assign(new Error("disk gone"), { code: "EIO" });
      },
      sleep: async () => undefined,
      now: () => 1_000_000,
    };
    const r = await readRunConfig(PROJECT_ROOT, deps);
    expect(r.status).toBe("invalid");
  });

  it("last-good cache survives a full 5s poll gap (TTL > poll cadence)", async () => {
    // Pre-fix LAST_GOOD_TTL_MS (5000) equalled the client poll cadence, so the
    // cache was always expired at fallback time.
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
    clock += 5_000; // exactly one in_progress poll cadence later
    const served = await readRunConfig(PROJECT_ROOT, deps);
    expect(served.status).toBe("ok"); // RED on pre-fix main: TTL==5000 → expired
  });
});
