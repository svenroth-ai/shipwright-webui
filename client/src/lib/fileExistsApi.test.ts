import { describe, it, expect, vi, afterEach } from "vitest";

import { checkFilesExist } from "./fileExistsApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fileExistsApi: checkFilesExist", () => {
  it("returns {} without a network call for an empty paths array", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const out = await checkFilesExist("p-1", []);
    expect(out).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it("GETs the batched endpoint and returns the exists map", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ exists: { "a.md": true, "b.json": false } }),
    }));
    vi.stubGlobal("fetch", spy);

    const out = await checkFilesExist("p-1", ["a.md", "b.json"]);
    expect(out).toEqual({ "a.md": true, "b.json": false });

    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/external/projects/p-1/files/exist?paths=a.md%2Cb.json");
  });

  it("percent-encodes a literal comma inside a path so it isn't mistaken for the delimiter", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ exists: { "a,b.md": true } }),
    }));
    vi.stubGlobal("fetch", spy);

    await checkFilesExist("p-1", ["a,b.md"]);

    const [url] = spy.mock.calls[0] as unknown as [string];
    // The path's own comma is escaped to %2C same as the join delimiter, so
    // the server can unambiguously decode each segment back — a bare comma
    // would let a comma-containing filename be split into two bogus paths.
    expect(url).toBe("/api/external/projects/p-1/files/exist?paths=a%252Cb.md");
  });

  it("throws on a non-ok response", async () => {
    const spy = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "project_not_found" }),
    }));
    vi.stubGlobal("fetch", spy);

    await expect(checkFilesExist("missing", ["a.md"])).rejects.toBeTruthy();
  });
});
