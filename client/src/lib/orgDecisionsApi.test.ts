import { describe, it, expect, vi, afterEach } from "vitest";

import {
  parseProposedDecisions,
  fetchProposedDecisions,
  countersignDecision,
} from "./orgDecisionsApi";
import { ORG_API } from "./orgApi";
import { ApiError } from "./externalApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(res: { ok: boolean; status: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: res.json ?? (async () => ({})),
    text: res.text ?? (async () => ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("parseProposedDecisions", () => {
  it("an empty file parses to an empty array", () => {
    expect(parseProposedDecisions("")).toEqual([]);
    expect(parseProposedDecisions("   \n  ")).toEqual([]);
  });

  it("parses one header-delimited entry, timestamp + leadId from the header", () => {
    const raw = "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n- **Decision:** b\n";
    const entries = parseProposedDecisions(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toBe("2026-08-17T09:00:00.000Z");
    expect(entries[0].leadId).toBe("acme-lead");
    expect(entries[0].block).toContain("Context:** a");
  });

  it("body excludes the header line — the identity is shown once, not duplicated in the rendered body", () => {
    const raw = "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n- **Decision:** b\n";
    const entries = parseProposedDecisions(raw);
    expect(entries[0].body).not.toContain("## [2026-08-17T09:00:00.000Z] acme-lead");
    expect(entries[0].body).toContain("Context:** a");
  });

  it("splits multiple entries at the next header, not by blank lines", () => {
    const raw =
      "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n" +
      "## [2026-08-17T09:05:00.000Z] other-lead\n- **Context:** c\n";
    const entries = parseProposedDecisions(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0].leadId).toBe("acme-lead");
    expect(entries[0].block).not.toContain("other-lead");
    expect(entries[1].leadId).toBe("other-lead");
  });

  it("extracts a labelled Evidence line when present", () => {
    const raw =
      "## [2026-08-17T09:00:00.000Z] acme-lead\n" +
      "- **Context:** a\n- **Evidence:** learnings.md#2026-08-16\n";
    expect(parseProposedDecisions(raw)[0].evidence).toBe("learnings.md#2026-08-16");
  });

  it("a body with no Evidence line yields evidence: null, not a crash or a placeholder string", () => {
    const raw = "## [2026-08-17T09:00:00.000Z] acme-lead\nfree text only\n";
    expect(parseProposedDecisions(raw)[0].evidence).toBeNull();
  });

  it("tolerates CRLF line endings on the header line", () => {
    const raw = "## [2026-08-17T09:00:00.000Z] acme-lead\r\n- **Context:** a\r\n";
    const entries = parseProposedDecisions(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].leadId).toBe("acme-lead");
  });

  it("a non-matching line ('## Not a real header') is not mistaken for an entry boundary", () => {
    const raw = "## Not a real header\nsome body\n## [2026-08-17T09:00:00.000Z] acme-lead\nbody\n";
    const entries = parseProposedDecisions(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].block).not.toContain("Not a real header");
  });
});

describe("fetchProposedDecisions", () => {
  it("fetches decisions-proposed.md and parses it", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      text: async () => "## [2026-08-17T09:00:00.000Z] acme-lead\nbody\n",
    });
    const entries = await fetchProposedDecisions();
    expect(entries).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORG_API}/file?path=decisions-proposed.md`,
      { cache: "no-store" },
    );
  });

  it("an empty (but present) file resolves to an empty array — the 'no decisions waiting' state", async () => {
    stubFetch({ ok: true, status: 200, text: async () => "" });
    await expect(fetchProposedDecisions()).resolves.toEqual([]);
  });

  it("throws a decoded ApiError on a non-2xx (e.g. a genuine 404, distinct from an empty file)", async () => {
    stubFetch({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    await expect(fetchProposedDecisions()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("countersignDecision", () => {
  const TS = "2026-08-17T09:00:00.000Z";

  it("posts {timestamp, leadId} and returns the success shape", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ countersigned: true, alreadyCountersigned: false, number: 1, adr: "ADR-0001" }),
    });
    const result = await countersignDecision(TS, "acme-lead");
    expect(result).toEqual({ ok: true, alreadyCountersigned: false, number: 1, adr: "ADR-0001" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORG_API}/decisions/countersign`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ timestamp: TS, leadId: "acme-lead" }),
      }),
    );
  });

  it("an idempotent retry reads alreadyCountersigned: true, not as an error", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ countersigned: true, alreadyCountersigned: true, number: 1, adr: "ADR-0001" }),
    });
    const result = await countersignDecision(TS, "acme-lead");
    expect(result).toEqual({ ok: true, alreadyCountersigned: true, number: 1, adr: "ADR-0001" });
  });

  it("404 (proposal_not_found) reads as a typed not-found result, not a thrown error", async () => {
    stubFetch({ ok: false, status: 404, json: async () => ({ error: "proposal_not_found" }) });
    await expect(countersignDecision(TS, "acme-lead")).resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it("409 duplicate_proposal_identity reads as a typed duplicate result with its count, distinguishable from not-found", async () => {
    stubFetch({
      ok: false,
      status: 409,
      json: async () => ({ error: "duplicate_proposal_identity", count: 2 }),
    });
    await expect(countersignDecision(TS, "acme-lead")).resolves.toEqual({
      ok: false,
      reason: "duplicate",
      count: 2,
    });
  });

  it("a validation failure (400) throws ApiError, never a silent typed result", async () => {
    stubFetch({ ok: false, status: 400, json: async () => ({ error: "timestamp_invalid" }) });
    await expect(countersignDecision("not-a-timestamp", "acme-lead")).rejects.toBeInstanceOf(ApiError);
  });
});
