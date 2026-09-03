/*
 * org-threads.test.ts — GET /api/org/threads (FR-04.42, leadwright#35).
 * Split out of `org.test.ts` to stay under the 300-line file guideline —
 * same fixture pattern (`org-chart.json` in a temp `leadsRoot`), see
 * `org-docs.test.ts` for the precedent.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgApiRouter } from "../org.js";

const CHART = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme-lead",
      name: "Acme Lead",
      reports_to: null,
      manages: [],
      charter_path: "acme-lead/charter.md",
    },
  },
};

describe("GET /api/org/threads", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-threads-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function writeChart() {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
  }

  function writeThreads(leadId: string, body: unknown) {
    mkdirSync(path.join(leadsRoot, leadId), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, leadId, "lead-question-threads.json"),
      JSON.stringify(body),
      "utf8",
    );
  }

  it("forwards the org-chart error when the chart itself is missing", async () => {
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/threads");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_chart_missing");
  });

  it("returns an empty array for a lead with no thread file — the steady state, not an error (AC-d)", async () => {
    writeChart();
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/threads");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "acme-lead": [] });
  });

  it("strips the lead-question marker, preserves round order, and looks up the card title (AC-a/c)", async () => {
    // AC-a: "at least three rounds" — the quantifier exists to guard against
    // an off-by-one/truncation bug (e.g. an accidental .slice(0, 2), or a
    // reduce that drops the last element) that a 1-2 round fixture could
    // pass by coincidence. This is the one test in the suite that reads a
    // REAL on-disk lead-question-threads.json through the actual
    // read -> parse -> composite pipeline (not a mocked hook) — the page's
    // own round-order rendering, fed the identical wire shape asserted
    // below, is proven separately by
    // client/src/pages/OrgPage.thread.test.tsx's "renders the lead's
    // thread ... in round order (AC-a)" test.
    writeChart();
    writeThreads("acme-lead", {
      version: 1,
      threads: {
        "task-1": {
          taskId: "task-1",
          dedupKey: "dedup-1",
          rounds: [
            {
              round: 1,
              questionType: "clarify",
              question: "<!-- lead-question:clarify -->\nFirst question?",
              askedAt: "2026-08-30T00:00:00Z",
              answer: { text: "First answer", answeredAt: "2026-08-30T01:00:00Z" },
            },
            {
              round: 2,
              questionType: "clarify",
              question: "<!-- lead-question:clarify -->\nSecond question?",
              askedAt: "2026-08-31T00:00:00Z",
              answer: { text: "Second answer", answeredAt: "2026-08-31T01:00:00Z" },
            },
            {
              round: 3,
              questionType: "clarify",
              question: "<!-- lead-question:clarify -->\nThird question?",
              askedAt: "2026-09-01T00:00:00Z",
            },
          ],
        },
      },
    });
    const store = { get: (taskId: string) => (taskId === "task-1" ? { title: "Follow-up card" } : undefined) };
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1", store });
    const res = await app.request("/api/org/threads");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["acme-lead"]).toHaveLength(1);
    const card = body["acme-lead"][0];
    expect(card.cardId).toBe("task-1");
    expect(card.cardTitle).toBe("Follow-up card");
    expect(card.rounds.map((r: { question: string }) => r.question)).toEqual([
      "First question?",
      "Second question?",
      "Third question?",
    ]);
    expect(card.rounds[0].answer).toBe("First answer");
    expect(card.rounds[1].answer).toBe("Second answer");
    expect(card.rounds[2].answer).toBeUndefined();
  });

  it("falls back to the raw taskId when no store dependency is wired (or no matching task)", async () => {
    writeChart();
    writeThreads("acme-lead", {
      version: 1,
      threads: {
        "task-orphan": {
          taskId: "task-orphan",
          dedupKey: "dedup-1",
          rounds: [
            { round: 1, questionType: "clarify", question: "Q?", askedAt: "2026-08-30T00:00:00Z" },
          ],
        },
      },
    });
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/threads");
    const body = await res.json();
    expect(body["acme-lead"][0].cardTitle).toBe("task-orphan");
  });

  it("skips a thread record whose rounds array is empty", async () => {
    writeChart();
    writeThreads("acme-lead", {
      version: 1,
      threads: {
        "task-empty": { taskId: "task-empty", dedupKey: "dedup-1", rounds: [] },
      },
    });
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/threads");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "acme-lead": [] });
  });

  it("degrades an unknown version to an empty array instead of erroring (trap 7)", async () => {
    writeChart();
    writeThreads("acme-lead", { version: 2, threads: {} });
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/threads");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "acme-lead": [] });
  });

  it("degrades invalid JSON to an empty array instead of erroring (trap 6)", async () => {
    writeChart();
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(path.join(leadsRoot, "acme-lead", "lead-question-threads.json"), "{not json", "utf8");
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/threads");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "acme-lead": [] });
  });
});
