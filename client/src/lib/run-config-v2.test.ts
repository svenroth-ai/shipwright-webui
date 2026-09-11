import { describe, it, expect } from "vitest";

import {
  DEFAULT_RUN_MODE,
  isRunMode,
  resolveRunMode,
  RUN_MODES,
} from "./run-config-v2";

/*
 * W1 (iterate-2026-07-09) — client mirror of the run_config.mode helpers.
 * The two mirrors never import each other by design (CLAUDE.md/conventions),
 * so the client copy carries its own coverage. Contract:
 * shared/schemas/run_config.v2.schema.json — `mode` is an enum of exactly
 * ONE valid literal, `single_session`; there is deliberately NO schema
 * default (absence is meaningful: "not a drivable run"). `multi_session`
 * stays a valid literal ONLY for reading a pre-SS1 config still carrying
 * it on disk — it is never written and never the absent-read result.
 *
 * FR-01.01 triage trg-0f040744 finding 2 (2026-09-11 fix) — the absent-read
 * fallback used to be the dead `multi_session` literal, with a comment
 * falsely claiming schema-default parity (the schema has none, on purpose).
 * It is now the framework's own sentinel for this exact situation:
 * `gate_policy.INERT_MODE = "standalone"` (shared/scripts/lib/gate_policy.py,
 * introduced in the same commit that removed multi_session's engine).
 */
describe("run-config-v2 mode helpers (client mirror, W1)", () => {
  it("DEFAULT_RUN_MODE is standalone (the framework's INERT_MODE sentinel, not a schema default)", () => {
    expect(DEFAULT_RUN_MODE).toBe("standalone");
  });

  it("RUN_MODES lists exactly the two ON-DISK-VALID modes (standalone is never written)", () => {
    expect([...RUN_MODES]).toEqual(["multi_session", "single_session"]);
  });

  it("isRunMode accepts the two on-disk-valid modes, rejects standalone and everything else", () => {
    expect(isRunMode("multi_session")).toBe(true);
    expect(isRunMode("single_session")).toBe(true);
    expect(isRunMode("standalone")).toBe(false);
    expect(isRunMode("turbo")).toBe(false);
    expect(isRunMode(undefined)).toBe(false);
    expect(isRunMode(null)).toBe(false);
    expect(isRunMode(1)).toBe(false);
  });

  it("resolveRunMode: present valid → itself; absent/unrecognised → standalone", () => {
    expect(resolveRunMode({ mode: "single_session" })).toBe("single_session");
    expect(resolveRunMode({ mode: "multi_session" })).toBe("multi_session");
    expect(resolveRunMode({})).toBe("standalone");
    expect(resolveRunMode({ mode: undefined })).toBe("standalone");
  });
});
