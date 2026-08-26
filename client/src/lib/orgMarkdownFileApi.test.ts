/*
 * orgMarkdownFileApi.test.ts — the charter.md load/save contract
 * (external-review fix: no test previously proved the fresh-load-before-
 * edit round trip actually sends the loaded ETag back as `If-Match`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { loadMarkdownForEdit, saveMarkdown, MarkdownConflictError } from "./orgMarkdownFileApi";
import { ApiError } from "./externalApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadMarkdownForEdit", () => {
  it("fetches the lead's charter.md via the file proxy and strips quotes off the ETag", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"abc123"' }),
      text: async () => "# charter body",
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await loadMarkdownForEdit("acme-lead");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/org/file?path=acme-lead%2Fcharter.md",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result).toEqual({ text: "# charter body", fingerprint: "abc123" });
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ error: "not_found" }),
      }),
    );
    await expect(loadMarkdownForEdit("acme-lead")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("saveMarkdown", () => {
  it("PUTs to the charter proxy with the loaded fingerprint as If-Match", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fingerprint: "def456" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await saveMarkdown("acme-lead", "new body", "abc123");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/org/leads/acme-lead/charter",
      expect.objectContaining({
        method: "PUT",
        body: "new body",
        headers: expect.objectContaining({ "If-Match": '"abc123"' }),
      }),
    );
    expect(result).toEqual({ fingerprint: "def456" });
  });

  it("throws MarkdownConflictError on a 409, carrying the server's current fingerprint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ currentFingerprint: "stale999" }),
      }),
    );
    let caught: unknown;
    try {
      await saveMarkdown("acme-lead", "new body", "abc123");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MarkdownConflictError);
  });

  it("throws ApiError on any other non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "unknown_lead" }),
      }),
    );
    await expect(saveMarkdown("ghost-lead", "x", "abc123")).rejects.toBeInstanceOf(ApiError);
  });
});
