import { useId } from "react";

import { useCodexModels } from "../../../hooks/useCodexModels";
import { useCodextenderModels } from "../../../hooks/useCodextenderModels";
import { useModelTierConfig } from "../../../hooks/useModelTierConfig";
import type { RenderableParamSchema } from "../../../types/action-schema";
import type { Dispatch, SetStateAction } from "react";

import { CodexModelOverrideFields } from "./CodexModelOverrideFields";
import { FieldLabel } from "./FieldLabel";
import { isModelOverrideField } from "./modelTierOverrideSchema";
import type { RuntimeValue } from "../RuntimeToggle";

/** Re-exported for `useNewIssueFormSubmit.ts` — the param-key constants
 *  moved to `CodexModelOverrideFields.tsx` with the rest of the
 *  Codex-runtime branch (Codextender integration Part B.5 file split),
 *  but this stays their import path. */
export {
  CODEX_PLAN_REVIEW_MODEL_PARAM_KEY,
  CODEX_REVIEW_MODEL_PARAM_KEY,
} from "./CodexModelOverrideFields";

type OverrideParameterName = "plan-review-model" | "review-model";

type TierRole = "plan_review" | "review";

interface ModelTierOverrideFieldsProps {
  fields: RenderableParamSchema[];
  projectId: string | undefined;
  paramValues: Record<string, string | boolean>;
  setParamValues: Dispatch<SetStateAction<Record<string, string | boolean>>>;
  setParamEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
  /** trg-517157fe — opus/sonnet/haiku/inherit is the Claude-only ADR-127
   *  Agent-tier axis (--review-model/--plan-review-model); it has no
   *  meaning for a Codex-driven task, whose review overrides are free-text
   *  Codex model slugs instead (see CODEX_PLAN_REVIEW_MODEL_PARAM_KEY /
   *  CODEX_REVIEW_MODEL_PARAM_KEY above). Defaults to Claude for callers
   *  that don't yet carry a runtime value (e.g. pre-Codex-Light form
   *  fixtures). */
  runtime?: RuntimeValue;
  /** Codextender integration Part B.5 — threaded down from the same
   *  `form.codexIntegrationMode` value `RuntimeFieldFragment` already
   *  receives (SimpleFields.tsx), rather than this component reading
   *  `useSettings()` a second time for the same value. Defaults to
   *  Codex Light for callers that don't yet carry it. */
  codexIntegrationMode?: "light" | "codextender";
}

const ROLE_BY_PARAMETER: Record<OverrideParameterName, TierRole> = {
  "plan-review-model": "plan_review",
  "review-model": "review",
};

export function ModelTierOverrideFields({
  fields,
  projectId,
  paramValues,
  setParamValues,
  setParamEnabled,
  runtime,
  codexIntegrationMode = "light",
}: ModelTierOverrideFieldsProps) {
  const { data, isError, isLoading } = useModelTierConfig(projectId);
  // Called unconditionally regardless of `runtime` — a conditional hook call
  // here would break React's rules of hooks the moment `runtime` differs
  // across renders (external review fix, both reviewers, 2026-09-19). The
  // FETCH stays idle for a non-Codex runtime via `enabled`; only the CALL is
  // unconditional. Codextender integration Part B.5 — same rule for the
  // second catalog hook: both are always called, only one's fetch is ever
  // enabled at a time.
  const isCodextender = codexIntegrationMode === "codextender";
  const codexCatalogId = useId();
  const codexCatalog = useCodexModels(runtime === "codex" && !isCodextender);
  const codextenderCatalog = useCodextenderModels(runtime === "codex" && isCodextender);
  const supportedFields = fields.filter(isModelOverrideField);
  const defaultStatus = projectDefaultStatus(projectId, data, isLoading, isError);

  if (runtime === "codex") {
    const datalistId = `codex-model-catalog-${codexCatalogId}`;
    const catalogStatus = isCodextender ? codextenderCatalog.data?.status : codexCatalog.data?.status;
    const liveModels = isCodextender
      ? codextenderCatalog.data?.models ?? []
      : codexCatalog.data?.models ?? [];
    return (
      <CodexModelOverrideFields
        datalistId={datalistId}
        isCodextender={isCodextender}
        liveModels={liveModels}
        catalogStatus={catalogStatus}
        paramValues={paramValues}
        setParamValues={setParamValues}
        setParamEnabled={setParamEnabled}
      />
    );
  }
  if (supportedFields.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3" data-testid="model-tier-override-fields">
      {supportedFields.map((field) => {
        const role = ROLE_BY_PARAMETER[field.name];
        const defaultTier = data?.tiers?.[role];
        const rawValue = paramValues[field.name];
        const value = typeof rawValue === "string" ? rawValue : "";
        return (
          <FieldLabel
            key={field.name}
            label={field.label}
            hint="only for this session"
          >
            <select
              value={value}
              onChange={(event) => {
                const nextValue = event.target.value;
                setParamValues((previous) => ({ ...previous, [field.name]: nextValue }));
                setParamEnabled((previous) => ({ ...previous, [field.name]: nextValue !== "" }));
              }}
              className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
              data-testid={`model-tier-override-${field.name}`}
            >
              <option value="">{defaultOptionLabel(defaultTier, isLoading, isError)}</option>
              {(field.enum ?? []).map((tier) => (
                <option key={tier} value={tier}>
                  {formatTier(tier)}
                </option>
              ))}
            </select>
          </FieldLabel>
        );
      })}
      {defaultStatus && (
        <p className="col-span-full text-[11px] text-[var(--body,#44403c)]" role="status" data-testid="model-tier-default-status">
          {defaultStatus}
        </p>
      )}
    </div>
  );
}

function formatTier(tier: string): string {
  return tier.slice(0, 1).toUpperCase() + tier.slice(1);
}

function defaultOptionLabel(
  tier: { tier: string; source: string } | undefined,
  isLoading: boolean,
  isError: boolean,
): string {
  if (tier?.source === "project_config") return `Project default — ${formatTier(tier.tier)}`;
  if (isLoading) return "Loading project default…";
  if (isError) return "Project default unavailable";
  return "Project default unavailable";
}

function projectDefaultStatus(
  projectId: string | undefined,
  data: { tiers?: Record<string, { source: string }> } | undefined,
  isLoading: boolean,
  isError: boolean,
): string | null {
  if (!projectId) return "Choose a project to load its defaults.";
  if (isLoading) return "Loading project defaults…";
  if (isError || !data?.tiers) return "Project defaults are unavailable; selecting a tier still applies only to this session.";
  if (data.tiers.plan_review?.source !== "project_config" || data.tiers.review?.source !== "project_config") {
    return "Project defaults are unavailable; selecting a tier still applies only to this session.";
  }
  return null;
}
