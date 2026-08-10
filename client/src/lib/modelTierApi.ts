import { EXTERNAL_API, httpJson } from "./externalApi";

export type ModelTierRole = "plan_review" | "review" | "finalization" | "execution";
export type ModelTier = "opus" | "sonnet" | "haiku" | "inherit";
export interface ModelTierConfigResponse {
  tiers: Record<ModelTierRole, { tier: ModelTier; source: "project_config" | "unset" }>;
  warning?: "model_config_missing" | "model_config_unreadable" | "model_config_invalid";
}

export function getModelTierConfig(projectId: string): Promise<ModelTierConfigResponse> {
  return httpJson(`${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/model-config`);
}
