/*
 * decisions.test.ts — the Run-ID filter over `decision_log.md` (Slice-2 AC3).
 *
 * AC3 is an ISOLATION property: two iterates running at the same time append
 * their ADRs to the same 639 KB log, minutes apart, and neither may show the
 * other's decisions. That makes the filter's EXACTNESS the whole feature — a
 * substring or prefix test would pass a naive fixture and leak in production,
 * so the concurrent-iterate case below uses run ids that are prefixes of one
 * another on purpose.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  blockRunId,
  readRunDecisions,
  splitAdrBlocks,
  DECISION_LOG_REL,
  MAX_DECISION_ENTRIES,
} from "./decisions.js";

function projectWithLog(body: string): string {
  const root = mkdtempSync(join(tmpdir(), "mc-dec-"));
  mkdirSync(join(root, ".shipwright", "agent_docs"), { recursive: true });
  writeFileSync(join(root, ...DECISION_LOG_REL.split("/")), body, "utf-8");
  return root;
}

function adr(id: string, title: string, runId: string | null, spelling: "in" | "out" = "in"): string {
  const bullet =
    runId === null
      ? ""
      : spelling === "in"
        ? `- **Run-ID:** ${runId}\n`
        : `- **Run-ID**: ${runId}\n`;
  return `### ${id}: ${title}\n- **Date:** 2026-07-19\n${bullet}- **Decision:** Do the thing.\n\n---\n`;
}

describe("blockRunId", () => {
  it("matches BOTH real spellings in this repo's log", () => {
    expect(blockRunId("- **Run-ID:** iterate-a")).toBe("iterate-a");
    expect(blockRunId("- **Run-ID**: iterate-b")).toBe("iterate-b");
    expect(blockRunId("* **Run-ID:**   iterate-c  ")).toBe("iterate-c");
  });

  it("strips code ticks and trailing punctuation a human may have typed", () => {
    expect(blockRunId("- **Run-ID:** `iterate-a`")).toBe("iterate-a");
    expect(blockRunId('- **Run-ID:** "iterate-a".')).toBe("iterate-a");
  });

  it("returns null when the block declares no Run-ID", () => {
    expect(blockRunId("### ADR-072: x\n- **Date:** 2026-05-07")).toBeNull();
    expect(blockRunId("- **Run-ID:**   ")).toBeNull();
  });
});

describe("splitAdrBlocks", () => {
  it("splits on ADR headings at h2 and h3, keeping the id and title", () => {
    const blocks = splitAdrBlocks(
      `## ADR-045b: Deferred rows\nbody a\n\n### ADR-070: Polish round\nbody b\n`,
    );
    expect(blocks.map((b) => b.adrId)).toEqual(["ADR-045b", "ADR-070"]);
    expect(blocks[1].title).toBe("Polish round");
  });

  it("ends a block at the next h1–h3 heading, so bodies cannot bleed together", () => {
    const blocks = splitAdrBlocks(`### ADR-1: a\nbody a\n\n## Some Other Section\nnot an ADR\n`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines.join("\n")).not.toContain("not an ADR");
  });
});

describe("readRunDecisions", () => {
  it("returns ONLY the ADRs tagged with this run", () => {
    const root = projectWithLog(
      adr("ADR-100", "Mine one", "iterate-2026-07-19-mine") +
        adr("ADR-101", "Someone else", "iterate-2026-07-19-other") +
        adr("ADR-102", "Mine two", "iterate-2026-07-19-mine") +
        adr("ADR-103", "Untagged", null),
    );
    try {
      const r = readRunDecisions(root, "iterate-2026-07-19-mine");
      if (r.status !== "ok") throw new Error("expected ok");
      expect(r.entries.map((e) => e.adrId)).toEqual(["ADR-100", "ADR-102"]);
      expect(r.entries[0].title).toBe("Mine one");
      expect(r.entries[0].markdown).toContain("Do the thing.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ISOLATES a CONCURRENT iterate whose run id is a PREFIX of this one (AC3)", () => {
    // The dangerous shape: a substring/prefix match would pull both in.
    const root = projectWithLog(
      adr("ADR-200", "Base run", "iterate-2026-07-19-mission-s2") +
        adr("ADR-201", "Concurrent longer", "iterate-2026-07-19-mission-s2-followup") +
        adr("ADR-202", "Concurrent shorter", "iterate-2026-07-19-mission"),
    );
    try {
      const mine = readRunDecisions(root, "iterate-2026-07-19-mission-s2");
      if (mine.status !== "ok") throw new Error("expected ok");
      expect(mine.entries.map((e) => e.adrId)).toEqual(["ADR-200"]);

      // …and symmetrically, the longer run does not inherit the shorter's ADR.
      const other = readRunDecisions(root, "iterate-2026-07-19-mission-s2-followup");
      if (other.status !== "ok") throw new Error("expected ok");
      expect(other.entries.map((e) => e.adrId)).toEqual(["ADR-201"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches the `- **Run-ID**:` spelling too — a third of the log uses it", () => {
    const root = projectWithLog(adr("ADR-300", "Outside colon", "iterate-x", "out"));
    try {
      const r = readRunDecisions(root, "iterate-x");
      if (r.status !== "ok") throw new Error("expected ok");
      expect(r.entries.map((e) => e.adrId)).toEqual(["ADR-300"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an ok-but-EMPTY result when the log was read and this run wrote nothing", () => {
    const root = projectWithLog(adr("ADR-400", "Theirs", "iterate-theirs"));
    try {
      expect(readRunDecisions(root, "iterate-mine")).toEqual({
        status: "ok",
        entries: [],
        truncated: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports `unavailable` when the log is missing — NOT an empty ok", () => {
    const root = mkdtempSync(join(tmpdir(), "mc-dec-none-"));
    try {
      expect(readRunDecisions(root, "iterate-x")).toEqual({
        status: "unavailable",
        reason: "missing",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("caps the entry count and REPORTS the truncation", () => {
    let body = "";
    for (let i = 0; i < MAX_DECISION_ENTRIES + 5; i++) body += adr(`ADR-${500 + i}`, `t${i}`, "iterate-x");
    const root = projectWithLog(body);
    try {
      const r = readRunDecisions(root, "iterate-x");
      if (r.status !== "ok") throw new Error("expected ok");
      expect(r.entries).toHaveLength(MAX_DECISION_ENTRIES);
      expect(r.truncated).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries only the ADR SECTION, never the surrounding log", () => {
    const root = projectWithLog(
      adr("ADR-600", "Mine", "iterate-x") + adr("ADR-601", "Theirs", "iterate-y"),
    );
    try {
      const r = readRunDecisions(root, "iterate-x");
      if (r.status !== "ok") throw new Error("expected ok");
      expect(r.entries[0].markdown).toContain("ADR-600");
      expect(r.entries[0].markdown).not.toContain("ADR-601");
      expect(r.entries[0].markdown).not.toContain("Theirs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an empty run id rather than matching every untagged block", () => {
    const root = projectWithLog(adr("ADR-700", "Untagged", null));
    try {
      expect(readRunDecisions(root, "  ").status).toBe("unavailable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readRunDecisions — REAL repo log (calibration probe)", () => {
  it("finds a REAL run's ADR in this repo's 639 KB decision log", () => {
    // Not a fixture: the real, git-tracked log with 170+ Run-ID-tagged ADRs
    // among 400+ entries. If the heading/bullet parsing were wrong against real
    // data — as opposed to against a fixture shaped like the implementation —
    // this fails.
    const r = readRunDecisions(
      resolve(process.cwd(), ".."),
      "iterate-2026-07-12-mirror-flush-preserve-gate",
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.entries.length).toBeGreaterThan(0);
    for (const e of r.entries) {
      expect(e.adrId).toMatch(/^ADR-/);
      // Isolation holds on real data too: no other run's tag may ride along.
      expect(e.markdown).toContain("iterate-2026-07-12-mirror-flush-preserve-gate");
    }
  });

  it("returns zero entries for a run whose ADR has not reached the tracked log yet", () => {
    // PROBE, 2026-07-19: iterate PRs deliberately carry no agent-docs regen, so
    // a just-merged run's ADR is not in the committed log. `ok` + zero entries
    // is the correct, honest answer — the artifact hides rather than claiming
    // the run made no decisions it could not read.
    const r = readRunDecisions(
      resolve(process.cwd(), ".."),
      "iterate-2026-07-18-mission-s1-resolver-core-artifacts",
    );
    expect(r).toMatchObject({ status: "ok", entries: [] });
  });

  it("returns zero entries for a run id that recorded no ADR — no accidental matches", () => {
    const r = readRunDecisions(resolve(process.cwd(), ".."), "iterate-1999-01-01-does-not-exist");
    expect(r).toMatchObject({ status: "ok", entries: [] });
  });
});
