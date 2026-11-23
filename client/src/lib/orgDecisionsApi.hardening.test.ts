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
