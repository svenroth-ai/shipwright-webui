/*
 * triage-board-read.test.ts — focused coverage for the `writesRouteToOutbox`
 * origin field (iterate-2026-08-08-triage-amend-reader AC9): the Edit UI's
 * pre-submit disclosure signal, computed via an async git probe local to
 * this read path (async, uncached — see the doc comment on
 * `shouldRouteToOutboxAsync` in triage-board-read.ts for why).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { readBoardItems } from "./triage-board-read.js";
import { _clearCache_TEST_ONLY } from "./triage-store.js";

function git(workDir: string, args: string[]): void {
  spawnSync("git", ["-C", workDir, ...args], { encoding: "utf-8", shell: false });
}

describe("readBoardItems — writesRouteToOutbox (AC9)", () => {
  let workDir: string;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("true on idle main (origin remote + HEAD on the default branch)", async () => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "board-read-idlemain-"));
    git(workDir, ["init"]);
    git(workDir, ["config", "user.email", "t@t.t"]);
    git(workDir, ["config", "user.name", "t"]);
    git(workDir, ["commit", "--allow-empty", "-m", "init"]);
    git(workDir, ["branch", "-M", "main"]);
    git(workDir, ["remote", "add", "origin", path.join(workDir, "origin-throwaway")]);
    const tracked = path.join(workDir, ".shipwright", "triage.jsonl");
    mkdirSync(path.dirname(tracked), { recursive: true });
    writeFileSync(tracked, `{"v":1,"schema":"triage","created":"2026-08-08T00:00:00Z"}\n`);

    const board = await readBoardItems(tracked, "proj-idle");
    expect(board.origin.writesRouteToOutbox).toBe(true);
  });

  it("false on a non-default branch (worktree/iterate-branch analog)", async () => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "board-read-nondefault-"));
    git(workDir, ["init"]);
    git(workDir, ["config", "user.email", "t@t.t"]);
    git(workDir, ["config", "user.name", "t"]);
    git(workDir, ["commit", "--allow-empty", "-m", "init"]);
    git(workDir, ["branch", "-M", "main"]);
    git(workDir, ["remote", "add", "origin", path.join(workDir, "origin-throwaway")]);
    git(workDir, ["checkout", "-b", "iterate/x"]);
    const tracked = path.join(workDir, ".shipwright", "triage.jsonl");
    mkdirSync(path.dirname(tracked), { recursive: true });
    writeFileSync(tracked, `{"v":1,"schema":"triage","created":"2026-08-08T00:00:00Z"}\n`);

    const board = await readBoardItems(tracked, "proj-branch");
    expect(board.origin.writesRouteToOutbox).toBe(false);
  });

  it("false when the project has no origin remote (no delivery path)", async () => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "board-read-noorigin-"));
    git(workDir, ["init"]);
    git(workDir, ["branch", "-M", "main"]);
    const tracked = path.join(workDir, ".shipwright", "triage.jsonl");
    mkdirSync(path.dirname(tracked), { recursive: true });
    writeFileSync(tracked, `{"v":1,"schema":"triage","created":"2026-08-08T00:00:00Z"}\n`);

    const board = await readBoardItems(tracked, "proj-noorigin");
    expect(board.origin.writesRouteToOutbox).toBe(false);
  });

  it("reflects a branch switch on the very next read — no staleness window (AC9 fail-toward-disclosure; external code-review finding)", async () => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "board-read-nocache-"));
    git(workDir, ["init"]);
    git(workDir, ["config", "user.email", "t@t.t"]);
    git(workDir, ["config", "user.name", "t"]);
    git(workDir, ["commit", "--allow-empty", "-m", "init"]);
    git(workDir, ["branch", "-M", "main"]);
    git(workDir, ["remote", "add", "origin", path.join(workDir, "origin-throwaway")]);
    const tracked = path.join(workDir, ".shipwright", "triage.jsonl");
    mkdirSync(path.dirname(tracked), { recursive: true });
    writeFileSync(tracked, `{"v":1,"schema":"triage","created":"2026-08-08T00:00:00Z"}\n`);

    expect((await readBoardItems(tracked, "proj-nocache")).origin.writesRouteToOutbox).toBe(true);

    git(workDir, ["checkout", "-b", "iterate/x"]);
    // Immediately reflected — nothing is cached, so the very next read already
    // sees the switch, never a stale `true` that would suppress the AC9
    // disclosure banner after HEAD has actually moved off the default branch.
    expect((await readBoardItems(tracked, "proj-nocache")).origin.writesRouteToOutbox).toBe(
      false,
    );
  });
});
