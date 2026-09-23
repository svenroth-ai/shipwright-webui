import { httpJson } from "./externalApi";

export interface CodextenderModelEntry {
  slug: string;
  display_name: string;
}

export interface CodextenderModelsResponse {
  status: "ok" | "stale" | "unavailable";
  models: CodextenderModelEntry[];
}

/** Codextender integration Part B.5 — mirrors `codexModelsApi.ts`'s
 *  `getCodexModels`, sourced from the local proxy's own `/v1/models`
 *  instead of a `codex debug models` CLI shell-out. */
export function getCodextenderModels(): Promise<CodextenderModelsResponse> {
  return httpJson("/api/codextender-models");
}
