import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Steerable existence probe: node:fs export namespaces are non-configurable in
// ESM (vi.spyOn cannot redefine them), so mock the module and keep every export
// actual EXCEPT existsSync, which a test can force to "miss" a single path.
const hoisted = vi.hoisted(() => ({
  existsOverride: null as ((p: string) => boolean | undefined) | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const existsSync = ((p: nodeFsPathLike, ...rest: unknown[]) => {
    if (hoisted.existsOverride) {
      const forced = hoisted.existsOverride(String(p));
      if (forced !== undefined) return forced;
    }
    return (actual.existsSync as (...a: unknown[]) => boolean)(p, ...rest);
  }) as typeof actual.existsSync;
  const patched = { ...actual, existsSync };
  return { ...patched, default: patched };
});

type nodeFsPathLike = string | Buffer | URL;

import { appendStatusEvent } from "./triage-write.js";
import { _clearCache_TEST_ONLY } from "./triage-store.js";

// Kept OUT of triage-write.test.ts on purpose (that file is bloat-baselined at
// 373 lines — growing it would ratchet the anti-ratchet baseline). Pins the fix
// for CodeQL js/file-system-race #292: the header-bootstrap write must not be a
// check-then-write TOCTOU that can truncate a tracked store a concurrent Python
// producer created in the window between the existence probe and the write.

const LF = String.fromCharCode(10);
const HEADER = JSON.stringify({ v: 1, schema: "triage", created: "2026-07-18T07:00:00Z" });

function appendLine(id: string): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-07-18T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    title: `title ${id}`,
    detail: `detail ${id}`,
    dedupKey: `dedup:${id}`,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
}

function flip(jsonlPath: string, id: string) {
  appendStatusEvent({
    jsonlPath,
    triageId: id,
    newStatus: "dismissed",
    by: "webui",
    reason: null,
    promotedTaskId: null,
    now: () => "2026-07-18T09:00:00Z",
  });
}

describe("triage-write: header bootstrap is race-safe (js/file-system-race #292)", () => {
  let workDir: string;
  let jsonlPath: string;

  beforeEach(() => {
    hoisted.existsOverride = null;
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-fsrace-"));
    jsonlPath = path.join(workDir, ".shipwright", "triage.jsonl");
    mkdirSync(path.dirname(jsonlPath), { recursive: true });
  });

  afterEach(() => {
    hoisted.existsOverride = null;
    rmSync(workDir, { recursive: true, force: true });
  });

  it("does not clobber a tracked store a concurrent producer wrote after the existence check", () => {
    // A Python producer (disjoint lock primitive — ADR-101/106) created AND
    // populated the tracked store in the window between appendStatusEvent's
    // existence probe and its header write.
    writeFileSync(jsonlPath, HEADER + LF + appendLine("trg-producer99") + LF);

    // Force the existence probe to MISS the file for the tracked path only —
    // exactly what a lost race looks like from inside appendStatusEvent. Every
    // other path (parent dir, outbox, endsWithoutNewline via openSync) stays
    // real, so only the header-bootstrap decision is under test.
    hoisted.existsOverride = (p) => (p === jsonlPath ? false : undefined);

    flip(jsonlPath, "trg-producer99");

    hoisted.existsOverride = null;
    _clearCache_TEST_ONLY();

    const contents = readFileSync(jsonlPath, "utf-8");
    // The producer's append record MUST survive — the header write must not
    // have truncated the file out from under it.
    expect(contents).toContain('"id":"trg-producer99"');
    expect(contents).toContain('"event":"append"');
    // The status flip still landed.
    expect(contents).toContain('"event":"status"');
    // Every physical line still parses on its own — no corruption / concatenation.
    for (const l of contents.split(LF).filter(Boolean)) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });

  it("still bootstraps the schema header when the tracked store is genuinely absent", () => {
    // Regression guard: closing the race must not break first-write bootstrap.
    flip(jsonlPath, "trg-fresh0001");
    const lines = readFileSync(jsonlPath, "utf-8").split(LF).filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ v: 1, schema: "triage" });
    expect(JSON.parse(lines[1])).toMatchObject({
      event: "status",
      id: "trg-fresh0001",
      newStatus: "dismissed",
    });
  });
});
