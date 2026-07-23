/*
 * merged-events.test.ts — the "merged but not pulled" fallback (2026-07-23).
 *
 * A finished iterate's `work_completed` lands on origin/main inside the squash,
 * but the user's main tree is not pulled — so the working-tree read misses and
 * the whole rail collapses to Decisions. These pin the fallback that reads the
 * row from the default remote ref, and — critically — that a LIVE run (its
 * worktree still registered) is NEVER asked, so an in-flight run is not misread
 * from a stale ref.
 *
 * @covers FR-01.66
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _clearMergedEventsCache,
  findWorkCompletedFromMergedRef,
  resolveWorkCompleted,
} from "./merged-events.js";
import { _clearEventIndexCache } from "./iterate-record.js";
import type { GitRunner } from "./worktree-roots.js";

const RUN = "iterate-2026-07-23-first-contact-hero";

/** One `work_completed` line, in the real on-disk shape (`type` + `adr_id`). */
function workRow(runId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "work_completed",
    adr_id: runId,
    ts: "2026-07-23T12:00:00Z",
    commit: "", // the worktree flow's empty commit — the whole point
    tests: { passed: 3037, total: 3037 },
    ...extra,
  });
}

/** A git runner that answers `git show <ref>:<file>` with a fixed blob. */
function gitShowing(blob: string, calls?: { n: number }): GitRunner {
  return (args) => {
    if (args[0] === "show") {
      if (calls) calls.n++;
      return blob;
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

afterEach(() => {
  _clearMergedEventsCache();
  _clearEventIndexCache();
});

describe("findWorkCompletedFromMergedRef", () => {
  it("FINDS the row on the ref and projects its counts (commit:'' and all)", async () => {
    const r = await findWorkCompletedFromMergedRef("/p", RUN, {
      git: gitShowing(`${workRow("iterate-other")}\n${workRow(RUN)}`),
    });
    expect(r.status).toBe("found");
    if (r.status !== "found") throw new Error("unreachable");
    expect(r.run.runId).toBe(RUN);
    expect(r.run.tests).toEqual({ passed: 3037, total: 3037 });
    expect(r.run.commit).toBe(""); // preserved — the reader must not invent one
  });

  it("is ABSENT (not unavailable) when the ref reads fine but lacks this run", async () => {
    const r = await findWorkCompletedFromMergedRef("/p", RUN, {
      git: gitShowing(workRow("iterate-someone-else")),
    });
    expect(r.status).toBe("absent");
  });

  it("is UNAVAILABLE when the ref cannot be read (never fetched / no git)", async () => {
    const throwing: GitRunner = () => {
      throw new Error("fatal: invalid object name 'origin/main'");
    };
    const r = await findWorkCompletedFromMergedRef("/p", RUN, { git: throwing });
    expect(r.status).toBe("unavailable");
  });

  it("TTL-caches the ref blob so N polls share ONE git show, then re-reads", async () => {
    const calls = { n: 0 };
    const git = gitShowing(workRow(RUN), calls);
    let clock = 0;
    const deps = { git, now: () => clock, ttlMs: 1000 };

    await findWorkCompletedFromMergedRef("/p", RUN, deps); // load
    clock = 500;
    await findWorkCompletedFromMergedRef("/p", RUN, deps); // within TTL → cached
    expect(calls.n).toBe(1);
    clock = 1600;
    await findWorkCompletedFromMergedRef("/p", RUN, deps); // TTL elapsed → re-read
    expect(calls.n).toBe(2);
  });
});

describe("resolveWorkCompleted (working tree first, ref for finished runs)", () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("does NOT consult the ref for a LIVE run (worktree still registered)", async () => {
    root = mkdtempSync(join(tmpdir(), "mev-live-")); // no events.jsonl → absent
    const git = vi.fn<GitRunner>(() => workRow(RUN));
    const { events, mergedRefMiss } = await resolveWorkCompleted(root, RUN, true, { git });
    expect(events.status).toBe("absent");
    expect(mergedRefMiss).toBe(false);
    expect(git).not.toHaveBeenCalled(); // an in-flight run is never read from the ref
  });

  it("consults the ref for a FINISHED run and substitutes the merged row", async () => {
    root = mkdtempSync(join(tmpdir(), "mev-done-"));
    const { events, mergedRefMiss } = await resolveWorkCompleted(root, RUN, false, {
      git: gitShowing(workRow(RUN)),
    });
    expect(events.status).toBe("found");
    expect(mergedRefMiss).toBe(false);
  });

  it("reports a miss (uncacheable) when a finished run is not on the ref yet", async () => {
    root = mkdtempSync(join(tmpdir(), "mev-miss-"));
    const { events, mergedRefMiss } = await resolveWorkCompleted(root, RUN, false, {
      git: gitShowing(workRow("iterate-unrelated")),
    });
    expect(events.status).toBe("absent");
    expect(mergedRefMiss).toBe(true);
  });

  it("uses the working tree directly when the row IS local (no ref call)", async () => {
    root = mkdtempSync(join(tmpdir(), "mev-local-"));
    writeFileSync(join(root, "shipwright_events.jsonl"), `${workRow(RUN)}\n`, "utf-8");
    const git = vi.fn<GitRunner>(() => "");
    const { events, mergedRefMiss } = await resolveWorkCompleted(root, RUN, false, { git });
    expect(events.status).toBe("found");
    expect(mergedRefMiss).toBe(false);
    expect(git).not.toHaveBeenCalled();
  });
});
