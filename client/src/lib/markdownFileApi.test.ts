/*
 * markdownFileApi.test.ts — load + save wrappers (FR-01.34).
 * fetch is stubbed directly (no msw) — these are thin transport wrappers.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  loadMarkdownForEdit,
  saveMarkdown,
  MarkdownConflictError,
} from "./markdownFileApi";
import { ApiError } from "./externalApi";

afterEach(() => vi.unstubAllGlobals());

describe("loadMarkdownForEdit", () => {
  it("returns text + fingerprint with the ETag quotes stripped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("# hi\n", {
            status: 200,
            headers: { ETag: '"sha256:abc123"' },
          }),
      ),
    );
    const r = await loadMarkdownForEdit("p1", "README.md");
    expect(r.text).toBe("# hi\n");
    expect(r.fingerprint).toBe("sha256:abc123");
  });

  it("throws ApiError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
      ),
    );
    await expect(loadMarkdownForEdit("p1", "missing.md")).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("saveMarkdown", () => {
  it("PUTs with a quoted If-Match + body and returns the new fingerprint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ written: true, fingerprint: "sha256:new", size: 6 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await saveMarkdown("p1", "README.md", "# new\n", "sha256:old");
    expect(r.fingerprint).toBe("sha256:new");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("path=README.md");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"sha256:old"');
    expect(init.body).toBe("# new\n");
  });

  it("throws MarkdownConflictError on 409 with the on-disk fingerprint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "fingerprint_mismatch",
              currentFingerprint: "sha256:disk",
            }),
            { status: 409 },
          ),
      ),
    );
    const err = await saveMarkdown("p1", "README.md", "x", "sha256:old").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MarkdownConflictError);
    expect((err as MarkdownConflictError).currentFingerprint).toBe("sha256:disk");
  });

  it("throws ApiError on other failures (e.g. 415)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "not_markdown" }), { status: 415 }),
      ),
    );
    await expect(
      saveMarkdown("p1", "x.md", "x", "sha256:old"),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
