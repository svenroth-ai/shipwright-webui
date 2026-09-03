import { describe, it, expect, vi, afterEach } from "vitest";

import {
  fetchLeadsRoster,
  fetchOrgFileText,
  fetchLeadLearnings,
  fetchLeadAuditLog,
  fetchOrgThreads,
  ORG_API,
} from "./orgApi";
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

describe("fetchLeadsRoster", () => {
  it("returns the parsed roster on a 200", async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ leads: [] }) });
    await expect(fetchLeadsRoster()).resolves.toEqual({ leads: [] });
  });

  it("throws a decoded ApiError on a non-2xx", async () => {
    stubFetch({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    await expect(fetchLeadsRoster()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("fetchOrgThreads", () => {
  it("returns the parsed threads map on a 200", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ "acme-lead": [] }),
    });
    await expect(fetchOrgThreads()).resolves.toEqual({ "acme-lead": [] });
    expect(fetchMock).toHaveBeenCalledWith(`${ORG_API}/threads`, { cache: "no-store" });
  });

  it("throws a decoded ApiError on a non-2xx", async () => {
    stubFetch({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    await expect(fetchOrgThreads()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("fetchOrgFileText", () => {
  it("returns the raw text on a 200 and encodes the path in the query string", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, text: async () => "# hi" });
    await expect(fetchOrgFileText("some dir/conventions.md")).resolves.toBe("# hi");
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORG_API}/file?path=some%20dir%2Fconventions.md`,
      { cache: "no-store" },
    );
  });

  it("throws a decoded ApiError on a 404", async () => {
    stubFetch({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    const err = await fetchOrgFileText("missing.md").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});

describe("fetchLeadLearnings", () => {
  it("returns the raw text on a 200", async () => {
    stubFetch({ ok: true, status: 200, text: async () => "learnings body" });
    await expect(fetchLeadLearnings("acme-lead")).resolves.toBe("learnings body");
  });

  it("throws a decoded ApiError on a non-2xx", async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    await expect(fetchLeadLearnings("acme-lead")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("fetchLeadAuditLog", () => {
  it("omits query params entirely when none are given", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({ entries: [], total: 0, nextCursor: null }) });
    await fetchLeadAuditLog("acme-lead");
    expect(fetchMock).toHaveBeenCalledWith(`${ORG_API}/leads/acme-lead/audit`, { cache: "no-store" });
  });

  it("builds a query string from before/limit when given", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({ entries: [], total: 0, nextCursor: null }) });
    await fetchLeadAuditLog("acme-lead", { before: 42, limit: 10 });
    expect(fetchMock).toHaveBeenCalledWith(`${ORG_API}/leads/acme-lead/audit?before=42&limit=10`, { cache: "no-store" });
  });

  it("throws a decoded ApiError on a non-2xx", async () => {
    stubFetch({ ok: false, status: 502, json: async () => ({ error: "upstream_broken" }) });
    await expect(fetchLeadAuditLog("acme-lead")).rejects.toBeInstanceOf(ApiError);
  });
});
