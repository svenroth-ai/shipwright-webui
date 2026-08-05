import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  readAllItems,
  filterTriage,
  findItemById,
  _clearCache_TEST_ONLY,
} from "./triage-store.js";

// Union (tracked ∪ outbox) coverage lives in triage-store.union.test.ts.

const FIXTURE_JSONL = path.resolve(
  __dirname,
  "../test/fixtures/triage.jsonl",
);
const FIXTURE_RESOLVED = path.resolve(
  __dirname,
  "../test/fixtures/triage-resolved.json",
);

describe("triage-store: readAllItems", () => {
  let workDir: string;
  let jsonlPath: string;

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-store-"));
    jsonlPath = path.join(workDir, "triage.jsonl");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // @covers FR-01.30
  it("returns [] when file is missing", () => {
    expect(readAllItems(jsonlPath)).toEqual([]);
  });

  // @covers FR-01.30
  it("returns [] when file is empty", () => {
    writeFileSync(jsonlPath, "");
    expect(readAllItems(jsonlPath)).toEqual([]);
  });

  // @covers FR-01.30
  it("returns [] when file has only the schema header", () => {
    writeFileSync(
      jsonlPath,
      `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}\n`,
    );
    expect(readAllItems(jsonlPath)).toEqual([]);
  });

  // @covers FR-01.30
  it("matches Python read_all_items() byte-for-byte on the canonical fixture (drift-protection)", () => {
    // PARITY GATE — the TS implementation must produce the exact same
    // resolved view as `shared/scripts/triage.py read_all_items`.
    // Fixture regen: `uv run server/scripts/regen-triage-fixtures.py`.
    const jsonl = readFileSync(FIXTURE_JSONL, "utf-8");
    writeFileSync(jsonlPath, jsonl);
    const tsItems = readAllItems(jsonlPath);

    const expected = JSON.parse(readFileSync(FIXTURE_RESOLVED, "utf-8")) as {
      items: unknown[];
    };
    expect(tsItems).toEqual(expected.items);
  });

  // @covers FR-01.30
  it("tolerates corrupt JSON lines without throwing", () => {
    writeFileSync(
      jsonlPath,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        `{"event":"append","id":"trg-aaaa1111","ts":"2026-05-13T08:01:00Z","originalTs":"2026-05-13T08:01:00Z","source":"phaseQuality","severity":"high","kind":"bug","title":"X","detail":"Y","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P1","suggestedDomain":"engineering"}`,
        `this is not json at all`,
        `{"event":"append","id":"trg-bbbb2222","ts":"2026-05-13T09:00:00Z","originalTs":"2026-05-13T09:00:00Z","source":"compliance","severity":"low","kind":"compliance","title":"Z","detail":"W","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P3","suggestedDomain":"compliance"}`,
      ].join("\n") + "\n",
    );
    const items = readAllItems(jsonlPath);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["trg-aaaa1111", "trg-bbbb2222"]);
  });

  // @covers FR-01.30
  it("status events overlay status / ts / statusBy / statusReason", () => {
    writeFileSync(
      jsonlPath,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        `{"event":"append","id":"trg-x","ts":"2026-05-13T08:01:00Z","originalTs":"2026-05-13T08:01:00Z","source":"phaseQuality","severity":"high","kind":"bug","title":"X","detail":"Y","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P1","suggestedDomain":"engineering"}`,
        `{"event":"status","id":"trg-x","ts":"2026-05-13T10:00:00Z","newStatus":"dismissed","by":"manualReview","reason":"out of scope","promotedTaskId":null}`,
      ].join("\n") + "\n",
    );
    const [item] = readAllItems(jsonlPath);
    expect(item.status).toBe("dismissed");
    expect(item.ts).toBe("2026-05-13T10:00:00Z");
    expect(item.statusBy).toBe("manualReview");
    expect(item.statusReason).toBe("out of scope");
    expect(item.promotedTaskId).toBeNull();
  });

  // @covers FR-01.30
  it("status event with promotedTaskId overrides null", () => {
    writeFileSync(
      jsonlPath,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        `{"event":"append","id":"trg-x","ts":"2026-05-13T08:01:00Z","originalTs":"2026-05-13T08:01:00Z","source":"phaseQuality","severity":"high","kind":"bug","title":"X","detail":"Y","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P1","suggestedDomain":"engineering"}`,
        `{"event":"status","id":"trg-x","ts":"2026-05-13T10:00:00Z","newStatus":"promoted","by":"webui","reason":"webuiPromote","promotedTaskId":"EXT:abc-123"}`,
      ].join("\n") + "\n",
    );
    const [item] = readAllItems(jsonlPath);
    expect(item.status).toBe("promoted");
    expect(item.promotedTaskId).toBe("EXT:abc-123");
  });

  // @covers FR-01.30
  it("status event for unknown id is skipped (out-of-order corruption)", () => {
    writeFileSync(
      jsonlPath,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        `{"event":"status","id":"trg-orphan","ts":"2026-05-13T10:00:00Z","newStatus":"dismissed","by":"manualReview","reason":null,"promotedTaskId":null}`,
        `{"event":"append","id":"trg-y","ts":"2026-05-13T08:01:00Z","originalTs":"2026-05-13T08:01:00Z","source":"phaseQuality","severity":"high","kind":"bug","title":"Y","detail":"Z","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P1","suggestedDomain":"engineering"}`,
      ].join("\n") + "\n",
    );
    const items = readAllItems(jsonlPath);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("trg-y");
    expect(items[0].status).toBe("triage");
  });

  // @covers FR-01.30
  it("mtime-keyed cache returns the same array reference within TTL", () => {
    writeFileSync(
      jsonlPath,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        `{"event":"append","id":"trg-cached","ts":"2026-05-13T08:01:00Z","originalTs":"2026-05-13T08:01:00Z","source":"phaseQuality","severity":"high","kind":"bug","title":"X","detail":"Y","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P1","suggestedDomain":"engineering"}`,
      ].join("\n") + "\n",
    );
    const first = readAllItems(jsonlPath);
    const second = readAllItems(jsonlPath);
    expect(second).toBe(first); // same reference => cache hit
  });

  // @covers FR-01.30 (doubt review, iterate-2026-08-05-triage-deferred-envelope)
  it("re-derives the overlay when the UTC day turns over WITHIN the cache TTL, even with no file change", () => {
    writeFileSync(
      jsonlPath,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        `{"event":"append","id":"trg-park","ts":"2026-05-13T08:01:00Z","originalTs":"2026-05-13T08:01:00Z","source":"phaseQuality","severity":"high","kind":"bug","title":"X","detail":"Y","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P1","suggestedDomain":"engineering"}`,
        `{"event":"status","id":"trg-park","ts":"2026-05-13T09:00:00Z","newStatus":"snoozed","by":"webui","reason":"parked","promotedTaskId":null,"revisitAt":"2026-08-05"}`,
      ].join("\n") + "\n",
    );
    try {
      vi.useFakeTimers();
      // Fill the cache 2s before the park's due day arrives.
      vi.setSystemTime(new Date("2026-08-04T23:59:58.000Z"));
      const before = readAllItems(jsonlPath);
      expect(before.find((i) => i.id === "trg-park")?.status).toBe("snoozed");

      // Cross the UTC-day boundary 4s later — still inside the 5s TTL, no
      // file touched. Without the day-check fix this would keep serving the
      // stale pre-boundary array (see triage-store.ts CacheEntry.overlayDay).
      vi.setSystemTime(new Date("2026-08-05T00:00:02.000Z"));
      const after = readAllItems(jsonlPath);
      const item = after.find((i) => i.id === "trg-park");
      expect(item?.status).toBe("triage");
      expect(item?.revisitDue).toBe(true);
      // Reference changes (new overlay computed) but this is the SAME call
      // path a mutation route's pre-check uses — freshness, not identity,
      // is the property under test here.
      expect(after).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the SAME reference across two reads on the same UTC day (no needless re-overlay)", () => {
    writeFileSync(
      jsonlPath,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        `{"event":"append","id":"trg-same","ts":"2026-05-13T08:01:00Z","originalTs":"2026-05-13T08:01:00Z","source":"phaseQuality","severity":"high","kind":"bug","title":"X","detail":"Y","evidencePath":null,"runId":null,"commit":null,"dedupKey":null,"status":"triage","suggestedPriority":"P1","suggestedDomain":"engineering"}`,
      ].join("\n") + "\n",
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
      const first = readAllItems(jsonlPath);
      vi.setSystemTime(new Date("2026-08-05T12:00:02.000Z"));
      const second = readAllItems(jsonlPath);
      expect(second).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("triage-store: filterTriage + findItemById", () => {
  // @covers FR-01.30
  it("filters to status===triage", () => {
    const items: any[] = [
      { id: "a", status: "triage" },
      { id: "b", status: "promoted" },
      { id: "c", status: "dismissed" },
      { id: "d", status: "triage" },
    ];
    const filtered = filterTriage(items as never);
    expect(filtered.map((i) => i.id)).toEqual(["a", "d"]);
  });

  // @covers FR-01.30
  it("findItemById returns the matching item", () => {
    const items: any[] = [
      { id: "a", status: "triage" },
      { id: "b", status: "promoted" },
    ];
    expect(findItemById(items as never, "b")?.status).toBe("promoted");
    expect(findItemById(items as never, "missing")).toBeUndefined();
  });
});
