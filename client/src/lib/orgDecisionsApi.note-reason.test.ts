import { describe, it, expect, vi, afterEach } from "vitest";

import { countersignDecision } from "./orgDecisionsApi";
import { rejectDecision } from "./orgRejectApi";
import { rejectFailureStatus } from "../components/org/decisionMessages";

const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

describe("countersign note / reject reason requests (iterate-2026-11-28-decision-reject-reason)", () => {
  // @covers FR-01.71
  it("countersign sends a non-blank note and maps a refused note as a line problem", async () => {
    const f = reply(200, { countersigned: true, number: 1, adr: "ADR-0001" });
    vi.stubGlobal("fetch", f);
    await countersignDecision("t", "l", undefined, undefined, "ship it");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ timestamp: "t", leadId: "l", note: "ship it" });
    await countersignDecision("t", "l", undefined, undefined, "   ");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ timestamp: "t", leadId: "l" });
    vi.stubGlobal("fetch", reply(400, { error: "note_too_long" }));
    expect(await countersignDecision("t", "l", undefined, undefined, "x")).toEqual({ ok: false, reason: "line-rejected", code: "note_too_long" });
  });

  // @covers FR-01.71
  it("reject maps a refused reason and an unwritable rejected-decisions file", async () => {
    vi.stubGlobal("fetch", reply(400, { error: "reason_contains_quote" }));
    expect(await rejectDecision("t", "l", "x")).toEqual({ ok: false, reason: "reason-rejected", code: "reason_contains_quote" });
    vi.stubGlobal("fetch", reply(409, { error: "rejected_file_unwritable", message: "decisions-rejected.md cannot be written" }));
    expect(await rejectDecision("t", "l", "x")).toEqual({ ok: false, reason: "audit-unwritable", message: "decisions-rejected.md cannot be written" });
  });

  // @covers FR-01.71
  it("a rejected-file write that failed after the audit record is reported as half done, not as nothing changed", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "rejected_file_unwritable", message: "m", auditWritten: true }));
    const res = await rejectDecision("t", "l", "x");
    expect(res).toEqual({ ok: false, reason: "audit-unwritable", message: "m", auditWritten: true });
    if (res.ok) throw new Error("expected a failure");
    const status = rejectFailureStatus(res);
    expect(status).toEqual({ kind: "blocked", message: "Half done: the audit record is written, the proposal is still listed. m" });
  });
});
