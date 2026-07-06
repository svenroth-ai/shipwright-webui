/*
 * triage-compose.test.ts — the delivered-origin 3-source composer
 * (root-cause fix for the "ghost" bug: the Local-Main board read only the
 * local tracked ∪ outbox and missed dismisses already delivered to origin).
 *
 * The composer is a PURE function of (local tracked, local outbox, injected
 * origin raw lines): no git here. The git layer (triage-origin.ts) is tested
 * separately with mocked child_process. This file exhaustively covers the
 * resolution matrix the external review (GPT-5.4 #2/#3/#10) flagged:
 *   - origin-delivered dismiss the local files lack
 *   - origin reopen AFTER a local dismiss (ts-primary → origin wins)
 *   - local re-dismiss AFTER an origin reopen (ts-primary → local wins)
 *   - equal-ts tie ordering [tracked, origin, outbox] (outbox last wins)
 *   - degrade (origin=null) is byte-for-byte identical to readAllItems
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { readAllItems, _clearCache_TEST_ONLY } from "./triage-store.js";
import { readAllItemsWithDeliveredOrigin } from "./triage-compose.js";

const HEADER = `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}`;

function append(id: string, ts: string): Record<string, unknown> {
  return {
    event: "append",
    id,
    ts,
    originalTs: ts,
    source: "github",
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
  };
}

function status(id: string, ts: string, newStatus: string): Record<string, unknown> {
  return { event: "status", id, ts, newStatus, by: "webui", reason: null, promotedTaskId: null };
}

/** Write a temp `.shipwright/triage.jsonl` (+ optional outbox); return the tracked path. */
function setupLocal(
  tracked: Record<string, unknown>[],
  outbox: Record<string, unknown>[] = [],
): string {
  const root = mkdtempSync(path.join(tmpdir(), "compose-"));
  const dir = path.join(root, ".shipwright");
  mkdirSync(dir, { recursive: true });
  const trackedPath = path.join(dir, "triage.jsonl");
  writeFileSync(trackedPath, [HEADER, ...tracked.map((e) => JSON.stringify(e))].join("\n") + "\n");
  if (outbox.length) {
    writeFileSync(
      path.join(dir, "triage.outbox.jsonl"),
      outbox.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  }
  return trackedPath;
}

function statusOf(items: { id: string; status: string }[], id: string): string | undefined {
  return items.find((it) => it.id === id)?.status;
}

describe("readAllItemsWithDeliveredOrigin", () => {
  beforeEach(() => _clearCache_TEST_ONLY());

  it("shows an origin-delivered dismiss the local files lack (the ghost fix)", () => {
    const trackedPath = setupLocal([append("trg-a", "2026-07-01T10:00:00Z")]);
    const originRawLines = [
      append("trg-a", "2026-07-01T10:00:00Z"),
      status("trg-a", "2026-07-02T09:00:00Z", "dismissed"),
    ];
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines });
    expect(statusOf(items, "trg-a")).toBe("dismissed");
  });

  it("keeps a not-yet-delivered local outbox dismiss (origin lacks it)", () => {
    const trackedPath = setupLocal(
      [append("trg-b", "2026-07-01T10:00:00Z")],
      [status("trg-b", "2026-07-01T11:00:00Z", "dismissed")],
    );
    const originRawLines = [append("trg-b", "2026-07-01T10:00:00Z")];
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines });
    expect(statusOf(items, "trg-b")).toBe("dismissed");
  });

  it("still shows an item appended locally but absent on origin", () => {
    const trackedPath = setupLocal([append("trg-c", "2026-07-01T10:00:00Z")]);
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines: [] });
    expect(statusOf(items, "trg-c")).toBe("triage");
  });

  it("origin reopen AFTER a local dismiss wins by newer ts (item stays open)", () => {
    const trackedPath = setupLocal([append("trg-d", "2026-07-01T10:00:00Z")]);
    const originRawLines = [
      append("trg-d", "2026-07-01T10:00:00Z"),
      status("trg-d", "2026-07-02T09:00:00Z", "dismissed"),
      status("trg-d", "2026-07-03T09:00:00Z", "triage"), // reopened on origin, later
    ];
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines });
    expect(statusOf(items, "trg-d")).toBe("triage");
  });

  it("local re-dismiss AFTER an origin reopen wins by newer ts (dismissed)", () => {
    const trackedPath = setupLocal(
      [append("trg-e", "2026-07-01T10:00:00Z")],
      [status("trg-e", "2026-07-04T09:00:00Z", "dismissed")], // freshest local intent
    );
    const originRawLines = [
      append("trg-e", "2026-07-01T10:00:00Z"),
      status("trg-e", "2026-07-02T09:00:00Z", "dismissed"),
      status("trg-e", "2026-07-03T09:00:00Z", "triage"),
    ];
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines });
    expect(statusOf(items, "trg-e")).toBe("dismissed");
  });

  it("equal-ts tie: local outbox wins over origin (outbox is ordered last)", () => {
    const T = "2026-07-02T09:00:00Z";
    const trackedPath = setupLocal(
      [append("trg-f", "2026-07-01T10:00:00Z")],
      [status("trg-f", T, "snoozed")],
    );
    const originRawLines = [append("trg-f", "2026-07-01T10:00:00Z"), status("trg-f", T, "dismissed")];
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines });
    expect(statusOf(items, "trg-f")).toBe("snoozed");
  });

  it("equal-ts tie: origin wins over local tracked (origin ordered after tracked)", () => {
    const T = "2026-07-02T09:00:00Z";
    const trackedPath = setupLocal([
      append("trg-g", "2026-07-01T10:00:00Z"),
      status("trg-g", T, "dismissed"),
    ]);
    const originRawLines = [append("trg-g", "2026-07-01T10:00:00Z"), status("trg-g", T, "snoozed")];
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines });
    expect(statusOf(items, "trg-g")).toBe("snoozed");
  });

  it("collapses a duplicate append across local+origin to one resolved item", () => {
    const trackedPath = setupLocal([append("trg-h", "2026-07-01T10:00:00Z")]);
    const originRawLines = [
      append("trg-h", "2026-07-01T10:00:00Z"), // duplicate append
      status("trg-h", "2026-07-02T09:00:00Z", "dismissed"),
    ];
    const items = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines });
    expect(items.filter((it) => it.id === "trg-h")).toHaveLength(1);
    expect(statusOf(items, "trg-h")).toBe("dismissed");
  });

  it("degrade (origin=null) is identical to readAllItems", () => {
    const trackedPath = setupLocal(
      [append("trg-i", "2026-07-01T10:00:00Z"), append("trg-j", "2026-07-01T10:05:00Z")],
      [status("trg-i", "2026-07-01T11:00:00Z", "dismissed")],
    );
    _clearCache_TEST_ONLY();
    const baseline = readAllItems(trackedPath);
    const composed = readAllItemsWithDeliveredOrigin(trackedPath, { originRawLines: null });
    expect(composed).toEqual(baseline);
  });
});
