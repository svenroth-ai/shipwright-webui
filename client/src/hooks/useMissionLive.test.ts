import { describe, it, expect } from "vitest";

import { deriveMissionLive } from "./useMissionLive";
import type { TranscriptSummary } from "../lib/narrator-transcript";
import type { RunDataJoin } from "../lib/runDataApi";

const EMPTY_TRANSCRIPT: TranscriptSummary = {
  topic: null,
  summary: null,
  activity: [],
  stage: null,
  hasActivity: false,
};

const LIVE_TRANSCRIPT: TranscriptSummary = {
  topic: "Add a login page",
  summary: "Editing login.tsx",
  activity: [
    { id: "a0", text: "You said: Add a login page" },
    { id: "a1", text: "Editing login.tsx" },
  ],
  stage: "Build",
  hasActivity: true,
};

const COMPLETED_RUN = {
  runId: "iterate-2026-07-17-x",
  summary: "Add MFA support",
  intent: "harden auth",
  commit: "abc1234",
  specImpact: "add",
  affectedFrs: ["FR-01.66"],
  tests: { passed: 12, total: 12 },
  gates: { derived: true, review: "pass" },
} as unknown as RunDataJoin;

describe("deriveMissionLive — mode selection", () => {
  it("state active → LIVE mode, narrates the JSONL, stage from the transcript", () => {
    const m = deriveMissionLive({
      missionState: "live",
      run: null,
      transcript: LIVE_TRANSCRIPT,
      taskTitle: "Login task",
    });
    expect(m.mode).toBe("live");
    expect(m.narration.summary).toBe("Editing login.tsx");
    expect(m.narration.activity.length).toBe(2);
    expect(m.stage).toBe("Build");
    expect(m.stageComplete).toBe(false);
    // Business summary prefers the title, else the transcript topic.
    expect(m.businessSummary).toBe("Login task");
  });

  it("a formal run join → COMPLETED mode, done Finalize stage, run summary", () => {
    const m = deriveMissionLive({
      missionState: "done",
      run: COMPLETED_RUN,
      transcript: LIVE_TRANSCRIPT,
      taskTitle: "Login task",
    });
    expect(m.mode).toBe("completed");
    expect(m.stage).toBe("Finalize");
    expect(m.stageComplete).toBe(true);
    expect(m.businessSummary).toBe("Add MFA support");
    // The audit trail is preserved AS artifact link nodes (AC2).
    expect(m.nodes.map((n) => n.key)).toEqual(["req", "spec", "tests", "review", "commit"]);
  });

  it("no run row but a transcript (idle ad-hoc session) → ADHOC mode, narrates", () => {
    const m = deriveMissionLive({
      missionState: "done",
      run: null,
      transcript: LIVE_TRANSCRIPT,
      taskTitle: null,
    });
    expect(m.mode).toBe("adhoc");
    expect(m.narration.summary).toBe("Editing login.tsx");
    // No title → fall back to the transcript topic (honest, from the JSONL).
    expect(m.businessSummary).toBe("Add a login page");
    expect(m.stage).toBe("Build");
  });

  it("no run AND no transcript → EMPTY mode, honest waiting (AC3)", () => {
    const m = deriveMissionLive({
      missionState: "done",
      run: null,
      transcript: EMPTY_TRANSCRIPT,
      taskTitle: null,
    });
    expect(m.mode).toBe("empty");
    expect(m.narration.summary).toBeNull();
    expect(m.narration.activity).toEqual([]);
    expect(m.businessSummary).toBeNull();
    // Stage is never guessed when nothing is derivable.
    expect(m.stage).toBeNull();
    expect(m.stageComplete).toBe(false);
  });

  it("empty session with a title → the title is the honest business summary", () => {
    const m = deriveMissionLive({
      missionState: "done",
      run: null,
      transcript: EMPTY_TRANSCRIPT,
      taskTitle: "Survey the hull",
    });
    expect(m.businessSummary).toBe("Survey the hull");
    expect(m.stage).toBeNull();
  });

  it("live wins over a stale completed run (still narrates, not verdict)", () => {
    const m = deriveMissionLive({
      missionState: "live",
      run: COMPLETED_RUN,
      transcript: LIVE_TRANSCRIPT,
      taskTitle: "Login task",
    });
    expect(m.mode).toBe("live");
    expect(m.stage).toBe("Build");
  });
});
