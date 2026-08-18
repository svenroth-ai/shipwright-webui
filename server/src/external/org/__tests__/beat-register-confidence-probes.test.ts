/*
 * Confidence Calibration probes (iterate-2026-08-18-org-route-beat-register,
 * Step 7.5) — deliberately adversarial tests beyond the per-route unit
 * suites, aimed at the producer/consumer + concurrency boundaries the
 * release action touches. See the iterate spec's `## Confidence
 * Calibration` section for the round-by-round findings these produced.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerBeatRegisterReleaseRoute } from "../beat-register-release.js";
import { registerBeatRegisterHealthRoute } from "../beat-register.js";
import { readLeadOrgInfo } from "../org-chart-lookup.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sessionId: SESSION_ID,
    beatId: "beat-1",
    leadId: "acme-lead",
    pid: 1234,
    startedAt: "2026-08-18T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

const FAST_LOCK_OPTIONS = {
  stale: 300_000,
  update: 1_000,
  retries: { retries: 5, minTimeout: 20, maxTimeout: 50, factor: 1.5 },
  realpath: true as const,
};

describe("Confidence probe: producer/consumer round-trip (release -> health)", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-confidence-probe-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function registerPath(): string {
    return path.join(leadsRoot, "acme-lead", "beat-register.json");
  }

  it("Round 1: GET /beat-register reflects a release written by POST /release (same file, two route modules)", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(registerPath(), JSON.stringify({ version: 1, entries: [entry()] }), "utf8");

    const app = new Hono();
    registerBeatRegisterReleaseRoute(app, { leadsRoot, lockOptions: FAST_LOCK_OPTIONS });
    registerBeatRegisterHealthRoute(app, { leadsRoot });

    const before = await app.request("/api/external/org/leads/acme-lead/beat-register");
    expect((await before.json()).status).toBe("open");

    const release = await app.request(
      "/api/external/org/leads/acme-lead/beat-register/release",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID, reason: "probe" }),
      },
    );
    expect(release.status).toBe(200);

    const after = await app.request("/api/external/org/leads/acme-lead/beat-register");
    expect((await after.json()).status).toBe("clear");
    // Finding: none — the two route modules share the same on-disk file and
    // no in-memory cache, so the consumer sees the producer's write
    // immediately. No bug.
  });

  it("Round 2: two genuinely concurrent release calls (Promise.all, real proper-lockfile serialization) — exactly one recovers, exactly one audit line", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(registerPath(), JSON.stringify({ version: 1, entries: [entry()] }), "utf8");

    const app = new Hono();
    registerBeatRegisterReleaseRoute(app, { leadsRoot, lockOptions: FAST_LOCK_OPTIONS });

    function post() {
      return app.request("/api/external/org/leads/acme-lead/beat-register/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID, reason: "concurrent probe" }),
      });
    }

    const [r1, r2] = await Promise.all([post(), post()]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    const recoveredCount = [b1, b2].filter((b) => b.recovered === true).length;
    expect(recoveredCount).toBe(1);

    const auditPath = path.join(leadsRoot, "acme-lead", "audit.jsonl");
    const lines = readFileSync(auditPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    // Finding: none — proper-lockfile's retry+stale contract serializes the
    // two racing requests onto the same JS event loop; the second finds the
    // entry already closed and takes the no-op branch. No bug.
  });

  it("Round 3: a release reason containing embedded newlines + unicode stays on ONE audit.jsonl line and round-trips exactly", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(registerPath(), JSON.stringify({ version: 1, entries: [entry()] }), "utf8");

    const app = new Hono();
    registerBeatRegisterReleaseRoute(app, { leadsRoot, lockOptions: FAST_LOCK_OPTIONS });

    const tricky = "hung beat\nline two — ümläut — \"quoted\"";
    const res = await app.request("/api/external/org/leads/acme-lead/beat-register/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, reason: tricky }),
    });
    expect(res.status).toBe(200);

    const auditPath = path.join(leadsRoot, "acme-lead", "audit.jsonl");
    const lines = readFileSync(auditPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.data.reason).toBe(tricky);
    // Finding: none — JSON.stringify escapes embedded newlines as `\n`
    // within the string, so the JSONL invariant (one entry per physical
    // line) holds even for a reason containing raw newlines. No bug.
    // Asymptote reached: this is the second probe in a row (after Round 2)
    // to find nothing, following Round 1 (also nothing) — probing this
    // boundary stops here per the asymptote heuristic.
  });

  it("Round 4 (boundary-probes.md category, machine-only format): a UTF-8 BOM-prefixed org-chart.json is reported org_chart_invalid, never mis-parsed", () => {
    const bomPrefixed = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(
        JSON.stringify({ leads: { "acme-lead": { triggers: { cron: "0 9 * * *" }, reports_to: null } } }),
      ),
    ]);
    writeFileSync(path.join(leadsRoot, "org-chart.json"), bomPrefixed);
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: false, reason: "org_chart_invalid" });
    // Finding: `JSON.parse` does not strip a leading BOM and throws, which
    // this reader already maps to `org_chart_invalid` — the SAME "malformed
    // -> explicit error, never a half structure" contract every other
    // parse failure gets, not silent corruption. Judged not-a-bug and
    // disclosed rather than fixed: org-chart.json is machine-written by
    // leadwright's own Node `JSON.stringify` (never emits a BOM), so this
    // is a defense-in-depth check on an input class that cannot occur from
    // the real producer, not a live risk.
  });
});
