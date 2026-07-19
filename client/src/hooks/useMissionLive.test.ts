import { describe, it, expect } from "vitest";

import { deriveMissionLive, deriveCampaignInfo } from "./useMissionLive";
import type { TranscriptSummary } from "../lib/narrator-transcript";
import type { RunDataJoin } from "../lib/runDataApi";
import type { Campaign } from "../lib/campaignsApi";

const EMPTY_TRANSCRIPT: TranscriptSummary = {
  topic: null,
  summary: null,
  activity: [],
  stage: null,
  stageActivity: null,
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
  stageActivity: null,
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

  it("a formal run join → COMPLETED mode, terminal Merge stage, run summary", () => {
    const m = deriveMissionLive({
      missionState: "done",
      run: COMPLETED_RUN,
      transcript: LIVE_TRANSCRIPT,
      taskTitle: "Login task",
    });
    expect(m.mode).toBe("completed");
    // FR-01.67: a completed (merged) run is the terminal Merge stage, all done.
    expect(m.stage).toBe("Merge");
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

// ── FR-01.67: autonomous-campaign awareness ──
function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    slug: "wow-usability",
    intent: "polish",
    branchStrategy: null,
    expandsTriage: null,
    status: "active",
    steps: [
      { id: "A20", slug: "a20", title: "A20", status: "complete", specPath: null, commit: null, branch: null, planFirst: false },
      { id: "A21", slug: "a21", title: "A21", status: "in_progress", specPath: null, commit: null, branch: null, planFirst: false },
    ],
    done: 21,
    total: 22,
    nextPending: { id: "A22", specPath: null },
    ...over,
  };
}

describe("deriveCampaignInfo (FR-01.67 AC3)", () => {
  it("finds the campaign by slug and reads done/total + the in_progress sub-iterate", () => {
    const info = deriveCampaignInfo("wow-usability", [campaign()]);
    expect(info).toEqual({ slug: "wow-usability", done: 21, total: 22, activeSubIterate: "A21" });
  });

  it("falls back to nextPending when no step is in_progress", () => {
    const steps = campaign().steps.map((s) => ({ ...s, status: "complete" as const }));
    const info = deriveCampaignInfo("wow-usability", [campaign({ steps })]);
    expect(info?.activeSubIterate).toBe("A22");
  });

  it("null slug OR no matching campaign OR no payload → null (honest, dormant)", () => {
    expect(deriveCampaignInfo(null, [campaign()])).toBeNull();
    expect(deriveCampaignInfo("nope", [campaign()])).toBeNull();
    expect(deriveCampaignInfo("wow-usability", null)).toBeNull();
  });
});

describe("deriveMissionLive — campaign session (FR-01.67 AC3)", () => {
  it("threads the campaign into the model + uses the human-readable slug as the summary", () => {
    const m = deriveMissionLive({
      missionState: "live",
      run: null,
      transcript: { ...LIVE_TRANSCRIPT, stage: "Build" },
      taskTitle: "campaign: wow-usability",
      campaign: { slug: "wow-usability", done: 21, total: 22, activeSubIterate: "A21" },
    });
    expect(m.campaign).toEqual({ slug: "wow-usability", done: 21, total: 22, activeSubIterate: "A21" });
    // The raw `campaign: <slug>` title is replaced by the readable slug.
    expect(m.businessSummary).toBe("wow-usability");
    // The stepper stage is the ACTIVE sub-iterate's windowed stage.
    expect(m.stage).toBe("Build");
  });

  it("a non-campaign session → campaign is null (no fabricated progress)", () => {
    const m = deriveMissionLive({
      missionState: "live",
      run: null,
      transcript: LIVE_TRANSCRIPT,
      taskTitle: "Login task",
    });
    expect(m.campaign).toBeNull();
    expect(m.businessSummary).toBe("Login task");
  });
});
