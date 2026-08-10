/*
 * Read-only reader for the framework-owned shipwright_model_config.json.
 *
 * The file is deliberately resolved from the main Git worktree so a linked
 * worktree cannot display a stale copy. Missing or malformed configuration is
 * fail-soft: every role inherits the invoking session's model, which matches
 * the framework resolver's default behavior.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const MODEL_TIER_ROLES = [
  "plan_review",
  "review",
  "finalization",
  "execution",
] as const;

export type ModelTierRole = (typeof MODEL_TIER_ROLES)[number];
export type ModelTier = "opus" | "sonnet" | "haiku" | "inherit";
export type ModelTierSource = "project_config" | "unset";

export interface EffectiveModelTier {
  tier: ModelTier;
  source: ModelTierSource;
}

export interface ModelTierConfigReadResult {
  tiers: Record<ModelTierRole, EffectiveModelTier>;
  /** A safe, operator-facing warning; it never contains raw config content. */
  warning?: "model_config_missing" | "model_config_unreadable" | "model_config_invalid";
}

const FILENAME = "shipwright_model_config.json";
const VALID_TIERS = new Set<ModelTier>(["opus", "sonnet", "haiku", "inherit"]);

function inheritedTiers(): Record<ModelTierRole, EffectiveModelTier> {
  return Object.fromEntries(
    MODEL_TIER_ROLES.map((role) => [role, { tier: "inherit", source: "unset" }]),
  ) as Record<ModelTierRole, EffectiveModelTier>;
}

export function resolveModelConfigRoot(projectPath: string): string | undefined {
  const {
    GIT_COMMON_DIR: _gitCommonDir,
    GIT_DIR: _gitDir,
    GIT_INDEX_FILE: _gitIndexFile,
    GIT_WORK_TREE: _gitWorkTree,
    ...gitEnvironment
  } = process.env;

  let worktrees: string;
  try {
    worktrees = execFileSync(
      "git",
      ["worktree", "list", "--porcelain"],
      {
        cwd: projectPath,
        encoding: "utf-8",
        env: gitEnvironment,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    // Non-Git projects keep the existing fail-soft project-root behavior.
    return projectPath;
  }

  try {
    const primaryWorktree = worktrees
      .split(/\r?\n/)
      .find((line) => line.startsWith("worktree "))
      ?.slice("worktree ".length);
    if (primaryWorktree && statSync(primaryWorktree).isDirectory() && existsSync(join(primaryWorktree, ".git"))) {
      return primaryWorktree;
    }
    // `git init --separate-git-dir` can report the metadata directory as the
    // primary worktree. Its original checkout is not discoverable from a linked
    // worktree, so returning the linked path would risk reading divergent config.
    return undefined;
  } catch {
    // Git identified a worktree layout but its primary checkout is unusable.
    // Do not fall back to a linked worktree's possibly divergent config.
    return undefined;
  }
}

export function readModelTierConfig(projectPath: string): ModelTierConfigReadResult {
  const tiers = inheritedTiers();
  const root = resolveModelConfigRoot(projectPath);
  if (!root) return { tiers, warning: "model_config_unreadable" };
  const path = join(root, FILENAME);
  if (!existsSync(path)) return { tiers, warning: "model_config_missing" };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { tiers, warning: "model_config_unreadable" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { tiers, warning: "model_config_invalid" };
  }

  let invalidRoleValue = false;
  for (const role of MODEL_TIER_ROLES) {
    const candidate = (raw as Record<string, unknown>)[role];
    if (typeof candidate === "string" && VALID_TIERS.has(candidate as ModelTier)) {
      tiers[role] = { tier: candidate as ModelTier, source: "project_config" };
    } else if (candidate !== undefined) {
      invalidRoleValue = true;
    }
  }
  return invalidRoleValue ? { tiers, warning: "model_config_invalid" } : { tiers };
}
