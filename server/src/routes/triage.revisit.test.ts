/*
 * triage.revisit.test.ts — route coverage for the optional Snooze revisit
 * date (monorepo P2.03 parity, iterate-2026-08-05-triage-deferred-envelope).
 * AC7 (snooze validation), AC8 (dismiss rejects revisitAt), AC11 (counts
 * reflect an auto-reopened park). Split from triage.test.ts (already
 * baselined at 902 lines) into its own file per the plan review's bloat
 * guidance.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";

import { makeHarness, appendLine, TRIAGE_HEADER, type Harness } from "./_triage-api-harness.js";
import { resolveTriageCliScript } from "../core/triage-cli-runner.js";

const cachedCliIt = resolveTriageCliScript() ? it : it.skip;

describe("POST /api/triage/:projectId/snooze — revisitAt", () => {
  let harness: Harness;

  afterEach(() => {
    harness?.cleanup();
  });

  cachedCliIt("AC7: accepts a valid future revisitAt and carries it on the emitted event", async () => {
    harness = await makeHarness();
    writeFileSync(harness.triagePath, `${TRIAGE_HEADER}\n${appendLine("trg-aaaaaaaa")}\n`);

    const res = await harness.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaaaaaa", revisitAt: "2099-01-01" }),
    });
    expect(res.status).toBe(200);

    const list = await harness.app.request("/api/triage/proj-a");
    const body = (await list.json()) as { items: { id: string; revisitAt: string | null; status: string }[] };
    const item = body.items.find((i) => i.id === "trg-aaaaaaaa");
    expect(item?.status).toBe("snoozed");
    expect(item?.revisitAt).toBe("2099-01-01");
  });

  cachedCliIt("AC7: leaving revisitAt out behaves exactly as before — item parks with no date", async () => {
    harness = await makeHarness();
    writeFileSync(harness.triagePath, `${TRIAGE_HEADER}\n${appendLine("trg-bbbbbbbb")}\n`);

    const res = await harness.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-bbbbbbbb" }),
    });
    expect(res.status).toBe(200);

    const list = await harness.app.request("/api/triage/proj-a");
    const body = (await list.json()) as { items: { id: string; revisitAt: string | null; revisitDue: boolean }[] };
    const item = body.items.find((i) => i.id === "trg-bbbbbbbb");
    expect(item?.revisitAt).toBeNull();
    expect(item?.revisitDue).toBe(false);
  });

  it("AC7: rejects a malformed revisitAt with 400 invalid_revisitAt", async () => {
    harness = await makeHarness();
    writeFileSync(harness.triagePath, `${TRIAGE_HEADER}\n${appendLine("trg-cccccccc")}\n`);

    const res = await harness.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-cccccccc", revisitAt: "not-a-date" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_revisitAt" });
  });

  it("AC7: rejects a past-calendar-day revisitAt with 400 invalid_revisitAt (Feb 30 never exists)", async () => {
    harness = await makeHarness();
    writeFileSync(harness.triagePath, `${TRIAGE_HEADER}\n${appendLine("trg-dddddddd")}\n`);

    const res = await harness.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-dddddddd", revisitAt: "2026-02-30" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_revisitAt" });
  });

  it("AC7: rejects a non-future revisitAt (today or past) with 400 revisitAt_not_future", async () => {
    harness = await makeHarness();
    writeFileSync(harness.triagePath, `${TRIAGE_HEADER}\n${appendLine("trg-eeeeeeee")}\n`);

    const res = await harness.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-eeeeeeee", revisitAt: "2020-01-01" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "revisitAt_not_future" });
  });
});

describe("POST /api/triage/:projectId/dismiss — revisitAt (AC8)", () => {
  let harness: Harness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("rejects a revisitAt on a dismiss with 400 revisitAt_not_permitted — park semantics are snooze-only", async () => {
    harness = await makeHarness();
    writeFileSync(harness.triagePath, `${TRIAGE_HEADER}\n${appendLine("trg-ffffffff")}\n`);

    const res = await harness.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-ffffffff", revisitAt: "2099-01-01" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "revisitAt_not_permitted" });

    // The item must still be untouched (rejected before any write).
    const list = await harness.app.request("/api/triage/proj-a");
    const body = (await list.json()) as { items: { id: string; status: string }[] };
    expect(body.items.find((i) => i.id === "trg-ffffffff")?.status).toBe("triage");
  });
});

describe("GET /api/triage/counts — reflects an auto-reopened park (AC11)", () => {
  let harness: Harness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("counts an item whose park just expired — it is genuinely open again", async () => {
    harness = await makeHarness();
    writeFileSync(
      harness.triagePath,
      [
        TRIAGE_HEADER,
        appendLine("trg-11111111"),
        JSON.stringify({
          event: "status",
          id: "trg-11111111",
          ts: "2026-06-01T09:00:00Z",
          newStatus: "snoozed",
          by: "webui",
          reason: "parked",
          promotedTaskId: null,
          revisitAt: "2020-01-01", // permanently in the past — always due
        }),
      ].join("\n") + "\n",
    );

    const counts = await harness.app.request("/api/triage/counts");
    const body = (await counts.json()) as { counts: Record<string, number>; total: number };
    // The park expired, so read_all_items resolves it back to status:triage —
    // filterTriage (which /counts uses) counts it, exactly as any other open item.
    expect(body.counts["proj-a"]).toBe(1);
    expect(body.total).toBe(1);
  });

  it("deferredTotal counts a still-parked item separately from the open total (code review fix)", async () => {
    harness = await makeHarness();
    writeFileSync(
      harness.triagePath,
      [
        TRIAGE_HEADER,
        appendLine("trg-22222222"),
        JSON.stringify({
          event: "status",
          id: "trg-22222222",
          ts: "2026-06-01T09:00:00Z",
          newStatus: "snoozed",
          by: "webui",
          reason: "parked",
          promotedTaskId: null,
          revisitAt: "2099-01-01", // permanently in the future — never due
        }),
      ].join("\n") + "\n",
    );

    const counts = await harness.app.request("/api/triage/counts");
    const body = (await counts.json()) as {
      counts: Record<string, number>;
      total: number;
      deferredTotal: number;
    };
    expect(body.total).toBe(0);
    expect(body.deferredTotal).toBe(1);
  });
});
