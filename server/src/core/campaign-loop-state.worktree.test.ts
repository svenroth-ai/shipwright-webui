/*
 * The attached-run detector must see (a) a campaign's OWN worktree state and
 * (b) the monorepo's R4 wave statuses — a wave run never writes `in_progress`,
 * so a detector that knew only that status let a hand-launch race a live wave.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readLoopAttachments, readLoopRunState } from "./campaign-loop-state.js";
import { listCampaignWorktrees, resolveCampaignStateRoot } from "./campaign-worktree-root.js";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "loop-wt-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function seed(dir: string, units: Array<Record<string, unknown>>, kind = "sub_iterate"): void {
  mkdirSync(path.join(dir, ".shipwright"), { recursive: true });
  writeFileSync(path.join(dir, ".shipwright", "loop_state.json"), JSON.stringify({ kind, units }));
}
const wt = (slug: string) => path.join(root, ".worktrees", `campaign-${slug}`);
const specFor = (slug: string) => `.shipwright/planning/iterate/campaigns/${slug}/sub-iterates/A-a.md`;

describe("attached-run detection — R4 wave statuses", () => {
  it.each(["claimed", "running", "built", "reviewed", "merging", "in_progress"])(
    "a unit in '%s' means a run is attached",
    (status) => {
      seed(root, [{ id: "A", status, spec_path: specFor("legacy"), claimed_at: ago(60_000) }]);
      expect(readLoopAttachments(root, NOW).has("legacy")).toBe(true);
    },
  );

  it.each(["pending", "merged", "failed", "held"])("a unit in '%s' does NOT mean a run is attached", (status) => {
    seed(root, [{ id: "A", status, spec_path: specFor("legacy") }]);
    expect(readLoopAttachments(root, NOW).size).toBe(0);
  });

  it("uses claimed_at for staleness when started_at is absent (a wave claim never stamps started_at)", () => {
    seed(root, [{ id: "A", status: "claimed", spec_path: specFor("legacy"), claimed_at: ago(7 * 3600_000) }]);
    expect(readLoopAttachments(root, NOW).size).toBe(0); // dead orchestrator, beyond the 6 h window
  });

  it("feeds the per-step overlay with the running unit ids", () => {
    seed(root, [
      { id: "A", status: "running", spec_path: specFor("legacy"), claimed_at: ago(1000) },
      { id: "B", status: "pending", spec_path: specFor("legacy") },
    ]);
    expect([...(readLoopRunState(root, NOW).runningStepIdsBySlug.get("legacy") ?? [])]).toEqual(["A"]);
  });
});

describe("attached-run detection — the campaign's own worktree", () => {
  it("reads a worktree campaign's state, keyed by the directory name (no spec_path needed)", () => {
    seed(wt("demo"), [{ id: "A", status: "running", claimed_at: ago(1000) }]);
    const snap = readLoopRunState(root, NOW);
    expect(snap.attachedSlugs.has("demo")).toBe(true);
    expect([...(snap.runningStepIdsBySlug.get("demo") ?? [])]).toEqual(["A"]);
  });

  it("two worktree campaigns are tracked independently", () => {
    seed(wt("one"), [{ id: "A", status: "running", claimed_at: ago(1000) }]);
    seed(wt("two"), [{ id: "A", status: "pending" }]);
    expect([...readLoopAttachments(root, NOW)]).toEqual(["one"]);
  });

  it("a section loop in a worktree is not a campaign", () => {
    seed(wt("demo"), [{ id: "A", status: "running" }], "section");
    expect(readLoopAttachments(root, NOW).size).toBe(0);
  });

  it("still reads the project-root state for a legacy campaign alongside worktree ones", () => {
    seed(wt("demo"), [{ id: "A", status: "running", claimed_at: ago(1000) }]);
    seed(root, [{ id: "Z", status: "in_progress", spec_path: specFor("legacy"), started_at: ago(1000) }]);
    expect([...readLoopAttachments(root, NOW)].sort()).toEqual(["demo", "legacy"]);
  });
});

describe("readLoopRunState — stale root file", () => {
  it("a stale root state listing a WORKTREE campaign's units does not attach it", () => {
    seed(wt("demo"), [{ id: "A", status: "pending" }]); // worktree has its OWN loop, nothing live
    seed(root, [{ id: "A", status: "running", spec_path: specFor("demo"), claimed_at: ago(1000) }]);
    expect(readLoopAttachments(root, NOW).size).toBe(0);
  });

  it("but a worktree DIRECTORY without its own loop does not blind the guard to a live root-based run", () => {
    mkdirSync(wt("demo"), { recursive: true }); // leftover dir, no loop_state.json
    seed(root, [{ id: "A", status: "running", spec_path: specFor("demo"), claimed_at: ago(1000) }]);
    expect([...readLoopAttachments(root, NOW)]).toEqual(["demo"]);
  });
});

describe("campaign-worktree-root", () => {
  it("resolves the campaign's worktree when it exists", () => {
    mkdirSync(wt("demo"), { recursive: true });
    expect(resolveCampaignStateRoot(root, "demo")).toEqual({ root: wt("demo"), worktree: true });
  });

  it("falls back to the project root when there is no such worktree (legacy campaign)", () => {
    expect(resolveCampaignStateRoot(root, "demo")).toEqual({ root, worktree: false });
  });

  it.each(["", "a/b", "..", "a..b", "x y", "a".repeat(129)])("rejects the unsafe slug %j", (slug) => {
    mkdirSync(path.join(root, ".worktrees"), { recursive: true });
    expect(resolveCampaignStateRoot(root, slug).worktree).toBe(false);
  });

  it("lists only well-formed campaign-<slug> directories", () => {
    mkdirSync(wt("one"), { recursive: true });
    mkdirSync(path.join(root, ".worktrees", "some-iterate"), { recursive: true });
    mkdirSync(path.join(root, ".worktrees", "campaign-"), { recursive: true });
    writeFileSync(path.join(root, ".worktrees", "campaign-file"), "not a dir");
    expect(listCampaignWorktrees(root)).toEqual([{ slug: "one", root: wt("one") }]);
  });

  it("no .worktrees directory at all is an empty list, never a throw", () => {
    expect(listCampaignWorktrees(root)).toEqual([]);
  });
});
