/*
 * triage.outbox-union.test.ts — F0.5 surface=api end-to-end gate for
 * iterate-2026-06-08-triage-outbox-union-reader.
 *
 * Drives the REAL production Hono triage route (`createTriageRoutes`) with a
 * real `SdkSessionsStore` and the production `.weblock` lock against a temp
 * project that carries a per-tree, gitignored `triage.outbox.jsonl` buffer
 * (what an idle-main background producer writes via the D1 reroute).
 *
 * The regression this gate pins: before the union reader, the live Inbox
 * (which reads `GET /api/triage/:projectId`) missed every background finding
 * in the outbox until a sweep+merge round-trip. These tests assert the finding
 * surfaces through the real HTTP consumer, is counted, and can be dismissed
 * (the status flip residence-routes to the outbox — no tracked main drift).
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Shared harness — see `_triage-api-harness.ts`. Extracted so this gate and the
// record-boundary recovery gate (`triage.recovery-api.test.ts`) share one
// wiring instead of duplicating it.
import { type Harness, makeHarness, appendLine } from "./_triage-api-harness.js";

const POST = { method: "POST", headers: { "content-type": "application/json" } };

describe("triage routes — outbox union (F0.5 surface=api)", () => {
  const harnesses: Harness[] = [];
  afterEach(() => {
    for (const h of harnesses.splice(0)) h.cleanup();
  });

  it("GET /:projectId surfaces an outbox-only background finding alongside tracked items", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    writeFileSync(
      h.triagePath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-tracked1", "compliance")}\n`,
    );
    // Background idle-main producer wrote ONLY to the gitignored outbox.
    writeFileSync(h.outboxPath, appendLine("trg-outbox1") + "\n");

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.items as Array<{ id: string }>).map((i) => i.id).sort();
    expect(ids).toEqual(["trg-outbox1", "trg-tracked1"]);
  });

  it("GET /:projectId surfaces outbox findings even when NO tracked triage.jsonl exists", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // No tracked file at all — only the outbox buffer.
    writeFileSync(h.outboxPath, appendLine("trg-outboxonly") + "\n");
    expect(existsSync(h.triagePath)).toBe(false);

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.items as Array<{ id: string }>).map((i) => i.id)).toEqual(["trg-outboxonly"]);
  });

  it("GET /counts includes outbox findings in the per-project triage count", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    writeFileSync(
      h.triagePath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-tracked2")}\n`,
    );
    writeFileSync(h.outboxPath, appendLine("trg-outbox2") + "\n");

    const res = await h.app.request("/api/triage/counts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts["proj-a"]).toBe(2);
    expect(body.total).toBe(2);
  });

  it("POST /:projectId/dismiss on an outbox finding → 200; the flip residence-routes to the outbox (no tracked drift) and the item reads back dismissed", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    // Tracked store exists (header only) so the route's existence-guard + lock
    // target are satisfied; the finding itself lives only in the outbox.
    writeFileSync(h.triagePath, `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n`);
    // Route body validator requires /^trg-[0-9a-fA-F]{8}$/ for the flip id.
    writeFileSync(h.outboxPath, appendLine("trg-0a0b0c0d") + "\n");

    const dismiss = await h.app.request("/api/triage/proj-a/dismiss", {
      ...POST,
      body: JSON.stringify({ triageId: "trg-0a0b0c0d", reason: "handled" }),
    });
    expect(dismiss.status).toBe(200);

    // Residence: the status flip landed in the OUTBOX, NOT the tracked store
    // (the tracked file still has only its header line → no main drift).
    const trackedLines = readFileSync(h.triagePath, "utf-8").split("\n").filter(Boolean);
    expect(trackedLines).toHaveLength(1);
    const outboxRaw = readFileSync(h.outboxPath, "utf-8");
    expect(outboxRaw).toContain('"event":"status"');
    expect(outboxRaw).toContain('"newStatus":"dismissed"');

    // End-to-end: the item now reads back dismissed through the real route.
    const res = await h.app.request("/api/triage/proj-a");
    const body = await res.json();
    const item = (body.items as Array<{ id: string; status: string }>).find(
      (i) => i.id === "trg-0a0b0c0d",
    );
    expect(item?.status).toBe("dismissed");
  });

  it("GET /:projectId annotates every item with a concrete pendingDelivery boolean (TRACKED-PREFERRED)", async () => {
    // iterate-2026-06-10-triage-pending-delivery-badge AC1: mirror of the
    // monorepo `triage_cli.py list --json` contract through the real route.
    const h = await makeHarness();
    harnesses.push(h);
    writeFileSync(
      h.triagePath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-trackonly")}\n${appendLine("trg-bothfile")}\n`,
    );
    writeFileSync(
      h.outboxPath,
      appendLine("trg-bothfile") + "\n" + appendLine("trg-outpend1") + "\n",
    );

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    const items = body.items as Array<{ id: string; pendingDelivery?: boolean }>;
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("trg-trackonly")?.pendingDelivery).toBe(false);
    // In BOTH files (post-sweep, pre-GC) → NOT pending (tracked wins).
    expect(byId.get("trg-bothfile")?.pendingDelivery).toBe(false);
    expect(byId.get("trg-outpend1")?.pendingDelivery).toBe(true);
    for (const it of items) expect(typeof it.pendingDelivery).toBe("boolean");
  });

  it("GET /:projectId marks an outbox finding pendingDelivery even with NO tracked file (no 500)", async () => {
    const h = await makeHarness();
    harnesses.push(h);
    writeFileSync(h.outboxPath, appendLine("trg-freshout") + "\n");
    expect(existsSync(h.triagePath)).toBe(false);

    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    const items = body.items as Array<{ id: string; pendingDelivery?: boolean }>;
    expect(items[0].pendingDelivery).toBe(true);
  });

  it("AC6 — the repo .gitignore carries the canonical outbox-ignore line (D3 propagation)", () => {
    // The per-tree outbox is a transient buffer that must never be committed.
    // setup_iterate_worktree's self-heal lands the canonical line; pin it so a
    // future gitignore rewrite can't silently start tracking the buffer.
    const repoRoot = path.resolve(__dirname, "../../../");
    const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf-8");
    expect(gitignore).toContain("/.shipwright/triage.outbox.jsonl");
  });
});
