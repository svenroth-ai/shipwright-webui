/*
 * worktree-roots.cache.test.ts — the short-TTL root-set cache (perf item 1).
 *
 * The resolver polls once a second and must call `readAllowedRootsCached` BEFORE
 * its own response-cache hit check (chosen.root feeds the rev that keys it), so
 * the uncached path spawned `git worktree list --porcelain` on EVERY poll —
 * even a pure cache hit. These cases pin that within the TTL there is exactly
 * one spawn, that the entry expires, and that the cache is per-projectRoot.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _clearRootsCache, readAllowedRootsCached } from "./worktree-roots.js";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("readAllowedRootsCached (short-TTL per-projectRoot cache)", () => {
  beforeEach(() => _clearRootsCache());

  it("spawns git ONCE within the TTL, then serves the cached set (no per-poll spawn)", async () => {
    const root = tmp("mc-rootcache-");
    try {
      let calls = 0;
      const git = () => {
        calls++;
        return `worktree ${root}\n\n`;
      };
      let clock = 1_000;
      const now = () => clock;
      const a = await readAllowedRootsCached(root, { git, now, ttlMs: 5_000 });
      clock += 1_000; // a later poll, still inside the TTL
      const b = await readAllowedRootsCached(root, { git, now, ttlMs: 5_000 });
      clock += 1_000;
      const c = await readAllowedRootsCached(root, { git, now, ttlMs: 5_000 });
      expect(calls).toBe(1); // three polls, ONE spawn
      expect(a).toEqual([join(root)]);
      expect(b).toBe(a); // the very same cached array, not a rebuild
      expect(c).toBe(a);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-spawns once the TTL expires (staleness is bounded, self-correcting)", async () => {
    const root = tmp("mc-rootcache-");
    try {
      let calls = 0;
      const git = () => {
        calls++;
        return `worktree ${root}\n\n`;
      };
      let clock = 1_000;
      const now = () => clock;
      await readAllowedRootsCached(root, { git, now, ttlMs: 5_000 });
      clock += 5_001; // past the TTL
      await readAllowedRootsCached(root, { git, now, ttlMs: 5_000 });
      expect(calls).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keys the cache per projectRoot (one project's set never masks another's)", async () => {
    const a = tmp("mc-rootcache-a-");
    const b = tmp("mc-rootcache-b-");
    try {
      const now = () => 1_000;
      const gitA = () => `worktree ${a}\n\n`;
      const gitB = () => `worktree ${b}\n\n`;
      expect(await readAllowedRootsCached(a, { git: gitA, now })).toEqual([join(a)]);
      expect(await readAllowedRootsCached(b, { git: gitB, now })).toEqual([join(b)]);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("awaits an ASYNC git runner (Promise-returning double)", async () => {
    const root = tmp("mc-rootcache-async-");
    try {
      const git = () => Promise.resolve(`worktree ${root}\n\n`);
      expect(await readAllowedRootsCached(root, { git, now: () => 1_000 })).toEqual([join(root)]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
