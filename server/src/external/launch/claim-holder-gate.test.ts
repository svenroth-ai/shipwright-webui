import { describe, it, expect } from "vitest";

import { checkClaimHolderGate, CLAIM_LAUNCH_WINDOW_MS, CLAIM_CLOCK_SKEW_TOLERANCE_MS } from "./claim-holder-gate.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "T",
    sessionUuid: "uuid-T",
    cwd: "/tmp",
    pluginDirs: [],
    state: "awaiting_external_start",
    title: "t",
    projectId: "p",
    createdAt: "2026-09-03T00:00:00.000Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

describe("checkClaimHolderGate", () => {
  it("allows launch when there is no claim on record", () => {
    const result = checkClaimHolderGate(makeTask(), undefined);
    expect(result.allowed).toBe(true);
  });

  it("allows launch when claimedBy/claimedAt exist without claimToken (stale metadata, HIGH-2 semantics)", () => {
    const result = checkClaimHolderGate(
      makeTask({ claimedBy: "lead-7", claimedAt: new Date().toISOString() }),
      undefined,
    );
    expect(result.allowed).toBe(true);
  });

  it("allows the holder — matching token, within the launch window", () => {
    const task = makeTask({
      claimToken: "tok-1",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    const result = checkClaimHolderGate(task, "tok-1");
    expect(result.allowed).toBe(true);
  });

  it("refuses a foreign token, no claimExpired flag", () => {
    const task = makeTask({
      claimToken: "tok-1",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    const result = checkClaimHolderGate(task, "tok-someone-else");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.error.error).toBe("task_claimed");
      expect(result.error.claimExpired).toBeUndefined();
    }
  });

  it("refuses an absent token, no claimExpired flag", () => {
    const task = makeTask({
      claimToken: "tok-1",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    const result = checkClaimHolderGate(task, undefined);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.error.claimExpired).toBeUndefined();
  });

  it("refuses the right token past the launch window, with claimExpired: true", () => {
    const staleClaimedAt = new Date(Date.now() - (CLAIM_LAUNCH_WINDOW_MS + 1)).toISOString();
    const task = makeTask({ claimToken: "tok-1", claimedBy: "lead-7", claimedAt: staleClaimedAt });
    const result = checkClaimHolderGate(task, "tok-1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.error.error).toBe("task_claimed");
      expect(result.error.claimExpired).toBe(true);
    }
  });

  it("allows the right token just inside the launch window boundary", () => {
    const claimedAt = new Date(Date.now() - (CLAIM_LAUNCH_WINDOW_MS - 5_000)).toISOString();
    const task = makeTask({ claimToken: "tok-1", claimedBy: "lead-7", claimedAt });
    const result = checkClaimHolderGate(task, "tok-1");
    expect(result.allowed).toBe(true);
  });

  it("[doubt-review finding] refuses a matching token when claimedAt is future-dated beyond the clock-skew tolerance", () => {
    const futureClaimedAt = new Date(Date.now() + CLAIM_CLOCK_SKEW_TOLERANCE_MS + 60_000).toISOString();
    const task = makeTask({ claimToken: "tok-1", claimedBy: "lead-7", claimedAt: futureClaimedAt });
    const result = checkClaimHolderGate(task, "tok-1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.error.error).toBe("task_claimed");
      expect(result.error.claimExpired).toBe(true);
    }
  });

  it("allows a matching token when claimedAt is future-dated but within the clock-skew tolerance", () => {
    const nearFutureClaimedAt = new Date(Date.now() + CLAIM_CLOCK_SKEW_TOLERANCE_MS - 5_000).toISOString();
    const task = makeTask({ claimToken: "tok-1", claimedBy: "lead-7", claimedAt: nearFutureClaimedAt });
    const result = checkClaimHolderGate(task, "tok-1");
    expect(result.allowed).toBe(true);
  });

  it("refuses a matching token when claimedAt is missing or unparseable (fail-closed, treated as expired)", () => {
    const missing = checkClaimHolderGate(
      makeTask({ claimToken: "tok-1", claimedBy: "lead-7" }),
      "tok-1",
    );
    expect(missing.allowed).toBe(false);

    const malformed = checkClaimHolderGate(
      makeTask({ claimToken: "tok-1", claimedBy: "lead-7", claimedAt: "not-a-date" }),
      "tok-1",
    );
    expect(malformed.allowed).toBe(false);
  });
});
