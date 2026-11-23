import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerOrgWriteActions } from "../../../routes/org-writes.js";
import { errorHandler } from "../../../middleware/error-handler.js";

const TS = "2026-11-20T09:15:00.000Z";
const LEAD = "acme-lead";
const N = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const ENTRY =
  `<!-- decisionKey: use-weekly-digest -->
## Proposed ${TS} — use-weekly-digest

⟦SHIPWRIGHT-FENCE:${N}⟧
` +
  `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]
Some text.
` +
  `⟦SHIPWRIGHT-FENCE:${N}⟧

- **Lead:** ${LEAD}
- **Evidence:** session 7c1e at 2026-11-19T16:02:11Z, message 14
`;

describe("reject hardening (W3 fix round)", () => {
  let root: string;
  let outside: string;
  let proposed: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-reject-h-"));
    outside = mkdtempSync(path.join(tmpdir(), "org-reject-out-"));
    proposed = path.join(root, "decisions-proposed.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
    writeFileSync(proposed, ENTRY);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const reject = (a: Hono) =>
    a.request("/api/org/decisions/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: TS, leadId: LEAD }),
    });
  const mk = (deps: Parameters<typeof registerOrgWriteActions>[1] = { leadsRoot: root }) => {
    const a = new Hono();
    a.onError(errorHandler);
    registerOrgWriteActions(a, deps);
    return a;
  };

  // @covers FR-01.71
  it("lock contention (ELOCKED) on reject is a retryable 409, nothing changes", async () => {
    const a = mk({
      leadsRoot: root,
      withDecisionsLock: async () => {
        throw Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED" });
      },
    });
    const res = await reject(a);
    expect(res.status).toBe(409);
    expect(readFileSync(proposed, "utf8")).toContain("use-weekly-digest");
    expect(existsSync(audit)).toBe(false);
  });

  // @covers FR-01.71
  it("a symlinked audit.jsonl is refused with 403 and the entry stays", async () => {
    const target = path.join(outside, "elsewhere.jsonl");
    writeFileSync(target, "");
    try {
      symlinkSync(target, audit);
    } catch {
      return; // symlinks not permitted on this machine
    }
    const res = await reject(mk());
    expect(res.status).toBe(403);
    expect(readFileSync(proposed, "utf8")).toContain("use-weekly-digest");
    expect(readFileSync(target, "utf8")).toBe("");
  });

  // @covers FR-01.71
  it("a symlinked lead folder is refused and creates no audit file outside the leads root", async () => {
    rmSync(path.join(root, LEAD), { recursive: true, force: true });
    try {
      symlinkSync(outside, path.join(root, LEAD), "junction");
    } catch {
      return;
    }
    const res = await reject(mk());
    expect(res.status).toBe(403);
    expect(existsSync(path.join(outside, "audit.jsonl"))).toBe(false);
    expect(readFileSync(proposed, "utf8")).toContain("use-weekly-digest");
  });

  // @covers FR-01.71
  it("a torn last audit line does not swallow the new record", async () => {
    writeFileSync(audit, '{"kind":"other","ts":"2026-11-01T00:00:00.000Z"'); // crashed writer: no closing, no newline
    const res = await reject(mk());
    expect(res.status).toBe(200);
    const lines = readFileSync(audit, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0])).toThrow(); // the torn line stays torn, on its own line
    expect(JSON.parse(lines[1]).kind).toBe("decision_rejected");
  });
});
