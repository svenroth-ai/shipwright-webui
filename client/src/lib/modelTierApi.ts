import { EXTERNAL_API, httpJson } from "./externalApi";

export type ModelTierRole = "plan_review" | "review" | "finalization" | "execution";
export type ModelTier = "opus" | "sonnet" | "haiku" | "fable" | "inherit";
/** shipwright#771 — read-only Codex-reviewer-identity keys, present only
 *  when at least one is configured in `shipwright_model_config.json`. */
export type CodexReviewerRole = "codex_review" | "codex_plan_review";
export interface ModelTierConfigResponse {
  tiers: Record<ModelTierRole, { tier: ModelTier; source: "project_config" | "unset" }>;
  codex?: Partial<Record<CodexReviewerRole, string>>;
  warning?: "model_config_missing" | "model_config_unreadable" | "model_config_invalid";
}

export function getModelTierConfig(projectId: string): Promise<ModelTierConfigResponse> {
  return httpJson(`${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/model-config`);
}
