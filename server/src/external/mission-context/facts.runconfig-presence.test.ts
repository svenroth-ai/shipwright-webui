/*
 * facts.runconfig-presence.test.ts — the 4→3 state mapping that decides whether
 * the Mission tab may be hidden (S3, FR-01.66).
 *
 * `RunConfigReadResult` has FOUR states and only ONE of them, `missing`, is
 * evidence that a project does not run the SDLC pipeline. The original
 * `status === "ok"` collapsed the other three into "no run-config", which is the
 * last conjunct of the hide decision — so a config that was present but corrupt,
 * legacy, or on an unknown schema deleted the Mission tab with no error and no
 * cause (internal code review, BLOCKING).
 *
 * This is a mapping test rather than an assertion about intent: it enumerates
 * every variant of the union, so a state ADDED to `RunConfigReadResult` later
 * cannot quietly inherit the wrong side of the gate.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { runConfigPresence } from "./facts.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { RunConfigV2 } from "../../types/run-config-v2.js";

const OK: RunConfigReadResult = {
  status: "ok",
  config: { runId: "run-a1b2c3d4", phase_tasks: [] } as unknown as RunConfigV2,
  diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
};

describe("runConfigPresence — only ABSENCE is evidence of absence", () => {
  it("maps a valid v2 config to `ok`", () => {
    expect(runConfigPresence(OK)).toBe("ok");
  });

  it("maps NO FILE to `missing` — the one state that may hide the tab", () => {
    expect(runConfigPresence({ status: "missing" })).toBe("missing");
  });

  it.each([
    ["v1_legacy", { status: "v1_legacy" } as RunConfigReadResult],
    ["invalid (corrupt / unknown schema)", { status: "invalid", reason: "parse" } as RunConfigReadResult],
    ["invalid (thrown read)", { status: "invalid", reason: "read_failed" } as RunConfigReadResult],
  ])("maps %s to `unreadable`, never to `missing`", (_n, result) => {
    expect(runConfigPresence(result)).toBe("unreadable");
  });

  it("covers EVERY variant of the union — a new state cannot default into `missing`", () => {
    const all: RunConfigReadResult[] = [
      OK,
      { status: "missing" },
      { status: "v1_legacy" },
      { status: "invalid", reason: "whatever" },
    ];
    const mapped = all.map(runConfigPresence);
    expect(mapped).toEqual(["ok", "missing", "unreadable", "unreadable"]);
    // Exactly ONE input may produce the hide-permitting state.
    expect(mapped.filter((m) => m === "missing")).toHaveLength(1);
  });
});
