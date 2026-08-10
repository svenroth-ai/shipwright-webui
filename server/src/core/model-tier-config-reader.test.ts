import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readModelTierConfig } from "./model-tier-config-reader.js";

const roots: string[] = [];
function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "shipwright-model-config-"));
  roots.push(root);
  return root;
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("readModelTierConfig", () => {
  it("uses explicit valid per-role defaults and inherits unset roles", () => {
    const root = projectRoot();
    writeFileSync(join(root, "shipwright_model_config.json"), JSON.stringify({ review: "opus", execution: "sonnet" }));

    expect(readModelTierConfig(root)).toEqual({
      tiers: {
        plan_review: { tier: "inherit", source: "unset" },
        review: { tier: "opus", source: "project_config" },
        finalization: { tier: "inherit", source: "unset" },
        execution: { tier: "sonnet", source: "project_config" },
      },
    });
  });

  it("visibly marks a missing config while keeping every role inherited", () => {
    const result = readModelTierConfig(projectRoot());

    expect(result.warning).toBe("model_config_missing");
    expect(Object.values(result.tiers).every(({ tier }) => tier === "inherit")).toBe(true);
  });

  it("fails soft to inherited tiers when the framework config is malformed", () => {
    const root = projectRoot();
    writeFileSync(join(root, "shipwright_model_config.json"), "{");

    const result = readModelTierConfig(root);
    expect(result.warning).toBe("model_config_unreadable");
    expect(Object.values(result.tiers).every(({ tier }) => tier === "inherit")).toBe(true);
  });

  it("warns when a recognized role has an unsupported value", () => {
    const root = projectRoot();
    writeFileSync(join(root, "shipwright_model_config.json"), JSON.stringify({ review: "opuss" }));

    const result = readModelTierConfig(root);
    expect(result.warning).toBe("model_config_invalid");
    expect(result.tiers.review).toEqual({ tier: "inherit", source: "unset" });
  });

  it("uses the main-worktree config rather than a divergent linked-worktree copy", () => {
    const root = projectRoot();
    const linked = join(root, "linked");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("init");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    writeFileSync(join(root, "tracked.txt"), "fixture\n");
    writeFileSync(join(root, "shipwright_model_config.json"), JSON.stringify({ review: "opus" }));
    git("add", ".");
    git("commit", "-m", "fixture");
    git("worktree", "add", "-b", "linked-branch", linked);
    writeFileSync(join(linked, "shipwright_model_config.json"), JSON.stringify({ review: "haiku" }));

    expect(readModelTierConfig(linked).tiers.review).toEqual({
      tier: "opus",
      source: "project_config",
    });
  });

  it("ignores inherited Git directory overrides when resolving a linked worktree", () => {
    const root = projectRoot();
    const linked = join(root, "linked");
    const conflicting = join(root, "conflicting");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("init");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    writeFileSync(join(root, "tracked.txt"), "fixture\n");
    writeFileSync(join(root, "shipwright_model_config.json"), JSON.stringify({ review: "opus" }));
    git("add", ".");
    git("commit", "-m", "fixture");
    git("worktree", "add", "-b", "linked-branch", linked);
    writeFileSync(join(linked, "shipwright_model_config.json"), JSON.stringify({ review: "haiku" }));
    execFileSync("git", ["init", conflicting], { stdio: "ignore" });

    const originalGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(conflicting, ".git");
    try {
      expect(readModelTierConfig(linked).tiers.review).toEqual({
        tier: "opus",
        source: "project_config",
      });
    } finally {
      if (originalGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = originalGitDir;
    }
  });

  it("never reads a divergent linked-worktree config when Git cannot identify its main worktree", () => {
    const root = projectRoot();
    const linked = join(root, "linked");
    const metadata = join(projectRoot(), "metadata");
    execFileSync("git", ["init", `--separate-git-dir=${metadata}`, root], { stdio: "ignore" });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    writeFileSync(join(root, "tracked.txt"), "fixture\n");
    writeFileSync(join(root, "shipwright_model_config.json"), JSON.stringify({ review: "opus" }));
    git("add", ".");
    git("commit", "-m", "fixture");
    git("worktree", "add", "-b", "separate-git-linked", linked);
    writeFileSync(join(linked, "shipwright_model_config.json"), JSON.stringify({ review: "haiku" }));

    const result = readModelTierConfig(linked);
    expect(result.warning).toBe("model_config_unreadable");
    expect(result.tiers.review).toEqual({ tier: "inherit", source: "unset" });
  });
});
