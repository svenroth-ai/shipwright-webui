/*
 * iterate-record.test.ts — the framework-recorded spec-path hint.
 *
 * Added after a PROBE over this repo's 206 real iterate runs found 19 whose
 * spec is a campaign SUB-ITERATE doc that the known-layout candidates miss.
 * The hint closes that gap WITHOUT relaxing §5.1: it is constrained to the
 * iterate tree, strictly grammar-checked, and still path-guarded by the caller.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { specCandidates, specHintCandidate } from "./iterate-record.js";

describe("specCandidates (known layout)", () => {
  it("covers both real layouts: the per-run dir and the flat date-slug file", () => {
    const c = specCandidates("iterate-2026-07-18-demo", "demo").map((p) => p.join("/"));
    expect(c).toContain(".shipwright/planning/iterate/iterate-2026-07-18-demo/mini-plan.md");
    expect(c).toContain(".shipwright/planning/iterate/2026-07-18-demo.md");
  });

  it("builds nothing from a caller-supplied sub-path (only run_id + slug)", () => {
    for (const parts of specCandidates("iterate-x", "y")) {
      expect(parts.every((p) => !p.includes(".."))).toBe(true);
    }
  });
});

describe("specHintCandidate", () => {
  it("ACCEPTS a campaign sub-iterate spec (the 19-run gap the probe found)", () => {
    const parts = specHintCandidate(
      ".shipwright/planning/iterate/campaigns/webui-pipeline-convergence/sub-iterates/W1-mode-aware-config.md",
    );
    expect(parts).toEqual([
      ".shipwright",
      "planning",
      "iterate",
      "campaigns",
      "webui-pipeline-convergence",
      "sub-iterates",
      "W1-mode-aware-config.md",
    ]);
  });

  it("accepts a flat iterate spec and drops a #fragment", () => {
    expect(specHintCandidate(".shipwright/planning/iterate/2026-07-06-x.md#heading")).toEqual([
      ".shipwright",
      "planning",
      "iterate",
      "2026-07-06-x.md",
    ]);
  });

  it("REJECTS the adopted project spec — that is not this run's plan", () => {
    expect(specHintCandidate(".shipwright/planning/01-adopted/spec.md#FR-01.25")).toBeNull();
  });

  it("REJECTS the framework's own sentinels", () => {
    expect(specHintCandidate("none")).toBeNull();
    expect(specHintCandidate("n/a (data-only compliance reconcile)")).toBeNull();
    expect(specHintCandidate("")).toBeNull();
    expect(specHintCandidate(null)).toBeNull();
  });

  it("REJECTS every escape attempt, even though the caller also path-guards", () => {
    for (const bad of [
      ".shipwright/planning/iterate/../../../etc/passwd.md",
      ".shipwright/planning/iterate/..%2f..%2fsecret.md",
      "/etc/passwd.md",
      "C:/Windows/system.md",
      ".shipwright/planning/iterate/a\0b.md",
      ".shipwright/planning/iterate/‮sdrawkcab.md",
      ".shipwright/planning/iterate/x.txt",
      ".shipwright/planning/iterate",
      "../planning/iterate/x.md",
    ]) {
      expect(specHintCandidate(bad), `${JSON.stringify(bad)} must be rejected`).toBeNull();
    }
  });

  it("REJECTS an over-long hint (bounded input)", () => {
    expect(specHintCandidate(".shipwright/planning/iterate/" + "a".repeat(600) + ".md")).toBeNull();
  });
});
