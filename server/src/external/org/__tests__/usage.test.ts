import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerUsageRoute } from "../usage.js";

describe("GET /api/external/org/leads/:leadId/usage", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-usage-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function app(): Hono {
    const a = new Hono();
    registerUsageRoute(a, { leadsRoot });
    return a;
  }

  it("returns measured:false when the lead directory doesn't exist yet (steady state, not an error)", async () => {
    const res = await app().request("/api/external/org/leads/acme-lead/usage");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: "acme-lead", measured: false });
  });

  it("returns measured:false when the lead directory exists but usage.json doesn't", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const res = await app().request("/api/external/org/leads/acme-lead/usage");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: "acme-lead", measured: false });
  });

  it("returns the measured shape for a well-formed usage.json", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "usage.json"),
      JSON.stringify({ costUsd: 12.5, runCount: 4, windowDays: 7, asOf: "2026-08-17T09:00:00.000Z" }),
      "utf8",
    );
    const res = await app().request("/api/external/org/leads/acme-lead/usage");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      leadId: "acme-lead",
      measured: true,
      costUsd: 12.5,
      runCount: 4,
      windowDays: 7,
      asOf: "2026-08-17T09:00:00.000Z",
    });
  });

  it("502s on malformed JSON — never a half structure", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(path.join(leadsRoot, "acme-lead", "usage.json"), "{not json", "utf8");
    const res = await app().request("/api/external/org/leads/acme-lead/usage");
    expect(res.status).toBe(502);
  });

  it("502s on a negative costUsd", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "usage.json"),
      JSON.stringify({ costUsd: -1, runCount: 0, windowDays: 7, asOf: "x" }),
      "utf8",
    );
    const res = await app().request("/api/external/org/leads/acme-lead/usage");
    expect(res.status).toBe(502);
  });

  it("rejects an invalid leadId (traversal shape) with 400 before touching the filesystem", async () => {
    const res = await app().request(
      "/api/external/org/leads/" + encodeURIComponent("..%2F..%2Fetc") + "/usage",
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_lead_id");
  });

  it("rejects an uppercase / underscore leadId (not kebab-case)", async () => {
    const res = await app().request("/api/external/org/leads/ACME_LEAD/usage");
    expect(res.status).toBe(400);
  });

  it(
    "code-review fix: rejects a symlinked usage.json (mocked lstat) 403, never reading it — " +
      "previously untested because lstatSync wasn't injectable",
    async () => {
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      const a = new Hono();
      registerUsageRoute(a, {
        leadsRoot,
        lstatSync: (p) =>
          path.basename(p) === "usage.json"
            ? { isSymbolicLink: () => true }
            : lstatSync(p),
      });

      const res = await a.request("/api/external/org/leads/acme-lead/usage");
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("symlink_forbidden");
    },
  );
});
