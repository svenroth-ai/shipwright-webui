/*
 * decision-drops.ts — the reader for the source a run's decisions ACTUALLY live
 * in between F3 and the next release.
 *
 * Two of these cases are REAL-FILE probes against this repo's own drops
 * directory rather than fixtures. That is deliberate: the campaign that built
 * this artifact shipped four bugs that fixtures did not catch, and the one that
 * mattered most was found by reading a real file and discovering the assumption
 * was wrong.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { dropFilePaths, readRunDrops, decisionDropsDir } from "./decision-drops.js";

const RUN = "iterate-2026-07-19-example";
const DROPS = [".shipwright", "agent_docs", "decision-drops"];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "sw-drops-"));
  mkdirSync(path.join(root, ...DROPS), { recursive: true });
  return root;
}

function writeDrop(root: string, name: string, body: unknown): void {
  writeFileSync(
    path.join(root, ...DROPS, name),
    typeof body === "string" ? body : JSON.stringify(body),
    "utf-8",
  );
}

function validDrop(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: RUN,
    date: "2026-07-19",
    section: "Iterate — change",
    title: "Read the drops, not only the log",
    context: "The log is empty until a release aggregates.",
    decision: "Resolve from drops union log.",
    consequences: "Decisions render for an unmerged run.",
    rationale: "A source that is empty by design is not evidence of no decision.",
    rejected: "Waiting for the release.",
    commit: "",
    architecture_impact: "none",
    spec_ref: ".shipwright/planning/adr/137-example.md",
    ...over,
  };
}

describe("readRunDrops — the unnumbered half of the Decisions source", () => {
  it("reads a run's own drop and renders its recorded fields", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, validDrop());
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(1);
      expect(r.malformed).toBe(0);
      expect(r.entries[0].title).toBe("Read the drops, not only the log");
      // The rendered body carries the fields the panel shows — an absolute
      // expectation, not "contains something".
      expect(r.entries[0].markdown).toContain("Read the drops, not only the log");
      expect(r.entries[0].markdown).toContain("Resolve from drops union log.");
      expect(r.entries[0].markdown).toContain("**Run-ID:** " + RUN);
      expect(r.entries[0].markdown).toContain("Rejected alternatives");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an ABSENT drops directory is a clean empty answer, not a fault", () => {
    // No drops dir at all — a project where no iterate has ever run F3.
    const root = mkdtempSync(path.join(tmpdir(), "sw-drops-none-"));
    try {
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(0);
      // If this were `unavailable`, every project without drops would show a
      // permanent "records could not be read" on its Decisions artifact.
      expect(r.malformed).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a malformed drop is COUNTED, and never takes down the valid ones", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, validDrop());
      writeDrop(root, `${RUN}_002.json`, "{ not json at all");
      writeDrop(root, `${RUN}_003.json`, validDrop({ title: "" })); // no title
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      // The whole point: one bad file must not erase a good decision.
      expect(r.entries).toHaveLength(1);
      expect(r.malformed).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("believes the CONTENT over the FILENAME — a drop naming another run is rejected", () => {
    const root = makeProject();
    try {
      // Filename claims this run; the record inside belongs to a different one.
      writeDrop(root, `${RUN}_001.json`, validDrop({ run_id: "iterate-2026-07-19-someone-else" }));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(0);
      expect(r.malformed).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not let a PREFIX match leak another run's decisions in", () => {
    const root = makeProject();
    try {
      const other = `${RUN}-followup`;
      writeDrop(root, `${other}_001.json`, validDrop({ run_id: other, title: "Not ours" }));
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      // `startsWith(RUN)` alone would have matched `${RUN}-followup_001.json`.
      expect(r.entries).toHaveLength(0);
      expect(r.malformed).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an unsafe run id rather than building a path from it", () => {
    const root = makeProject();
    try {
      const r = readRunDrops(root, "../../../etc");
      expect(r.status).toBe("unavailable");
      if (r.status !== "unavailable") return;
      expect(r.reason).toBe("denied");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a drop that symlinks out of the project root", () => {
    const root = makeProject();
    const outside = mkdtempSync(path.join(tmpdir(), "sw-outside-"));
    try {
      const target = path.join(outside, "secret.json");
      writeFileSync(target, JSON.stringify(validDrop({ title: "Exfiltrated" })), "utf-8");
      try {
        symlinkSync(target, path.join(root, ...DROPS, `${RUN}_001.json`));
      } catch {
        return; // no symlink privilege on this machine — skip, do not fake a pass
      }
      const r = readRunDrops(root, RUN);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.entries).toHaveLength(0);
      expect(r.malformed).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("dropFilePaths — the cache-invalidation inputs", () => {
  it("lists this run's drop files and no other run's", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, validDrop());
      writeDrop(root, `${RUN}_002.json`, validDrop());
      writeDrop(root, "iterate-2026-07-19-other_001.json", validDrop());
      const paths = dropFilePaths(root, RUN);
      expect(paths).toHaveLength(2);
      expect(paths.every((p) => path.basename(p).startsWith(`${RUN}_`))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns [] — not a throw — when the drops directory does not exist", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sw-drops-none2-"));
    try {
      expect(dropFilePaths(root, RUN)).toEqual([]);
      // The DIRECTORY path is still well-formed, which is what lets the rev
      // fingerprint it as `absent` and notice its later creation.
      expect(decisionDropsDir(root)).toContain("decision-drops");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
