import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgApiRouter } from "../org.js";
import { createOrgRouter } from "../../external/org/routes.js";

/*
 * POST /api/org/decisions/countersign — the plain-surface mirror of the
 * secret-gated countersign route (iterate-2026-09-06-decisions-proposed-
 * countersign). Shares `handleCountersignRequest` with the gated route
 * (`countersign.ts`) — this file is deliberately thin for the ordinary
 * cases (the action itself is already covered end-to-end by
 * `external/org/__tests__/countersign.test.ts`), plus ONE test (task
 * requirement (b)) that drives BOTH mounts on the SAME `leadsRoot` to prove
 * they share one implementation, not two that happen to agree today.
 */
describe("POST /api/org/decisions/countersign — plain-surface proxy", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-api-countersign-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function post(app: ReturnType<typeof createOrgApiRouter>, body: unknown) {
    return app.request("/api/org/decisions/countersign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("404s when no matching proposal exists — deliberately no lstatSync/withDecisionsLock deps supplied (production-call defaulting)", async () => {
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("proposal_not_found");
  });

  it("moves exactly one entry to decision_log.md, same success shape as the gated route", async () => {
    writeFileSync(
      path.join(leadsRoot, "decisions-proposed.md"),
      "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n- **Decision:** b\n",
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      countersigned: true,
      alreadyCountersigned: false,
      number: 1,
      adr: "ADR-0001",
    });
    const logged = readFileSync(path.join(leadsRoot, "decision_log.md"), "utf8");
    expect(logged).toContain("## ADR-0001 [2026-08-17T09:00:00.000Z] acme-lead");
  });

  it("rejects a malformed timestamp/leadId 400 before touching the filesystem", async () => {
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, { timestamp: "not-a-timestamp", leadId: "acme-lead" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("timestamp_invalid");
  });

  it(
    "duplicate identity 409s here exactly as it does on the gated route " +
      "(same core, same conflict — never silently discards the second match)",
    async () => {
      writeFileSync(
        path.join(leadsRoot, "decisions-proposed.md"),
        "## [2026-08-17T09:00:00.000Z] acme-lead\nfirst\n" +
          "## [2026-08-17T09:00:00.000Z] acme-lead\nsecond\n",
        "utf8",
      );
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await post(app, { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("duplicate_proposal_identity");
    },
  );

  // Task requirement (b): "The countersign action has ONE implementation,
  // shared by the gated and plain routes, proven by a test that drives
  // both." Mounting both routers on one app (mirrors AC-9's "no route-mount
  // collision" test in org-charter-write.test.ts) and countersigning via
  // the PLAIN route, then retrying the SAME identity through the GATED
  // route, proves they read/write the identical `decision_log.md` /
  // `decisions-proposed.md` state through the identical core — two call
  // sites, not two implementations that happen to agree today.
  it("countersigning via the plain route is visible as already-countersigned via the gated route (one shared core, one shared state)", async () => {
    writeFileSync(
      path.join(leadsRoot, "decisions-proposed.md"),
      "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n- **Decision:** b\n",
      "utf8",
    );

    const app = new Hono();
    app.route(
      "/",
      createOrgRouter({ leadsRoot, honoHost: "127.0.0.1", leadsRouteSecret: "s3cr3t" }),
    );
    app.route("/", createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" }));

    const plainRes = await app.request("/api/org/decisions/countersign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" }),
    });
    expect(plainRes.status).toBe(200);
    const plainBody = await plainRes.json();
    expect(plainBody).toMatchObject({ countersigned: true, alreadyCountersigned: false, number: 1 });

    const gatedRetry = await app.request("/api/external/org/decisions/countersign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-shipwright-leads-secret": "s3cr3t" },
      body: JSON.stringify({ timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" }),
    });
    expect(gatedRetry.status).toBe(200);
    const gatedBody = await gatedRetry.json();
    // Same number, and now flagged already-countersigned — the gated
    // route's idempotent-retry path found the plain route's own write.
    expect(gatedBody).toMatchObject({ countersigned: true, alreadyCountersigned: true, number: 1 });

    // Exactly one ADR-0001 block exists — the plain route's write never got
    // silently re-applied by the gated retry.
    const logged = readFileSync(path.join(leadsRoot, "decision_log.md"), "utf8");
    expect(logged.split("ADR-0001").length - 1).toBe(1);
  });
});
