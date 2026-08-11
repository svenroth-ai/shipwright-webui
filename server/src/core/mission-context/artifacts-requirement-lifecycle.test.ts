import { describe, expect, it } from "vitest";

import { buildRequirementArtifact } from "./artifacts.js";
import { parseFoldMap } from "./fold-map.js";

const map = parseFoldMap(`| FR-01.66 | TSK | Mission view | Should | A readable Mission view. | adopted |`);
const sourceDocument = { documentId: "signed", title: "Requirements specification" };

describe("Requirement artifact lifecycle", () => {
  it("discovers until a usable spec impact exists", () => {
    const artifact = buildRequirementArtifact({ foldMap: map, doc: null, events: { status: "absent", mtimeMs: 0 }, specText: null, sourceDocument });
    expect(artifact.detail?.lifecycle).toBe("discovering");
    expect(artifact.summary).toBe("Discovering affected requirements.");
  });

  it("degrades rather than claiming planned impact when terminal evidence is unreadable", () => {
    const artifact = buildRequirementArtifact({ foldMap: map, doc: null, events: { status: "unavailable", mtimeMs: 0, reason: "malformed" }, specText: "- Spec impact: modify\n\n## Affected requirements\n\nFR-01.66", sourceDocument });
    expect(artifact.state).toBe("unavailable");
    expect(artifact.note).toBe("The run record could not be read.");
  });

  it("does not call a non-live run planned when completion artifacts are delayed", () => {
    const artifact = buildRequirementArtifact({ foldMap: map, doc: null, events: { status: "absent", mtimeMs: 0 }, runLive: false, specText: "- Spec impact: modify\n\n## Affected requirements\n\nFR-01.66", sourceDocument });
    expect(artifact.detail?.lifecycle).toBe("discovering");
    expect(artifact.summary).toBe("Discovering affected requirements.");
  });

  it("lets explicit NONE override contradictory recorded ids", () => {
    const artifact = buildRequirementArtifact({ foldMap: map, doc: null, events: { status: "found", mtimeMs: 1, run: { runId: "iterate-2026-08-11-mis-1", eventId: null, ts: null, source: null, intent: null, changeType: null, description: null, summary: null, commit: null, specImpact: "none", affectedFrs: ["FR-01.66"], newFrs: [], tests: null, phaseTimings: null, campaign: null, subIterateId: null } }, specText: null, sourceDocument });
    expect(artifact.detail?.lifecycle).toBe("none");
    expect(artifact.detail?.rows).toEqual([]);
  });

  it("uses the iterate spec before completion, but lets work_completed win once recorded", () => {
    const planned = buildRequirementArtifact({ foldMap: map, doc: { specImpact: "none", affectedFrs: [], newFrs: [], specHint: null, complexity: null, changeType: null, testsPassed: null, mtimeMs: 0 }, events: { status: "absent", mtimeMs: 0 }, specText: "- Spec impact: modify\n\n## Affected requirements\n\nFR-01.66", sourceDocument });
    expect(planned.detail?.lifecycle).toBe("planned");
    expect(planned.detail?.rows[0]?.displayFrId).toBe("FR-01.66");

    const recorded = buildRequirementArtifact({ foldMap: map, doc: { specImpact: "none", affectedFrs: [], newFrs: [], specHint: null, complexity: null, changeType: null, testsPassed: null, mtimeMs: 0 }, events: { status: "found", mtimeMs: 1, run: { runId: "iterate-2026-08-11-mis-1", eventId: null, ts: null, source: null, intent: null, changeType: null, description: null, summary: null, commit: null, specImpact: "modify", affectedFrs: ["FR-01.66"], newFrs: [], tests: null, phaseTimings: null, campaign: null, subIterateId: null } }, specText: null, sourceDocument });
    expect(recorded.detail?.lifecycle).toBe("recorded");
    expect(recorded.detail?.rows[0]?.description).toBe("A readable Mission view.");
  });

  it("strips adopted-row markup and update history from the readable description", () => {
    const markedUp = parseFoldMap(`| FR-01.66 | TSK | Mission view | Should | Reads clearly.<br>**Updates:** Internal notes. | adopted |`);
    expect(buildRequirementArtifact({ foldMap: markedUp, doc: null, events: { status: "found", mtimeMs: 1, run: { runId: "iterate-2026-08-11-mis-1", eventId: null, ts: null, source: null, intent: null, changeType: null, description: null, summary: null, commit: null, specImpact: "modify", affectedFrs: ["FR-01.66"], newFrs: [], tests: null, phaseTimings: null, campaign: null, subIterateId: null } }, specText: null, sourceDocument }).detail?.rows[0]?.description).toBe("Reads clearly.");
  });
});
