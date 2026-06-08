/*
 * triage-store.union.test.ts — union (tracked ∪ outbox) read coverage for
 * iterate-2026-06-08-triage-outbox-union-reader. Split out of
 * triage-store.test.ts to keep both files under the 300-LOC limit.
 *
 * The single-file readAllItems contract (+ filterTriage / findItemById) stays
 * in triage-store.test.ts; this file covers the per-tree outbox union added by
 * shipwright campaign 2026-06-08-triage-outbox-delivery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  utimesSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { readAllItems, _clearCache_TEST_ONLY } from "./triage-store.js";
import { outboxPathFor } from "./triage-paths.js";

const FIXTURE_UNION_TRACKED = path.resolve(
  __dirname,
  "../test/fixtures/triage-union.tracked.jsonl",
);
const FIXTURE_UNION_OUTBOX = path.resolve(
  __dirname,
  "../test/fixtures/triage-union.outbox.jsonl",
);
const FIXTURE_UNION_RESOLVED = path.resolve(
  __dirname,
  "../test/fixtures/triage-union-resolved.json",
);

const HEADER = `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}`;

function appendLine(id: string, ts: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "append",
    id,
    ts,
    originalTs: ts,
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: `title ${id}`,
    detail: `detail ${id}`,
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: `dedup:${id}`,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    ...extra,
  });
}

function statusLine(
  id: string,
  ts: string,
  newStatus: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    event: "status",
    id,
    ts,
    newStatus,
    by: "webui",
    reason: null,
    promotedTaskId: null,
    ...extra,
  });
}

describe("triage-store: readAllItems — union (tracked ∪ outbox)", () => {
  let workDir: string;
  let trackedPath: string;
  let outboxPath: string;

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-union-"));
    trackedPath = path.join(workDir, "triage.jsonl");
    outboxPath = outboxPathFor(trackedPath);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("surfaces an outbox-only append (the regression case) with no tracked file", () => {
    // Background idle-main producer wrote ONLY to the headerless outbox.
    writeFileSync(outboxPath, appendLine("trg-outonly", "2026-06-01T08:00:00Z") + "\n");
    const items = readAllItems(trackedPath);
    expect(items.map((i) => i.id)).toEqual(["trg-outonly"]);
    expect(items[0].status).toBe("triage");
  });

  it("merges a tracked append with an outbox-only append (header in tracked only)", () => {
    writeFileSync(trackedPath, `${HEADER}\n${appendLine("trg-track", "2026-06-01T08:00:00Z")}\n`);
    writeFileSync(outboxPath, appendLine("trg-out", "2026-06-01T08:05:00Z") + "\n");
    const items = readAllItems(trackedPath);
    expect(items.map((i) => i.id).sort()).toEqual(["trg-out", "trg-track"]);
  });

  it("applies an OUTBOX status flip to a TRACKED append (cross-file)", () => {
    writeFileSync(trackedPath, `${HEADER}\n${appendLine("trg-x", "2026-06-01T08:00:00Z")}\n`);
    writeFileSync(
      outboxPath,
      statusLine("trg-x", "2026-06-01T11:00:00Z", "dismissed", { reason: "outbox flip" }) + "\n",
    );
    const [item] = readAllItems(trackedPath);
    expect(item.status).toBe("dismissed");
    expect(item.statusReason).toBe("outbox flip");
  });

  it("applies a TRACKED status flip to an OUTBOX append (cross-file)", () => {
    writeFileSync(outboxPath, appendLine("trg-y", "2026-06-01T08:00:00Z") + "\n");
    writeFileSync(
      trackedPath,
      `${HEADER}\n${statusLine("trg-y", "2026-06-01T12:00:00Z", "promoted", {
        reason: "webuiPromote",
        promotedTaskId: "EXT:task-9",
      })}\n`,
    );
    const [item] = readAllItems(trackedPath);
    expect(item.status).toBe("promoted");
    expect(item.promotedTaskId).toBe("EXT:task-9");
  });

  it("collapses a same-id append present in BOTH files (post-sweep, pre-GC)", () => {
    const line = appendLine("trg-dup", "2026-06-01T08:00:00Z");
    writeFileSync(trackedPath, `${HEADER}\n${line}\n`);
    writeFileSync(outboxPath, line + "\n");
    const items = readAllItems(trackedPath);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("trg-dup");
  });

  it("orders cross-file status by ts: the chronologically-later flip wins regardless of file order", () => {
    // Tracked has the EARLIER status (file-order first); outbox has the LATER
    // status. ts-primary ordering => later (outbox) wins.
    writeFileSync(
      trackedPath,
      `${HEADER}\n${appendLine("trg-r", "2026-06-01T08:00:00Z")}\n${statusLine(
        "trg-r",
        "2026-06-01T09:00:00Z",
        "snoozed",
      )}\n`,
    );
    writeFileSync(
      outboxPath,
      statusLine("trg-r", "2026-06-01T10:00:00Z", "dismissed", { reason: "later wins" }) + "\n",
    );
    const [item] = readAllItems(trackedPath);
    expect(item.status).toBe("dismissed");
    expect(item.statusReason).toBe("later wins");
  });

  it("equal-ts cross-file tiebreak: the OUTBOX status (later file order) wins", () => {
    // Both status events share a ts; ordering falls back to file order, and
    // outbox lines follow tracked lines in the union → outbox wins.
    writeFileSync(
      trackedPath,
      `${HEADER}\n${appendLine("trg-tie", "2026-06-01T08:00:00Z")}\n${statusLine(
        "trg-tie",
        "2026-06-01T13:00:00Z",
        "snoozed",
        { reason: "tracked loses" },
      )}\n`,
    );
    writeFileSync(
      outboxPath,
      statusLine("trg-tie", "2026-06-01T13:00:00Z", "dismissed", { reason: "outbox wins" }) + "\n",
    );
    const [item] = readAllItems(trackedPath);
    expect(item.status).toBe("dismissed");
    expect(item.statusReason).toBe("outbox wins");
  });

  it("tolerates corrupt lines in the outbox without throwing", () => {
    writeFileSync(
      outboxPath,
      ["this is not json", appendLine("trg-ok", "2026-06-01T08:00:00Z")].join("\n") + "\n",
    );
    const items = readAllItems(trackedPath);
    expect(items.map((i) => i.id)).toEqual(["trg-ok"]);
  });

  it("matches Python read_all_items() byte-for-byte on the union fixtures (parity gate)", () => {
    // UNION PARITY GATE — TS union read must equal `triage.py read_all_items`
    // over the tracked ∪ outbox view. Regen: `uv run server/scripts/regen-triage-fixtures.py`.
    writeFileSync(trackedPath, readFileSync(FIXTURE_UNION_TRACKED, "utf-8"));
    writeFileSync(outboxPath, readFileSync(FIXTURE_UNION_OUTBOX, "utf-8"));
    const tsItems = readAllItems(trackedPath);
    const expected = JSON.parse(readFileSync(FIXTURE_UNION_RESOLVED, "utf-8")) as {
      items: unknown[];
    };
    expect(tsItems).toEqual(expected.items);
  });

  it("caches the union by both mtimes: same reference within TTL, fresh read when the outbox changes", () => {
    writeFileSync(trackedPath, `${HEADER}\n${appendLine("trg-base", "2026-06-01T08:00:00Z")}\n`);
    writeFileSync(outboxPath, appendLine("trg-out1", "2026-06-01T08:01:00Z") + "\n");
    const first = readAllItems(trackedPath);
    expect(first.map((i) => i.id).sort()).toEqual(["trg-base", "trg-out1"]);
    // Unchanged tracked + outbox mtimes within TTL => cache hit => same ref.
    // (Guards against an impl that always reparses and returns a fresh array.)
    const cached = readAllItems(trackedPath);
    expect(cached).toBe(first);
    // Append a new outbox item and bump the outbox mtime forward so the cache
    // (keyed on BOTH tracked + outbox mtimes) must miss and re-read.
    writeFileSync(
      outboxPath,
      appendLine("trg-out1", "2026-06-01T08:01:00Z") +
        "\n" +
        appendLine("trg-out2", "2026-06-01T08:02:00Z") +
        "\n",
    );
    const future = new Date(Date.now() + 10_000);
    utimesSync(outboxPath, future, future);
    const second = readAllItems(trackedPath);
    expect(second).not.toBe(first); // outbox mtime changed => cache invalidated
    expect(second.map((i) => i.id).sort()).toEqual(["trg-base", "trg-out1", "trg-out2"]);
  });
});
