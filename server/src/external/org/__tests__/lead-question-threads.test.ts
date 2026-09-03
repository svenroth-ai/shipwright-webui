import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { parseLeadQuestionThreadsFile, readLeadQuestionThreadsCore } from "../lead-question-threads.js";

const VALID = {
  version: 1,
  threads: {
    "task-1": {
      taskId: "task-1",
      dedupKey: "dedup-1",
      rounds: [
        { round: 1, questionType: "clarify", question: "Q1?", askedAt: "2026-08-30T00:00:00Z" },
      ],
    },
  },
};

describe("parseLeadQuestionThreadsFile", () => {
  it("accepts a well-formed threads file", () => {
    expect(parseLeadQuestionThreadsFile(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("rejects invalid JSON", () => {
    expect(parseLeadQuestionThreadsFile("{not json")).toBeNull();
  });

  it("rejects an unknown version (trap 7 — not a crash, just 'nothing to show')", () => {
    expect(parseLeadQuestionThreadsFile(JSON.stringify({ ...VALID, version: 2 }))).toBeNull();
  });

  it("rejects a top-level array", () => {
    expect(parseLeadQuestionThreadsFile("[]")).toBeNull();
  });

  it("rejects an array-valued threads field (same class of bug org-chart.ts's parser guards)", () => {
    expect(parseLeadQuestionThreadsFile(JSON.stringify({ version: 1, threads: [] }))).toBeNull();
  });

  it("rejects a round missing a required field", () => {
    const broken = {
      version: 1,
      threads: {
        "task-1": {
          taskId: "task-1",
          dedupKey: "dedup-1",
          rounds: [{ round: 1, questionType: "clarify", askedAt: "2026-08-30T00:00:00Z" }],
        },
      },
    };
    expect(parseLeadQuestionThreadsFile(JSON.stringify(broken))).toBeNull();
  });

  it("rejects a malformed answer object", () => {
    const broken = {
      version: 1,
      threads: {
        "task-1": {
          taskId: "task-1",
          dedupKey: "dedup-1",
          rounds: [
            {
              round: 1,
              questionType: "clarify",
              question: "Q1?",
              askedAt: "2026-08-30T00:00:00Z",
              answer: { text: "A1" },
            },
          ],
        },
      },
    };
    expect(parseLeadQuestionThreadsFile(JSON.stringify(broken))).toBeNull();
  });
});

describe("readLeadQuestionThreadsCore", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "lead-question-threads-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("degrades a missing file to { ok: false } (the normal case, not an error)", () => {
    const result = readLeadQuestionThreadsCore({ leadsRoot }, "acme-lead");
    expect(result).toEqual({ ok: false });
  });

  it("reads a well-formed file", () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "lead-question-threads.json"),
      JSON.stringify(VALID),
      "utf8",
    );
    const result = readLeadQuestionThreadsCore({ leadsRoot }, "acme-lead");
    expect(result).toEqual({ ok: true, threads: VALID.threads });
  });

  it("degrades a symlinked file to { ok: false } (never followed)", () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    mkdirSync(path.join(leadsRoot, "acme-lead", "real"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "real", "target.json"),
      JSON.stringify(VALID),
      "utf8",
    );
    const symlinkPath = path.join(leadsRoot, "acme-lead", "lead-question-threads.json");
    try {
      symlinkSync(path.join(leadsRoot, "acme-lead", "real", "target.json"), symlinkPath);
    } catch {
      // No symlink privilege (e.g. unprivileged Windows) — nothing to assert.
      return;
    }
    const result = readLeadQuestionThreadsCore({ leadsRoot }, "acme-lead");
    expect(result).toEqual({ ok: false });
  });

  it("degrades invalid JSON to { ok: false }", () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(path.join(leadsRoot, "acme-lead", "lead-question-threads.json"), "{not json", "utf8");
    expect(readLeadQuestionThreadsCore({ leadsRoot }, "acme-lead")).toEqual({ ok: false });
  });

  it(
    "rejects an invalid leadId (traversal shape) with { ok: false } before touching the " +
      "filesystem — mirrors usage.test.ts's coverage of the same LEAD_ID_RE guard; the " +
      "chart's own parser validates lead FIELDS but never that an object KEY is kebab-case",
    () => {
      const result = readLeadQuestionThreadsCore({ leadsRoot }, "../../etc");
      expect(result).toEqual({ ok: false });
    },
  );

  it("rejects an uppercase / underscore leadId (not kebab-case) with { ok: false }", () => {
    const result = readLeadQuestionThreadsCore({ leadsRoot }, "ACME_LEAD");
    expect(result).toEqual({ ok: false });
  });
});
