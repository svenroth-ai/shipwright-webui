import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerBeatRegisterHealthRoute, evaluateRegisterHealth } from "../beat-register.js";

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    beatId: "beat-1",
    leadId: "acme-lead",
    pid: 1234,
    startedAt: "2026-08-18T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

describe("evaluateRegisterHealth", () => {
  it("reports clear for an empty entries array", () => {
    expect(evaluateRegisterHealth({ version: 1, entries: [] })).toEqual({ status: "clear" });
  });

  it("reports open for a single open entry", () => {
    const e = entry();
    expect(evaluateRegisterHealth({ version: 1, entries: [e] })).toEqual({
      status: "open",
      entry: e,
    });
  });

  it("reports clear when the only entry is closed", () => {
    const e = entry({ closedAt: "2026-08-18T01:00:00.000Z" });
    expect(evaluateRegisterHealth({ version: 1, entries: [e] })).toEqual({ status: "clear" });
  });

  it("reports fault (duplicate-session-id) — fault wins even if one entry is also open-shaped", () => {
    const a = entry({ closedAt: "2026-08-18T01:00:00.000Z" });
    const b = entry(); // same sessionId, still open
    const health = evaluateRegisterHealth({ version: 1, entries: [a, b] });
    expect(health.status).toBe("fault");
    if (health.status === "fault") {
      expect(health.reason).toBe("duplicate-session-id");
      expect(health.sessionId).toBe(a.sessionId);
      expect(health.entries).toEqual([a, b]);
    }
  });
});

describe("GET /api/external/org/leads/:leadId/beat-register", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-beat-register-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function writeRegister(entries: unknown[]): void {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beat-register.json"),
      JSON.stringify({ version: 1, entries }),
      "utf8",
    );
  }

  function app(): Hono {
    const a = new Hono();
    registerBeatRegisterHealthRoute(a, { leadsRoot });
    return a;
  }

  it("returns clear when beat-register.json doesn't exist", async () => {
    const res = await app().request("/api/external/org/leads/acme-lead/beat-register");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: "acme-lead", status: "clear" });
  });

  it("returns clear for an empty entries array", async () => {
    writeRegister([]);
    const res = await app().request("/api/external/org/leads/acme-lead/beat-register");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: "acme-lead", status: "clear" });
  });

  it("returns open for an open entry", async () => {
    writeRegister([entry()]);
    const res = await app().request("/api/external/org/leads/acme-lead/beat-register");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: "acme-lead", status: "open", entry: entry() });
  });

  it("returns fault for a duplicate sessionId", async () => {
    const a = entry({ closedAt: "2026-08-18T01:00:00.000Z" });
    const b = entry();
    writeRegister([a, b]);
    const res = await app().request("/api/external/org/leads/acme-lead/beat-register");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      leadId: "acme-lead",
      status: "fault",
      reason: "duplicate-session-id",
      sessionId: a.sessionId,
      entries: [a, b],
    });
  });

  it("502s on malformed JSON", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(path.join(leadsRoot, "acme-lead", "beat-register.json"), "{not json", "utf8");
    const res = await app().request("/api/external/org/leads/acme-lead/beat-register");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("beat_register_invalid");
  });

  it("502s on an unsupported version", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beat-register.json"),
      JSON.stringify({ version: 2, entries: [] }),
      "utf8",
    );
    const res = await app().request("/api/external/org/leads/acme-lead/beat-register");
    expect(res.status).toBe(502);
  });

  it("rejects an invalid leadId with 400 before touching the filesystem", async () => {
    const res = await app().request(
      "/api/external/org/leads/" + encodeURIComponent("..%2F..%2Fetc") + "/beat-register",
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_lead_id");
  });

  it("rejects a symlinked beat-register.json (mocked lstat) 403, never reading it", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const a = new Hono();
    registerBeatRegisterHealthRoute(a, {
      leadsRoot,
      lstatSync: (p) =>
        path.basename(p) === "beat-register.json" ? { isSymbolicLink: () => true } : lstatSync(p),
    });
    const res = await a.request("/api/external/org/leads/acme-lead/beat-register");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("symlink_forbidden");
  });
});
