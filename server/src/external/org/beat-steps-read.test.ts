import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { readBeatStepsCore, BEAT_ID_RE } from "./beat-steps-read.js";

const VALID_BEAT_ID = "9f1c9e2a-2b1e-4a1e-9c1e-1a2b3c4d5e6f";

describe("BEAT_ID_RE", () => {
  it("matches a randomUUID-shaped id", () => {
    expect(BEAT_ID_RE.test(VALID_BEAT_ID)).toBe(true);
  });
  it("rejects a traversal attempt", () => {
    expect(BEAT_ID_RE.test("../../etc/passwd")).toBe(false);
  });
  it("rejects an empty string", () => {
    expect(BEAT_ID_RE.test("")).toBe(false);
  });
});

describe("readBeatStepsCore — refusal before any fs call", () => {
  it("refuses an invalid leadId", () => {
    const openSync = vi.fn();
    const result = readBeatStepsCore(
      { leadsRoot: "/leads", openSync: openSync as unknown as typeof import("node:fs").openSync },
      "../bad",
      VALID_BEAT_ID,
    );
    expect(result).toEqual({ status: "unreadable" });
    expect(openSync).not.toHaveBeenCalled();
  });

  it("refuses an invalid beatId", () => {
    const openSync = vi.fn();
    const result = readBeatStepsCore(
      { leadsRoot: "/leads", openSync: openSync as unknown as typeof import("node:fs").openSync },
      "lead-a",
      "../../etc/passwd",
    );
    expect(result).toEqual({ status: "unreadable" });
    expect(openSync).not.toHaveBeenCalled();
  });

  it("ENOENT (no steps.jsonl at all) reads as ok/empty — the optional-steps protocol", () => {
    const openSync = vi.fn(() => {
      const err = new Error("missing") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    const result = readBeatStepsCore(
      { leadsRoot: "/leads", openSync: openSync as unknown as typeof import("node:fs").openSync },
      "lead-a",
      VALID_BEAT_ID,
    );
    expect(result).toEqual({ status: "ok", steps: [], unreadableLines: 0 });
  });

  it("a symlinked steps.jsonl is unreadable, not empty", () => {
    const openSync = vi.fn(() => {
      const err = new Error("symlink") as NodeJS.ErrnoException;
      err.code = "ELOOP";
      throw err;
    });
    const result = readBeatStepsCore(
      { leadsRoot: "/leads", openSync: openSync as unknown as typeof import("node:fs").openSync },
      "lead-a",
      VALID_BEAT_ID,
    );
    expect(result).toEqual({ status: "unreadable" });
  });
});

describe("readBeatStepsCore — real content (tmpdir)", () => {
  let leadsRoot: string;
  let beatDir: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "beat-steps-fixture-"));
    beatDir = path.join(leadsRoot, "lead-a", "beats", VALID_BEAT_ID);
    mkdirSync(beatDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(leadsRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function writeSteps(content: string): void {
    writeFileSync(path.join(beatDir, "steps.jsonl"), content, "utf8");
  }

  it("2 valid lines + 1 malformed line -> ok, 2 steps, unreadableLines:1", () => {
    const valid1 = JSON.stringify({ at: "2026-09-08T02:00:00Z", band: "bugfix", summary: "a", effect: { kind: "none" } });
    const valid2 = JSON.stringify({ at: "2026-09-08T02:05:00Z", band: "feature", summary: "b", effect: { kind: "card", taskId: "t1" } });
    writeSteps(`${valid1}\nnot json\n${valid2}\n`);
    const result = readBeatStepsCore({ leadsRoot }, "lead-a", VALID_BEAT_ID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.steps).toHaveLength(2);
      expect(result.unreadableLines).toBe(1);
      expect(result.steps[0].band).toBe("bugfix");
      expect(result.steps[1].band).toBe("feature");
    }
  });

  it("ALL lines malformed -> ok, 0 steps, unreadableLines:N (never a file-level failure)", () => {
    writeSteps("not json\nalso not json\n");
    const result = readBeatStepsCore({ leadsRoot }, "lead-a", VALID_BEAT_ID);
    expect(result).toEqual({ status: "ok", steps: [], unreadableLines: 2 });
  });

  it("a truncated final line (mid-append race) counts as one unreadable line, not a whole-file failure", () => {
    const valid1 = JSON.stringify({ at: "2026-09-08T02:00:00Z", band: "bugfix", summary: "a", effect: { kind: "none" } });
    writeSteps(`${valid1}\n{"at":"2026-09-08T02:10:00Z","band":"fea`); // truncated, no trailing newline
    const result = readBeatStepsCore({ leadsRoot }, "lead-a", VALID_BEAT_ID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.steps).toHaveLength(1);
      expect(result.unreadableLines).toBe(1);
    }
  });

  it("a step failing the semantic guard (bad band) counts as unreadable, not accepted", () => {
    const bad = JSON.stringify({ at: "x", band: "not-a-band", summary: "a", effect: { kind: "none" } });
    writeSteps(`${bad}\n`);
    const result = readBeatStepsCore({ leadsRoot }, "lead-a", VALID_BEAT_ID);
    expect(result).toEqual({ status: "ok", steps: [], unreadableLines: 1 });
  });
});
