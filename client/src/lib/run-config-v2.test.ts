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
 * shared/schemas/run_config.v2.schema.json (default multi_session; an
 * unrecognised value is also read as multi_session).
 */
describe("run-config-v2 mode helpers (client mirror, W1)", () => {
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
});
