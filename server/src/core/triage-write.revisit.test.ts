/*
 * triage-write.revisit.test.ts — wire-format coverage for the optional
 * `revisitAt` on a status event (monorepo P2.03 parity,
 * iterate-2026-08-05-triage-deferred-envelope). Split from
 * triage-write.test.ts (already baselined at 373 lines) per the plan
 * review's bloat guidance.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { appendStatusEvent } from "./triage-write.js";
import { _clearCache_TEST_ONLY } from "./triage-store.js";

describe("appendStatusEvent — revisitAt wire format", () => {
  let workDir: string;
  let jsonlPath: string;

  afterEach(() => {
    _clearCache_TEST_ONLY();
    rmSync(workDir, { recursive: true, force: true });
  });

  it("omits the revisitAt key entirely when not supplied — never emits revisitAt:null", () => {
    workDir = mkdtempSync(path.join(tmpdir(), "triage-write-revisit-"));
    jsonlPath = path.join(workDir, "triage.jsonl");
    writeFileSync(jsonlPath, `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n`);

    appendStatusEvent({
      jsonlPath,
      triageId: "trg-nodateee",
      newStatus: "dismissed",
      by: "webui",
      reason: "out of scope",
      promotedTaskId: null,
      now: () => "2026-06-01T10:00:00Z",
    });

    const written = readFileSync(jsonlPath, "utf-8");
    const lastLine = written.trim().split("\n").at(-1)!;
    const parsed = JSON.parse(lastLine) as Record<string, unknown>;
    expect("revisitAt" in parsed).toBe(false);
  });

  it("includes revisitAt on the emitted line when supplied on a snooze", () => {
    workDir = mkdtempSync(path.join(tmpdir(), "triage-write-revisit-"));
    jsonlPath = path.join(workDir, "triage.jsonl");
    writeFileSync(jsonlPath, `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n`);

    appendStatusEvent({
      jsonlPath,
      triageId: "trg-hasdatee",
      newStatus: "snoozed",
      by: "webui",
      reason: "parked",
      promotedTaskId: null,
      revisitAt: "2099-01-01",
      now: () => "2026-06-01T10:00:00Z",
    });

    const written = readFileSync(jsonlPath, "utf-8");
    const lastLine = written.trim().split("\n").at(-1)!;
    const parsed = JSON.parse(lastLine) as Record<string, unknown>;
    expect(parsed.revisitAt).toBe("2099-01-01");
  });
});
