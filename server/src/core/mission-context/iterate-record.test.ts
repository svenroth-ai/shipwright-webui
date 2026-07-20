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

import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  _clearEventIndexCache,
  findWorkCompleted,
  specCandidates,
  specHintCandidate,
} from "./iterate-record.js";

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

/*
 * findWorkCompleted — the mtime-keyed run_id index (CONTRACT §5.2, perf item 3).
 * The Mission tab polls once a second and the log goes quiescent the moment a
 * run finalizes, so re-reading and re-projecting the whole event log every poll
 * was waste. These cases pin that an unchanged log serves the SAME projection
 * object (index reused, not re-scanned), that a changed log rebuilds it, and
 * that `absent` stays distinct from `unavailable`.
 *
 * @covers FR-01.66
 */
describe("findWorkCompleted (indexed run_id lookup)", () => {
  const RUN_A = {
    id: "e1",
    type: "work_completed",
    ts: "2026-07-20T10:00:00Z",
    adr_id: "iterate-A",
    commit: "aaaa111",
    summary: "A",
  };
  const RUN_B = {
    id: "e2",
    type: "work_completed",
    ts: "2026-07-20T11:00:00Z",
    adr_id: "iterate-B",
    commit: "bbbb222",
    summary: "B",
  };

  function project(): string {
    return mkdtempSync(join(tmpdir(), "mc-events-"));
  }
  function logPath(root: string): string {
    return join(root, "shipwright_events.jsonl");
  }

  beforeEach(() => _clearEventIndexCache());

  it("serves the run from the cached index and does NOT re-scan an unchanged log", () => {
    const root = project();
    try {
      writeFileSync(logPath(root), JSON.stringify(RUN_A) + "\n");
      const first = findWorkCompleted(root, "iterate-A");
      const second = findWorkCompleted(root, "iterate-A");
      expect(first.status).toBe("found");
      expect(second.status).toBe("found");
      if (first.status === "found" && second.status === "found") {
        // The SAME projection object across polls ⇒ the index was reused, not
        // the log re-read and re-projected (a rebuild would mint a fresh object).
        expect(second.run).toBe(first.run);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT re-read the log while its (mtime,size) fingerprint is unchanged", () => {
    const root = project();
    const log = logPath(root);
    // A whole-millisecond instant so utimesSync round-trips EXACTLY through
    // fstat on any filesystem (no sub-ms NTFS precision to lose → not flaky).
    const pinned = new Date(1_760_000_000_000);
    try {
      writeFileSync(log, JSON.stringify(RUN_A) + "\n");
      utimesSync(log, pinned, pinned);
      expect(findWorkCompleted(root, "iterate-A").status).toBe("found"); // builds the index

      // Overwrite with a DIFFERENT run of the SAME byte length ("iterate-A" and
      // "iterate-C" are equal length), then re-pin the SAME mtime so the
      // (mtime,size) fingerprint is unchanged. A re-read would now see iterate-C
      // and LOSE iterate-A; because the fingerprint is unchanged the cache MUST
      // serve the original index — direct proof the file was not re-read.
      writeFileSync(log, JSON.stringify({ ...RUN_A, adr_id: "iterate-C" }) + "\n");
      utimesSync(log, pinned, pinned);

      expect(findWorkCompleted(root, "iterate-A").status).toBe("found"); // cached, not re-read
      expect(findWorkCompleted(root, "iterate-C").status).toBe("absent"); // disk truth unseen
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports `absent` (not `unavailable`) for a runId a present log does not carry", () => {
    const root = project();
    try {
      writeFileSync(logPath(root), JSON.stringify(RUN_A) + "\n");
      expect(findWorkCompleted(root, "iterate-NOPE").status).toBe("absent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports `absent` when the log file does not exist yet (the mid-run state)", () => {
    const root = project();
    try {
      expect(findWorkCompleted(root, "iterate-A").status).toBe("absent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rebuilds the index when the log changes (a newly appended run becomes visible)", () => {
    const root = project();
    const log = logPath(root);
    try {
      writeFileSync(log, JSON.stringify(RUN_A) + "\n");
      const before = findWorkCompleted(root, "iterate-A");
      expect(findWorkCompleted(root, "iterate-B").status).toBe("absent");

      appendFileSync(log, JSON.stringify(RUN_B) + "\n"); // size grows ⇒ fingerprint moves
      const b = findWorkCompleted(root, "iterate-B");
      const after = findWorkCompleted(root, "iterate-A");
      expect(b.status).toBe("found");
      expect(after.status).toBe("found");
      if (before.status === "found" && after.status === "found") {
        // A full rebuild ⇒ A's projection is a fresh object, not the cached one.
        expect(after.run).not.toBe(before.run);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
