/*
 * triage-origin.test.ts — git layer for the delivered-origin snapshot.
 * child_process is fully mocked: no real git runs. Covers the review's
 * operational concerns (Gemini + GPT-5.4): SHA-keyed cache, singleflight +
 * cooldown fetch, upstream resolution, and degrade-to-null on every failure.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { spawnSync, spawn } = vi.hoisted(() => ({ spawnSync: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync, spawn }));

import {
  resolveUpstream,
  originSnapshot,
  localBehindCount,
  scheduleFetch,
  loadDeliveredOrigin,
  _resetOriginState_TEST_ONLY,
} from "./triage-origin.js";

/** Route spawnSync results by the git subcommand in argv. */
function routeGit(map: {
  upstream?: string | null;
  sha?: string | null;
  show?: string | null;
  behind?: string | null;
}): void {
  spawnSync.mockImplementation((_git: string, args: string[]) => {
    const a = args.join(" ");
    const ok = (stdout: string) => ({ status: 0, stdout, error: undefined });
    const fail = () => ({ status: 1, stdout: "", error: undefined });
    if (a.includes("--symbolic-full-name @{u}"))
      return map.upstream == null ? fail() : ok(map.upstream + "\n");
    if (a.includes("rev-parse refs/remotes"))
      return map.sha == null ? fail() : ok(map.sha + "\n");
    if (a.includes("show "))
      return map.show == null ? fail() : ok(map.show);
    if (a.includes("rev-list"))
      return map.behind == null ? fail() : ok(map.behind + "\n");
    return fail();
  });
}

function fakeChild() {
  const handlers: Record<string, (() => void) | undefined> = {};
  return {
    on: vi.fn((ev: string, cb: () => void) => {
      handlers[ev] = cb;
    }),
    kill: vi.fn(),
    unref: vi.fn(),
    _fire: (ev: string) => handlers[ev]?.(),
  };
}

const ROOT = "/repo";
const UP = { ref: "refs/remotes/origin/main", remote: "origin", branch: "main" };

beforeEach(() => {
  vi.clearAllMocks();
  _resetOriginState_TEST_ONLY();
  spawn.mockImplementation(() => fakeChild());
});

describe("resolveUpstream", () => {
  it("parses refs/remotes/<remote>/<branch>", () => {
    routeGit({ upstream: "refs/remotes/origin/main" });
    expect(resolveUpstream(ROOT)).toEqual(UP);
  });
  it("returns null when there is no upstream (detached / unset / non-repo)", () => {
    routeGit({ upstream: null });
    expect(resolveUpstream(ROOT)).toBeNull();
  });
  it("returns null for a non-remote-tracking ref shape", () => {
    routeGit({ upstream: "refs/heads/main" });
    expect(resolveUpstream(ROOT)).toBeNull();
  });
});

describe("originSnapshot", () => {
  it("parses the git-show blob into raw lines", () => {
    routeGit({ sha: "abc123", show: '{"event":"append","id":"trg-x"}\n' });
    const lines = originSnapshot(ROOT, UP);
    expect(lines).toEqual([{ event: "append", id: "trg-x" }]);
  });

  it("caches by ref SHA — git show runs once while the SHA is unchanged", () => {
    routeGit({ sha: "abc123", show: '{"event":"append","id":"trg-x"}\n' });
    originSnapshot(ROOT, UP);
    originSnapshot(ROOT, UP);
    const showCalls = spawnSync.mock.calls.filter((c) => (c[1] as string[]).join(" ").includes("show "));
    expect(showCalls).toHaveLength(1);
  });

  it("re-runs git show when the SHA moves", () => {
    routeGit({ sha: "sha-1", show: '{"event":"append","id":"trg-x"}\n' });
    originSnapshot(ROOT, UP);
    routeGit({ sha: "sha-2", show: '{"event":"append","id":"trg-y"}\n' });
    const lines = originSnapshot(ROOT, UP);
    expect(lines).toEqual([{ event: "append", id: "trg-y" }]);
  });

  it("returns [] (available, empty) when the path is absent at that ref", () => {
    routeGit({ sha: "abc123", show: null });
    expect(originSnapshot(ROOT, UP)).toEqual([]);
  });

  it("returns null (degrade) when the ref SHA cannot be resolved", () => {
    routeGit({ sha: null });
    expect(originSnapshot(ROOT, UP)).toBeNull();
  });
});

describe("localBehindCount", () => {
  it("returns the right side of HEAD...@{u}", () => {
    routeGit({ behind: "1\t4" });
    expect(localBehindCount(ROOT)).toBe(4);
  });
  it("returns null on failure", () => {
    routeGit({ behind: null });
    expect(localBehindCount(ROOT)).toBeNull();
  });
});

describe("scheduleFetch", () => {
  it("is singleflight — only one fetch in flight per repo", () => {
    scheduleFetch(ROOT, UP);
    scheduleFetch(ROOT, UP); // in-flight → suppressed
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("honors the cooldown after a fetch completes", () => {
    const child = fakeChild();
    spawn.mockImplementationOnce(() => child);
    scheduleFetch(ROOT, UP);
    child._fire("exit"); // completes → clears in-flight, but cooldown timestamp stays
    scheduleFetch(ROOT, UP); // within cooldown → suppressed
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("passes the resolved remote + branch as argv (no shell)", () => {
    scheduleFetch(ROOT, UP);
    const args = spawn.mock.calls[0][1] as string[];
    expect(args).toEqual(["-C", ROOT, "fetch", "--quiet", "origin", "main"]);
    expect(spawn.mock.calls[0][2]).toMatchObject({ shell: false });
  });
});

describe("loadDeliveredOrigin", () => {
  it("feature flag off → pure degrade, no git invoked", () => {
    const r = loadDeliveredOrigin(ROOT, { enabled: false });
    expect(r).toEqual({ originRawLines: null, originAvailable: false, localBehind: null });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("no upstream → degrade (originAvailable false), no fetch", () => {
    routeGit({ upstream: null });
    const r = loadDeliveredOrigin(ROOT, { enabled: true });
    expect(r.originRawLines).toBeNull();
    expect(r.originAvailable).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("upstream present → origin lines + availability + schedules a fetch", () => {
    routeGit({
      upstream: "refs/remotes/origin/main",
      sha: "abc123",
      show: '{"event":"append","id":"trg-z"}\n',
      behind: "0\t2",
    });
    const r = loadDeliveredOrigin(ROOT, { enabled: true });
    expect(r.originRawLines).toEqual([{ event: "append", id: "trg-z" }]);
    expect(r.originAvailable).toBe(true);
    expect(r.localBehind).toBe(2);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
