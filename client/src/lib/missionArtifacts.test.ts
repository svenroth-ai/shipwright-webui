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
  isArtifactVisible,
  isSupportedSchema,
  servesChipValue,
  testsChipValue,
  usesContextRail,
  visibleArtifacts,
  reviewStatusWord,
  testFrLabel,
  layerWord,
  testChangeWord,
} from "./missionArtifacts";
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
