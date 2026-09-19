import { httpJson } from "./externalApi";

export interface CodexModelCatalogEntry {
  slug: string;
  display_name: string;
}

export interface CodexModelsResponse {
  status: "ok" | "stale" | "unavailable";
  models: CodexModelCatalogEntry[];
}

/** Global endpoint, not project-scoped — the Codex CLI's catalog isn't
 *  per-project, so this is a bare `/api/*` route (mirrors `/api/readiness`),
 *  not one under `EXTERNAL_API` (`/api/external/...`). */
export function getCodexModels(): Promise<CodexModelsResponse> {
  return httpJson("/api/codex-models");
}
