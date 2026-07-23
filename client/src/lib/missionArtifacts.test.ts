/*
 * missionArtifacts.test.ts — the 5-state hide/show rules (CONTRACT §6).
 *
 * The asymmetry is the contract: an ABSENT artifact hides, an UNRESOLVABLE one
 * stays visible as "currently unavailable". Collapsing the two would let a
 * data-integrity fault read as "nothing happened yet".
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import {
  ARTIFACT_ORDER,
  artifactStateWord,
  frRowLabel,
  isArtifactClickable,
  isArtifactPending,
  isArtifactVisible,
  isSupportedSchema,
  servesChipValue,
  testsChipValue,
  testsResultText,
  usesContextRail,
  visibleArtifacts,
  testFrLabel,
  layerWord,
  testChangeWord,
  stageScenario,
} from "./missionArtifacts";
import { reviewStatusWord } from "./missionWording";
import type { ArtifactDescriptor, ArtifactState, MissionContext } from "./missionContextApi";

function spec(state: ArtifactState): ArtifactDescriptor {
  return {
    kind: "spec",
    label: "Spec",
    state,
    summary: state === "available" ? "The plan." : null,
    receipt: state === "available" ? "mini-plan.md" : null,
    detail: state === "available" ? { type: "document", documentId: "id", title: "mini-plan.md" } : null,
  };
}

function ctx(over: Partial<MissionContext> = {}): MissionContext {
  return {
    schemaVersion: 1,
    scenario: "iterate",
    missionTabVisible: true,
    runId: "iterate-2026-07-18-demo",
    runLive: false,
    artifacts: [spec("available")],
    tests: null,
    servesFrId: null,
    sourceRev: "abc",
    ...over,
  };
}

describe("hide-empty (the 5-state rule)", () => {
  it("HIDES the two absent states", () => {
    expect(isArtifactVisible(spec("not_applicable"))).toBe(false);
    expect(isArtifactVisible(spec("not_yet_created"))).toBe(false);
  });

  it("SHOWS available, unavailable and error", () => {
    expect(isArtifactVisible(spec("available"))).toBe(true);
    // The load-bearing case: a data-integrity problem must not look like absence.
    expect(isArtifactVisible(spec("unavailable"))).toBe(true);
    expect(isArtifactVisible(spec("error"))).toBe(true);
  });

  it("makes only `available` clickable — an unavailable node is inert", () => {
    expect(isArtifactClickable(spec("available"))).toBe(true);
    expect(isArtifactClickable(spec("unavailable"))).toBe(false);
    expect(isArtifactClickable(spec("error"))).toBe(false);
  });
});

/*
 * While the run is IN FLIGHT, `not_yet_created` means "not written YET". Hiding
 * it emptied the whole rail for the entire early phase of every run — measured
 * on a live iterate whose six artifacts were all `not_yet_created`.
 */
describe("hide-empty while the run is live", () => {
  it("SHOWS a not-yet-written artifact only when the run is live", () => {
    expect(isArtifactVisible(spec("not_yet_created"), true)).toBe(true);
    expect(isArtifactVisible(spec("not_yet_created"), false)).toBe(false);
  });

  it("keeps `not_applicable` hidden even while live — it will never exist", () => {
    expect(isArtifactVisible(spec("not_applicable"), true)).toBe(false);
  });

  it("never turns a read failure into 'pending' — those stay distinguishable", () => {
    expect(isArtifactPending(spec("unavailable"), true)).toBe(false);
    expect(isArtifactPending(spec("error"), true)).toBe(false);
    expect(isArtifactPending(spec("available"), true)).toBe(false);
    expect(isArtifactPending(spec("not_yet_created"), true)).toBe(true);
    expect(isArtifactPending(spec("not_yet_created"), false)).toBe(false);
  });

  it("renders the pending rail for a live run instead of nothing at all", () => {
    const kinds = ["spec", "requirement", "tests", "review", "decisions", "commit"];
    const artifacts = kinds.map(
      (kind) => ({ ...spec("not_yet_created"), kind }) as ArtifactDescriptor,
    );
    expect(visibleArtifacts(ctx({ artifacts, runLive: true })).map((a) => a.kind)).toEqual(kinds);
    // …and a FINISHED run keeps hide-empty exactly as before.
    expect(visibleArtifacts(ctx({ artifacts, runLive: false }))).toEqual([]);
  });

  it("treats a missing `runLive` (older server) as not live", () => {
    const artifacts = [{ ...spec("not_yet_created") } as ArtifactDescriptor];
    const legacy = ctx({ artifacts });
    delete (legacy as Partial<MissionContext>).runLive;
    expect(visibleArtifacts(legacy)).toEqual([]);
  });
});

describe("visibleArtifacts", () => {
  it("returns the canonical order regardless of server order", () => {
    // Fed in REVERSE of §6 order, so a pass-through implementation fails.
    const reversed = [...ARTIFACT_ORDER].reverse();
    const c = ctx({
      artifacts: reversed.map(
        (kind) => ({ ...spec("available"), kind, detail: null }) as ArtifactDescriptor,
      ),
    });
    expect(visibleArtifacts(c).map((a) => a.kind)).toEqual(ARTIFACT_ORDER);
  });

  it("carries all six §6 artifacts, in the decided order", () => {
    // S3 added four kinds for the pipeline and campaign scenarios. The kind sets
    // are DISJOINT — no rail ever mixes them — so what has to hold is that the
    // six iterate artifacts keep their §6 relative order untouched.
    const iterateSix = ["spec", "requirement", "tests", "review", "decisions", "commit"];
    expect(ARTIFACT_ORDER.filter((k) => iterateSix.includes(k))).toEqual(iterateSix);
  });

  it("orders the campaign rail campaign-level first, then the active unit", () => {
    const campaignKinds = ["spec", "campaign_runbook", "campaign_progress", "sub_iterate"];
    expect(ARTIFACT_ORDER.filter((k) => campaignKinds.includes(k))).toEqual(campaignKinds);
  });

  it("leads the pipeline rail with the phase itself", () => {
    expect(ARTIFACT_ORDER.indexOf("phase")).toBeLessThan(ARTIFACT_ORDER.indexOf("spec"));
  });

  it("filters hidden states out of the rail", () => {
    const c = ctx({
      artifacts: [
        spec("available"),
        { ...spec("not_yet_created"), kind: "commit", label: "Commit" } as ArtifactDescriptor,
      ],
    });
    expect(visibleArtifacts(c).map((a) => a.kind)).toEqual(["spec"]);
  });

  it("returns [] for a null context (no rail, no crash)", () => {
    expect(visibleArtifacts(null)).toEqual([]);
  });

  it("drops an unknown kind from a newer server rather than mis-slotting it", () => {
    // Slice 2 made `decisions` real, so the stand-in for "a kind this client
    // has never heard of" has to be one that is genuinely not in §6.
    const c = ctx({
      artifacts: [{ ...spec("available"), kind: "deployment" } as unknown as ArtifactDescriptor],
    });
    expect(visibleArtifacts(c)).toEqual([]);
  });
});

describe("usesContextRail (scenario gate)", () => {
  it("is true for a resolved iterate with artifacts", () => {
    expect(usesContextRail(ctx())).toBe(true);
  });

  it("S3 — is now TRUE for pipeline and campaign, which resolve natively", () => {
    for (const scenario of ["pipeline", "campaign"] as const) {
      expect(usesContextRail(ctx({ scenario })), scenario).toBe(true);
    }
  });

  it("stays FALSE for plain / pure — those sessions have no artifacts by definition", () => {
    for (const scenario of ["plain", "custom_actions"] as const) {
      expect(usesContextRail(ctx({ scenario })), scenario).toBe(false);
    }
  });

  it("falls back to the legacy rail when a scenario resolved NO artifacts", () => {
    // Version-skew safety: an empty rail must never render as an empty panel.
    for (const scenario of ["iterate", "pipeline", "campaign"] as const) {
      expect(usesContextRail(ctx({ scenario, artifacts: [] })), scenario).toBe(false);
    }
  });
});

describe("schema gate", () => {
  it("accepts v1 and refuses anything else", () => {
    expect(isSupportedSchema(ctx())).toBe(true);
    expect(isSupportedSchema(ctx({ schemaVersion: 2 }))).toBe(false);
    expect(isSupportedSchema(null)).toBe(false);
  });
});

describe("instrument chips (AC8 — honest or dash)", () => {
  it("renders passed/total when both are present", () => {
    expect(testsChipValue(ctx({ tests: { passed: 12, total: 12 } }))).toBe("12/12");
  });

  it("returns null on a PARTIAL record — never invents a denominator", () => {
    expect(testsChipValue(ctx({ tests: { passed: 12, total: null } }))).toBeNull();
    expect(testsChipValue(ctx({ tests: { passed: null, total: 12 } }))).toBeNull();
    expect(testsChipValue(ctx({ tests: null }))).toBeNull();
  });

  it("renders a zero-passed suite honestly rather than as absent", () => {
    expect(testsChipValue(ctx({ tests: { passed: 0, total: 9 } }))).toBe("0/9");
  });

  it("serves the fold-resolved FR id, or null", () => {
    expect(servesChipValue(ctx({ servesFrId: "FR-01.66" }))).toBe("FR-01.66");
    expect(servesChipValue(ctx({ servesFrId: null }))).toBeNull();
  });
});

describe("testsResultText (the counts-led detail headline)", () => {
  it("says 'All N tests passing' on a green suite", () => {
    expect(testsResultText({ passed: 3037, total: 3037 })).toBe("All 3037 tests passing");
  });

  it("says 'N of M tests passing' when some failed — never rounds to green", () => {
    expect(testsResultText({ passed: 3009, total: 3037 })).toBe("3009 of 3037 tests passing");
  });

  it("falls back to a total-only or passed-only phrasing", () => {
    expect(testsResultText({ passed: null, total: 42 })).toBe("42 tests recorded");
    expect(testsResultText({ passed: 7, total: null })).toBe("7 tests passing");
  });

  it("singularises a one-test suite", () => {
    expect(testsResultText({ passed: 1, total: 1 })).toBe("All 1 test passing");
  });

  it("returns null when nothing citable was recorded", () => {
    expect(testsResultText(null)).toBeNull();
    expect(testsResultText({ passed: null, total: null })).toBeNull();
  });

  it("treats a genuine zero-of-zero as no result — never 'All 0 tests passing'", () => {
    expect(testsResultText({ passed: 0, total: 0 })).toBeNull();
  });

  it("still reports a real failing run (0 of N)", () => {
    expect(testsResultText({ passed: 0, total: 9 })).toBe("0 of 9 tests passing");
  });
});

describe("frRowLabel", () => {
  it("shows the fold provenance when the id moved", () => {
    expect(
      frRowLabel({ displayFrId: "FR-01.28", name: "Embedded terminal", mappedFrom: "FR-01.44" }),
    ).toBe("FR-01.28 — Embedded terminal (mapped from FR-01.44)");
  });

  it("omits provenance for a surviving id and tolerates a missing name", () => {
    expect(frRowLabel({ displayFrId: "FR-01.66", name: null, mappedFrom: null })).toBe("FR-01.66");
  });
});

describe("artifactStateWord", () => {
  it("gives a non-visual word for every state (a11y — never colour alone)", () => {
    const states: ArtifactState[] = [
      "available",
      "unavailable",
      "error",
      "not_applicable",
      "not_yet_created",
    ];
    for (const s of states) expect(artifactStateWord(s).length).toBeGreaterThan(0);
  });
});

describe("Slice-2 wording (the honesty rules)", () => {
  it("never lets an unreadable review read as a passed one (§9.1)", () => {
    expect(reviewStatusWord("unavailable")).toBe("no record");
    expect(reviewStatusWord("not_run")).toBe("not run");
    expect(reviewStatusWord("completed")).toBe("ran");
    // The words that would turn a data gap into a false assurance.
    for (const s of ["completed", "not_run", "unavailable"] as const) {
      expect(reviewStatusWord(s)).not.toMatch(/pass|clean|ok|none/i);
    }
  });

  it("renders fold provenance identically to the requirement rows (AC2)", () => {
    expect(testFrLabel({ frId: "FR-01.28", mappedFrom: "FR-01.44" })).toBe(
      "FR-01.28 (mapped from FR-01.44)",
    );
    expect(testFrLabel({ frId: "FR-01.28", mappedFrom: null })).toBe("FR-01.28");
  });

  it("translates layer + change jargon into plain words", () => {
    expect(layerWord("e2e")).toBe("end-to-end");
    expect(layerWord(null)).toBe("unknown layer");
    expect(testChangeWord("modified")).toBe("changed");
    expect(testChangeWord("removed")).toBe("removed");
  });
});

describe("stageScenario — the S4 stage gate's view of the scenario", () => {
  const ctx = (scenario: string) =>
    ({ schemaVersion: 1, scenario, artifacts: [] } as unknown as Parameters<typeof stageScenario>[0]);

  it("passes the four lifecycle-bearing scenarios through unchanged", () => {
    for (const s of ["iterate", "pipeline", "campaign", "plain"] as const) {
      expect(stageScenario(ctx(s))).toBe(s);
    }
  });

  it("maps custom_actions to `plain`, NOT to the unresolved sentinel", () => {
    // Internal code review: routing a POSITIVELY resolved non-iterate through
    // `null` ran the unresolved asymmetry backwards — a card the server said is
    // not an iterate would take the iterate branch, sticky-Analyze included.
    expect(stageScenario(ctx("custom_actions"))).toBe("plain");
  });

  it("an absent context stays unresolved — `null`, which is a different claim", () => {
    expect(stageScenario(null)).toBeNull();
    expect(stageScenario(undefined)).toBeNull();
  });
});
