import { describe, it, expect, vi, afterEach } from "vitest";

import { countersignDecision } from "./orgDecisionsApi";
import { rejectDecision } from "./orgRejectApi";

const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

describe("decision requests - hardening", () => {
  // @covers FR-01.71
  it("countersign sends the fingerprint with the line and maps entry_changed / audit_unwritable", async () => {
    const f = reply(409, { error: "entry_changed" });
    vi.stubGlobal("fetch", f);
    expect(await countersignDecision("t", "l", "line", "ab".repeat(16))).toEqual({ ok: false, reason: "entry-changed" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ timestamp: "t", leadId: "l", line: "line", fingerprint: "ab".repeat(16) });
    vi.stubGlobal("fetch", reply(409, { error: "audit_unwritable", message: "fix it" }));
    expect(await countersignDecision("t", "l")).toEqual({ ok: false, reason: "audit-unwritable", message: "fix it" });
    vi.stubGlobal("fetch", reply(409, { error: "audit_unwritable", message: "fix it", logged: true, adr: "ADR-0002" }));
    expect(await countersignDecision("t", "l")).toEqual({ ok: false, reason: "audit-unwritable", message: "fix it", adr: "ADR-0002" });
  });

  // @covers FR-01.71
  it("maps the closeout answers: audit-pending reject, kept reason, logged earlier version", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "countersign_audit_pending", number: 4, message: "fix the file" }));
    expect(await rejectDecision("t", "l", "")).toEqual({ ok: false, reason: "audit-pending", adr: 4, message: "fix the file" });
    vi.stubGlobal("fetch", reply(200, { rejected: true, alreadyRejected: false, recorded: false, reasonKept: true, existingReason: "old" }));
    expect(await rejectDecision("t", "l", "new")).toEqual({ ok: true, alreadyRejected: false, recorded: false, existingReason: "old" });
    vi.stubGlobal("fetch", reply(200, { rejected: true, alreadyRejected: false, recorded: false, reasonKept: true, existingReason: null }));
    expect(await rejectDecision("t", "l", "new")).toMatchObject({ existingReason: null });
    vi.stubGlobal("fetch", reply(200, { rejected: true, alreadyRejected: false, recorded: true }));
    expect(await rejectDecision("t", "l", "new")).not.toHaveProperty("existingReason");
    vi.stubGlobal("fetch", reply(409, { error: "duplicate_proposal_identity", count: 2, loggedAdr: "ADR-0004" }));
    expect(await countersignDecision("t", "l")).toEqual({ ok: false, reason: "duplicate", count: 2, loggedAdr: "ADR-0004" });
  });

  // @covers FR-01.71
  it("reject sends the fingerprint, maps the same two refusals and reports whether a record was written", async () => {
    const f = reply(200, { rejected: true, alreadyRejected: false, recorded: false });
    vi.stubGlobal("fetch", f);
    expect(await rejectDecision("t", "l", "why", "cd".repeat(16))).toEqual({ ok: true, alreadyRejected: false, recorded: false });
    expect(JSON.parse(f.mock.calls[0][1].body).fingerprint).toBe("cd".repeat(16));
    vi.stubGlobal("fetch", reply(409, { error: "entry_changed" }));
    expect(await rejectDecision("t", "l", "")).toEqual({ ok: false, reason: "entry-changed" });
    vi.stubGlobal("fetch", reply(409, { error: "audit_unwritable", message: "fix it" }));
    expect(await rejectDecision("t", "l", "")).toEqual({ ok: false, reason: "audit-unwritable", message: "fix it" });
  });
});
