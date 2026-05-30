import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  validatePrUrl,
  resolveGhBin,
  fetchPrStatus,
  _clearPrStatusCache,
  type GhRunResult,
} from "./pr-status.js";

const VALID = "https://github.com/svenroth-ai/shipwright-webui/pull/78";

function runner(result: Partial<GhRunResult>) {
  return vi.fn(async () => ({ exitCode: 0, stdout: "", ...result }));
}

describe("validatePrUrl", () => {
  it("accepts a canonical github pull URL", () => {
    expect(validatePrUrl(VALID)).toEqual({
      owner: "svenroth-ai",
      repo: "shipwright-webui",
      number: 78,
    });
  });

  it("tolerates a trailing slash / query / fragment", () => {
    expect(validatePrUrl(VALID + "/files")).not.toBeNull();
    expect(validatePrUrl(VALID + "?diff=split")).not.toBeNull();
    expect(validatePrUrl(VALID + "#discussion")).not.toBeNull();
  });

  it("rejects non-https, non-github host, and non-pull paths", () => {
    expect(validatePrUrl("http://github.com/a/b/pull/1")).toBeNull();
    expect(validatePrUrl("https://gitlab.com/a/b/pull/1")).toBeNull();
    expect(validatePrUrl("https://evil.com/github.com/a/b/pull/1")).toBeNull();
    expect(validatePrUrl("https://github.com/a/b/issues/1")).toBeNull();
    expect(validatePrUrl("https://github.com/a/b/pull/notanumber")).toBeNull();
  });

  it("rejects non-string, oversized, and null-byte input", () => {
    expect(validatePrUrl(undefined)).toBeNull();
    expect(validatePrUrl(42)).toBeNull();
    expect(validatePrUrl("https://github.com/a/b/pull/1\0")).toBeNull();
    expect(validatePrUrl("https://github.com/a/b/pull/" + "1".repeat(500))).toBeNull();
  });
});

describe("resolveGhBin", () => {
  it("returns the resolved path when `where`/`which` finds an existing binary", () => {
    const spawnSync = vi.fn(() => ({ stdout: "/usr/bin/gh\n", error: undefined })) as never;
    const bin = resolveGhBin({ platform: "linux", spawnSync, existsSync: () => true });
    expect(bin).toBe("/usr/bin/gh");
  });

  it("prefers the .exe line on Windows", () => {
    const spawnSync = vi.fn(() => ({
      stdout: "C:\\tools\\gh.cmd\r\nC:\\tools\\gh.exe\r\n",
      error: undefined,
    })) as never;
    const bin = resolveGhBin({ platform: "win32", spawnSync, existsSync: () => true });
    expect(bin).toBe("C:\\tools\\gh.exe");
  });

  it("returns null when the lookup errors or the path does not exist", () => {
    const erroring = vi.fn(() => ({ stdout: "", error: new Error("ENOENT") })) as never;
    expect(resolveGhBin({ platform: "linux", spawnSync: erroring, existsSync: () => true })).toBeNull();
    const ghost = vi.fn(() => ({ stdout: "/usr/bin/gh\n", error: undefined })) as never;
    expect(resolveGhBin({ platform: "linux", spawnSync: ghost, existsSync: () => false })).toBeNull();
  });
});

describe("fetchPrStatus", () => {
  beforeEach(() => _clearPrStatusCache());

  const deps = (run: ReturnType<typeof runner>, extra = {}) => ({
    run,
    resolveBin: () => "/usr/bin/gh",
    now: () => 1000,
    ...extra,
  });

  it("maps an OPEN non-draft PR to state=open", async () => {
    const run = runner({ stdout: JSON.stringify({ state: "OPEN", mergedAt: null, isDraft: false }) });
    expect(await fetchPrStatus(VALID, deps(run))).toEqual({ state: "open", merged: false });
  });

  it("maps an OPEN draft PR to state=draft", async () => {
    const run = runner({ stdout: JSON.stringify({ state: "OPEN", mergedAt: null, isDraft: true }) });
    expect(await fetchPrStatus(VALID, deps(run))).toEqual({ state: "draft", merged: false });
  });

  it("maps a merged PR to state=merged + merged=true", async () => {
    const run = runner({
      stdout: JSON.stringify({ state: "MERGED", mergedAt: "2026-05-30T10:00:00Z", isDraft: false }),
    });
    expect(await fetchPrStatus(VALID, deps(run))).toEqual({ state: "merged", merged: true });
  });

  it("maps a CLOSED (unmerged) PR to state=closed", async () => {
    const run = runner({ stdout: JSON.stringify({ state: "CLOSED", mergedAt: null, isDraft: false }) });
    expect(await fetchPrStatus(VALID, deps(run))).toEqual({ state: "closed", merged: false });
  });

  it("returns unknown when gh is unavailable (resolveBin null)", async () => {
    const run = runner({ stdout: "should-not-be-called" });
    const status = await fetchPrStatus(VALID, { run, resolveBin: () => null, now: () => 1000 });
    expect(status).toEqual({ state: "unknown", merged: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns unknown on a non-zero gh exit", async () => {
    const run = runner({ exitCode: 1, stdout: "" });
    expect(await fetchPrStatus(VALID, deps(run))).toEqual({ state: "unknown", merged: false });
  });

  it("returns unknown on malformed gh json", async () => {
    const run = runner({ stdout: "not json {" });
    expect(await fetchPrStatus(VALID, deps(run))).toEqual({ state: "unknown", merged: false });
  });

  it("invokes gh with the url after a `--` end-of-options separator (no flag injection)", async () => {
    const run = runner({ stdout: JSON.stringify({ state: "OPEN", isDraft: false }) });
    await fetchPrStatus(VALID, deps(run));
    const args = run.mock.calls[0][1] as string[];
    expect(args).toEqual(["pr", "view", "--json", "state,mergedAt,isDraft", "--", VALID]);
  });

  it("serves a cached result within the TTL (gh runs once)", async () => {
    const run = runner({ stdout: JSON.stringify({ state: "OPEN", isDraft: false }) });
    let clock = 1000;
    const d = { run, resolveBin: () => "/usr/bin/gh", now: () => clock, ttlMs: 60_000 };
    await fetchPrStatus(VALID, d);
    clock = 1000 + 30_000; // within TTL
    await fetchPrStatus(VALID, d);
    expect(run).toHaveBeenCalledTimes(1);
    clock = 1000 + 61_000; // past TTL → re-fetch
    await fetchPrStatus(VALID, d);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
