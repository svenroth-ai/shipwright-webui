/*
 * triage.recovery-api.test.ts — F0.5 surface=api gate for record-boundary
 * recovery (iterate-2026-07-18-triage-jsonl-record-boundary).
 *
 * The core-level tests prove `readAllItems` recovers concatenated records.
 * These prove the recovery actually reaches the Inbox and the counts endpoint
 * through the REAL production Hono route — a route unit test passing is not the
 * same as the consumer chain working.
 *
 * The regression pinned: before the fix, two records sharing one physical line
 * failed `JSON.parse` as a whole and the reader skipped the line, so BOTH
 * findings vanished from the Inbox. On an append-only log, corruption must
 * never read as absence.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";

import {
  type Harness,
  makeHarness,
  appendLine,
  TRIAGE_HEADER,
} from "./_triage-api-harness.js";

const LF = String.fromCharCode(10);

describe("triage routes — record-boundary recovery (F0.5 surface=api)", () => {
  const harnesses: Harness[] = [];
  afterEach(() => {
    for (const h of harnesses.splice(0)) h.cleanup();
  });

  it("GET /:projectId returns BOTH records sharing one physical line", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // No separating newline — an unterminated predecessor, exactly what an
    // interrupted write or a foreign writer leaves behind.
    writeFileSync(
      h.triagePath,
      TRIAGE_HEADER +
        LF +
        appendLine("trg-concat1", "compliance") +
        appendLine("trg-concat2", "drift") +
        LF,
    );

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.items as Array<{ id: string }>).map((i) => i.id).sort();
    expect(ids).toEqual(["trg-concat1", "trg-concat2"]);
  });

  it("GET /:projectId keeps the valid record when the rest of the line is unrecoverable", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // Partial recovery: all-or-nothing here would reproduce the original bug.
    writeFileSync(
      h.triagePath,
      TRIAGE_HEADER +
        LF +
        appendLine("trg-partial1", "compliance") +
        '{"event":"append","id":' +
        LF,
    );

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toEqual(["trg-partial1"]);
  });

  it("GET /counts no longer under-counts a project with a concatenated line", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    writeFileSync(
      h.triagePath,
      TRIAGE_HEADER +
        LF +
        appendLine("trg-count001", "compliance") +
        appendLine("trg-count002", "drift") +
        LF,
    );

    const res = await h.app.request("/api/triage/counts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(2);
  });

  it("GET /:projectId still returns 200 with an empty list for a wholly corrupt file", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // Recovery must not turn unparseable input into a 500 — the endpoint
    // degrades exactly as it did before.
    writeFileSync(h.triagePath, ["not json at all", "still not json"].join(LF) + LF);

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it("a dismiss still lands correctly on a file that had a concatenated line", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // Recovery feeds `appendIdsInFile`, which drives residence routing for the
    // write — so this exercises recovery on the WRITE path, not just the read.
    // Ids must satisfy the flip route's /^trg-[0-9a-fA-F]{8}$/ body validator.
    writeFileSync(
      h.triagePath,
      TRIAGE_HEADER +
        LF +
        appendLine("trg-abcd0001", "compliance") +
        appendLine("trg-abcd0002", "drift") +
        LF,
    );

    // The triageId travels in the BODY; the route is /:projectId/dismiss.
    const res = await h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-abcd0002", reason: "not actionable" }),
    });
    expect(res.status).toBe(200);

    // The route returns every resolved item (the client filters by status), so
    // assert the STATUS overlay landed rather than expecting a shorter list.
    const after = await h.app.request("/api/triage/proj-a");
    const body = await after.json();
    const byId = Object.fromEntries(
      (body.items as Array<{ id: string; status: string }>).map((i) => [i.id, i.status]),
    );
    // The flip landed on the intended record, and its concatenated sibling
    // survived recovery untouched.
    expect(byId).toEqual({
      "trg-abcd0001": "triage",
      "trg-abcd0002": "dismissed",
    });
  });
});
