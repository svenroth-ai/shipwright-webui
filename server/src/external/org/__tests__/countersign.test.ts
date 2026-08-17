import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, lstatSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerCountersignRoute } from "../countersign.js";
import { errorHandler } from "../../../middleware/error-handler.js";

describe("POST /api/external/org/decisions/countersign", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-countersign-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function app(): Hono {
    const a = new Hono();
    registerCountersignRoute(a, { leadsRoot });
    return a;
  }

  const post = (a: Hono, body: unknown) =>
    a.request("/api/external/org/decisions/countersign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("requires timestamp and leadId", async () => {
    const a = app();
    expect((await post(a, {})).status).toBe(400);
    expect((await post(a, { timestamp: "T1" })).status).toBe(400);
    expect((await post(a, { leadId: "acme-lead" })).status).toBe(400);
  });

  it("404s when no matching proposal exists (empty decisions-proposed.md, not even created)", async () => {
    const res = await post(app(), {
      timestamp: "2026-08-17T09:00:00.000Z",
      leadId: "acme-lead",
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("proposal_not_found");
  });

  it(
    "external-review fix (MEDIUM, spec): rejects a non-ISO-8601 timestamp / " +
      "non-kebab-case leadId with 400 BEFORE ever touching the lock or the " +
      "filesystem, instead of silently 404ing as proposal_not_found",
    async () => {
      const a = app();
      const badTs = await post(a, { timestamp: "not-a-timestamp", leadId: "acme-lead" });
      expect(badTs.status).toBe(400);
      expect((await badTs.json()).error).toBe("timestamp_invalid");

      const badLead = await post(a, {
        timestamp: "2026-08-17T09:00:00.000Z",
        leadId: "Not_Kebab",
      });
      expect(badLead.status).toBe(400);
      expect((await badLead.json()).error).toBe("leadId_invalid");
    },
  );

  it("moves exactly one entry: decision_log grows, decisions-proposed shrinks by the same entry", async () => {
    writeFileSync(
      path.join(leadsRoot, "decisions-proposed.md"),
      "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n- **Decision:** b\n" +
        "## [2026-08-17T09:05:00.000Z] other-lead\n- **Context:** c\n",
      "utf8",
    );

    const res = await post(app(), { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ countersigned: true, alreadyCountersigned: false, number: 1, adr: "ADR-0001" });

    const logged = readFileSync(path.join(leadsRoot, "decision_log.md"), "utf8");
    expect(logged).toContain("## ADR-0001 [2026-08-17T09:00:00.000Z] acme-lead");
    expect(logged).toContain("Context:** a");

    const proposed = readFileSync(path.join(leadsRoot, "decisions-proposed.md"), "utf8");
    expect(proposed).not.toContain("acme-lead");
    expect(proposed).toContain("other-lead");
  });

  it("numbering continues from the existing max in decision_log.md", async () => {
    writeFileSync(
      path.join(leadsRoot, "decision_log.md"),
      "## ADR-0004 [2026-08-16T00:00:00.000Z] someone\nold entry\n",
      "utf8",
    );
    writeFileSync(
      path.join(leadsRoot, "decisions-proposed.md"),
      "## [2026-08-17T09:00:00.000Z] acme-lead\nnew proposal\n",
      "utf8",
    );

    const res = await post(app(), { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect((await res.json()).number).toBe(5);
  });

  it("disambiguates by (timestamp, leadId) — same timestamp, different lead", async () => {
    writeFileSync(
      path.join(leadsRoot, "decisions-proposed.md"),
      "## [2026-08-17T09:00:00.000Z] acme-lead\nentryA\n" +
        "## [2026-08-17T09:00:00.000Z] other-lead\nentryB\n",
      "utf8",
    );
    const a = app();
    const res1 = await post(a, { timestamp: "2026-08-17T09:00:00.000Z", leadId: "other-lead" });
    expect(res1.status).toBe(200);
    const logged = readFileSync(path.join(leadsRoot, "decision_log.md"), "utf8");
    expect(logged).toContain("entryB");
    expect(logged).not.toContain("entryA");
    const proposed = readFileSync(path.join(leadsRoot, "decisions-proposed.md"), "utf8");
    expect(proposed).toContain("entryA");
    expect(proposed).not.toContain("entryB");
  });

  it("is idempotent on retry: a second call with the same (timestamp, leadId) reuses the number and never double-logs", async () => {
    writeFileSync(
      path.join(leadsRoot, "decisions-proposed.md"),
      "## [2026-08-17T09:00:00.000Z] acme-lead\nentry\n",
      "utf8",
    );
    const a = app();
    const first = await post(a, { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect((await first.json()).number).toBe(1);

    // Simulate a client retry after the proposed-side removal already
    // happened once (the entry is gone from decisions-proposed.md — the
    // crash-recovery path is that decision_log.md is already the record).
    const second = await post(a, { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.alreadyCountersigned).toBe(true);
    expect(secondJson.number).toBe(1);

    const logged = readFileSync(path.join(leadsRoot, "decision_log.md"), "utf8");
    const occurrences = logged.split("ADR-0001").length - 1;
    expect(occurrences).toBe(1); // never double-logged
  });

  it("refuses to lock through a symlinked decisions-proposed.md (mocked lstat) — 403 symlink_forbidden", async () => {
    writeFileSync(
      path.join(leadsRoot, "decisions-proposed.md"),
      "## [2026-08-17T09:00:00.000Z] acme-lead\nbody\n",
      "utf8",
    );
    const a = new Hono();
    registerCountersignRoute(a, {
      leadsRoot,
      lstatSync: (p) =>
        path.basename(p) === "decisions-proposed.md"
          ? { isSymbolicLink: () => true }
          : lstatSync(p),
    });

    const res = await post(a, { timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("symlink_forbidden");
  });

  it(
    "external-review fix (MEDIUM, edge-case): two DISTINCT proposals sharing " +
      "the same (timestamp, leadId) — the pair is disambiguation, not a " +
      "uniqueness guarantee — 409s as duplicate_proposal_identity instead of " +
      "silently discarding the second one",
    async () => {
      writeFileSync(
        path.join(leadsRoot, "decisions-proposed.md"),
        "## [2026-08-17T09:00:00.000Z] acme-lead\nfirst distinct proposal\n" +
          "## [2026-08-17T09:00:00.000Z] acme-lead\nsecond distinct proposal\n",
        "utf8",
      );

      const res = await post(app(), {
        timestamp: "2026-08-17T09:00:00.000Z",
        leadId: "acme-lead",
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe("duplicate_proposal_identity");
      expect(json.count).toBe(2);

      // Neither the logged nor the proposed side was mutated — this is a
      // conflict that needs repair, not a partial/lossy write.
      expect(existsSync(path.join(leadsRoot, "decision_log.md"))).toBe(false);
      const proposed = readFileSync(path.join(leadsRoot, "decisions-proposed.md"), "utf8");
      expect(proposed).toContain("first distinct proposal");
      expect(proposed).toContain("second distinct proposal");
    },
  );

  it(
    "external-review fix (MEDIUM, edge-case): a residual duplicate discovered " +
      "on the IDEMPOTENT-RETRY path (already logged, still 2 in proposed) " +
      "also 409s instead of silently deleting one copy",
    async () => {
      writeFileSync(
        path.join(leadsRoot, "decision_log.md"),
        "## ADR-0001 [2026-08-17T09:00:00.000Z] acme-lead\nfirst distinct proposal\n",
        "utf8",
      );
      writeFileSync(
        path.join(leadsRoot, "decisions-proposed.md"),
        "## [2026-08-17T09:00:00.000Z] acme-lead\nfirst distinct proposal\n" +
          "## [2026-08-17T09:00:00.000Z] acme-lead\nsecond distinct proposal\n",
        "utf8",
      );

      const res = await post(app(), {
        timestamp: "2026-08-17T09:00:00.000Z",
        leadId: "acme-lead",
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("duplicate_proposal_identity");

      const proposed = readFileSync(path.join(leadsRoot, "decisions-proposed.md"), "utf8");
      expect(proposed).toContain("first distinct proposal");
      expect(proposed).toContain("second distinct proposal");
    },
  );

  it(
    "doubt-review fix: lock contention (ELOCKED) surfaces as the family-standard " +
      "retryable 409 via the app-level errorHandler (CLAUDE.md DO-NOT #6) — not a " +
      "bare 500",
    async () => {
      const a = new Hono();
      a.onError(errorHandler);
      registerCountersignRoute(a, {
        leadsRoot,
        withDecisionsLock: async () => {
          throw Object.assign(new Error("Lock file is already being held"), {
            code: "ELOCKED",
          });
        },
      });

      const res = await post(a, {
        timestamp: "2026-08-17T09:00:00.000Z",
        leadId: "acme-lead",
      });
      expect(res.status).toBe(409);
    },
  );
});
