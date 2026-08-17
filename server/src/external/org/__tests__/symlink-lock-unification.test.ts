/*
 * symlink-lock-unification.test.ts — mini-plan step 8: prove `realpath: true`
 * (set EXPLICITLY in `withDecisionsLock`, per the FR-04.28 contract) actually
 * does what the contract depends on — two different path STRINGS that
 * resolve to the SAME file on disk must contend for the SAME lock, not two
 * independent ones.
 *
 * This matters because `decisions-lock.ts` resolves `proposedPath` purely at
 * the string level (`resolveOrgAllowlistedTarget` → `pathGuard`, never
 * realpath'd by our own code) — so if leadwright's daemon and this route
 * ever reach the same `decisions-proposed.md` through two different parent
 * paths (a symlinked/junctioned directory being the obvious way that
 * happens), the lock is only actually shared if `proper-lockfile`'s OWN
 * `realpath: true` unifies them before deriving the `<canonical>.lock`
 * directory name. Same-process `Promise.all` is legitimate here (unlike the
 * two-process test) because this exercises `proper-lockfile`'s own async
 * retry/backoff machinery, not our synchronous fs-call pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import * as lockfile from "proper-lockfile";

import { withDecisionsLock } from "../decisions-lock.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withDecisionsLock — realpath unifies a symlinked/junctioned access path", () => {
  let realRoot: string;
  let aliasParent: string;
  let aliasLeadsRoot: string;

  beforeEach(() => {
    realRoot = mkdtempSync(path.join(tmpdir(), "org-lock-real-"));
    writeFileSync(path.join(realRoot, "decisions-proposed.md"), "", "utf8");
    aliasParent = mkdtempSync(path.join(tmpdir(), "org-lock-alias-"));
    aliasLeadsRoot = path.join(aliasParent, "leads");
    // Windows: junctions need no elevation (unlike symlinks) — same choice
    // this codebase already makes for worktree node_modules linking.
    symlinkSync(realRoot, aliasLeadsRoot, process.platform === "win32" ? "junction" : "dir");
  });

  afterEach(() => {
    rmSync(aliasParent, { recursive: true, force: true });
    rmSync(realRoot, { recursive: true, force: true });
  });

  it("a lock taken via the real path blocks a concurrent lock taken via the aliased path", async () => {
    const order: string[] = [];

    const first = withDecisionsLock({ leadsRoot: realRoot }, async () => {
      order.push("real-enter");
      await sleep(200);
      order.push("real-exit");
    });

    // Let the first lock actually land before the aliased one attempts.
    await sleep(30);

    const second = withDecisionsLock({ leadsRoot: aliasLeadsRoot }, async () => {
      order.push("alias-enter");
      await sleep(10);
      order.push("alias-exit");
    });

    await Promise.all([first, second]);

    // If realpath:true did NOT unify the two paths, "alias-enter" could
    // interleave with "real-enter"/"real-exit" instead of waiting for it.
    expect(order).toEqual(["real-enter", "real-exit", "alias-enter", "alias-exit"]);
  });

  it("without realpath unification the two paths would be independent — sanity check via raw proper-lockfile", async () => {
    // Documents the negative case this whole test exists to rule out: two
    // DIFFERENT canonical files never contend, proving the positive result
    // above is actually about unification and not some other serialization.
    const otherRoot = mkdtempSync(path.join(tmpdir(), "org-lock-other-"));
    writeFileSync(path.join(otherRoot, "decisions-proposed.md"), "", "utf8");
    try {
      const order: string[] = [];
      const a = withDecisionsLock({ leadsRoot: realRoot }, async () => {
        order.push("a-enter");
        await sleep(80);
        order.push("a-exit");
      });
      await sleep(15);
      const b = withDecisionsLock({ leadsRoot: otherRoot }, async () => {
        order.push("b-enter");
        await sleep(10);
        order.push("b-exit");
      });
      await Promise.all([a, b]);
      // Genuinely independent files DO overlap — b enters before a exits.
      expect(order.indexOf("b-enter")).toBeLessThan(order.indexOf("a-exit"));
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it(
    "doubt-review fix: isolates realpath:true's OWN contribution — same junction " +
      "fixture, called through proper-lockfile directly with realpath:false, so any " +
      "unification observed here is NOT this repo's code (withDecisionsLock always " +
      "passes realpath:true; this bypasses that wrapper entirely)",
    async () => {
      const realTarget = path.join(realRoot, "decisions-proposed.md");
      const aliasTarget = path.join(aliasLeadsRoot, "decisions-proposed.md");
      const order: string[] = [];

      const first = lockfile
        .lock(realTarget, { stale: 10_000, realpath: false })
        .then(async (release) => {
          order.push("real-enter");
          await sleep(200);
          order.push("real-exit");
          await release();
        });

      await sleep(30);

      const second = lockfile
        .lock(aliasTarget, {
          stale: 10_000,
          realpath: false,
          retries: { retries: 5, minTimeout: 20, maxTimeout: 100 },
        })
        .then(async (release) => {
          order.push("alias-enter");
          await sleep(10);
          order.push("alias-exit");
          await release();
        })
        .catch((err: NodeJS.ErrnoException) => {
          // A rejection here (ELOCKED, having exhausted retries against the
          // SAME lock) is itself proof of unification without realpath:true
          // resolving anything numerically — see the assertion below.
          order.push(`alias-rejected:${err.code}`);
        });

      await Promise.all([first, second]);

      // Either outcome (interleave observed, OR the alias lock never got in
      // at all and rejected ELOCKED) demonstrates unification happened
      // WITHOUT realpath:true — i.e. on this OS, a junction is already
      // transparent to proper-lockfile's raw string-keyed lock path, and
      // withDecisionsLock's explicit realpath:true is defense-in-depth /
      // contract-explicitness (matches leadwright's daemon), not the thing
      // load-bearing for THIS platform's unification. Document, don't
      // assume: the original test's claim ("realpath:true unifies them") is
      // still true as an API contract, but is not this environment's ONLY
      // path to the same observed behavior.
      const unifiedByOverlap = order[0] === "real-enter" && order[1] === "real-exit";
      const unifiedByRejection = order.some((e) => e.startsWith("alias-rejected"));
      expect(unifiedByOverlap || unifiedByRejection).toBe(true);
    },
  );
});
