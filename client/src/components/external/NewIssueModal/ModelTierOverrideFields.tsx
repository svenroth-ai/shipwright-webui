import { useModelTierConfig } from "../../../hooks/useModelTierConfig";
import type { RenderableParamSchema } from "../../../types/action-schema";
import type { Dispatch, SetStateAction } from "react";

import { FieldLabel } from "./FieldLabel";
import { isModelOverrideField } from "./modelTierOverrideSchema";
import type { RuntimeValue } from "../RuntimeToggle";

type OverrideParameterName = "plan-review-model" | "review-model";

type TierRole = "plan_review" | "review";

/**
 * iterate-2026-09-17-codex-model-tier-parameterization, revised 2026-09-18
 * after shipwright#771 — the closed catalog enum was withdrawn (see
 * `server/src/external/launch/parse-body.ts`'s `CODEX_MODEL_SLUG_PATTERN`
 * doc comment for why). This field is now free text, validated
 * server-side by the same syntactic allowlist. Storage key reserved in
 * `paramValues` — see the iterate spec's client-scope "Storage decided"
 * note for why this reuses the existing generic paramValues/setParamValues
 * props instead of a new state slice threaded through useNewIssueForm.ts.
 */
export const CODEX_IMPLEMENTATION_MODEL_PARAM_KEY = "codex-implementation-model";
/**
 * iterate-2026-09-19-codex-reviewer-fields (follow-up to shipwright#471,
 * unblocked by shipwright#772) — session-scoped Codex review-model
 * overrides, same free-text/body-only/never-persisted posture as the
 * implementation-model override above. Replaces the read-only "Reviewer
 * identity" display: these are real overrides, not a project-config
 * mirror. Layout mirrors the Claude branch below — left = Plan review,
 * right = Review. Read server-side by `parse-body.ts` and threaded to
 * `buildCodexCommands` as `SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL` /
 * `SHIPWRIGHT_CODEX_REVIEW_MODEL` env-var prefixes ahead of the actual
 * `codex` invocation — `run_codex_review` resolves those env vars before
 * falling back to the project's `shipwright_model_config.json`.
 */
export const CODEX_PLAN_REVIEW_MODEL_PARAM_KEY = "codex-plan-review-model";
export const CODEX_REVIEW_MODEL_PARAM_KEY = "codex-review-model";

/** Mirrors `server/src/external/launch/parse-body.ts`'s
 *  `CODEX_MODEL_SLUG_PATTERN` verbatim (DO-NOT #7 forbids importing it
 *  directly) — used only for an inline, best-effort hint; the server is
 *  the actual gate. */
const CODEX_MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
}: ModelTierOverrideFieldsProps) {
  const { data, isError, isLoading } = useModelTierConfig(projectId);
  const supportedFields = fields.filter(isModelOverrideField);
  const defaultStatus = projectDefaultStatus(projectId, data, isLoading, isError);

  if (runtime === "codex") {
    return (
      <div className="flex flex-col gap-3" data-testid="model-tier-override-fields">
        <CodexModelField
          paramKey={CODEX_IMPLEMENTATION_MODEL_PARAM_KEY}
          label="Implementation model"
          placeholder="Suggested policy (AGENTS.md) — gpt-5.6-terra"
          paramValues={paramValues}
          setParamValues={setParamValues}
          setParamEnabled={setParamEnabled}
        />
        <div className="grid grid-cols-2 gap-3">
          <CodexModelField
            paramKey={CODEX_PLAN_REVIEW_MODEL_PARAM_KEY}
            label="Plan review"
            placeholder="e.g. gpt-5.6-sol"
            paramValues={paramValues}
            setParamValues={setParamValues}
            setParamEnabled={setParamEnabled}
          />
          <CodexModelField
            paramKey={CODEX_REVIEW_MODEL_PARAM_KEY}
            label="Review"
            placeholder="e.g. gpt-5.6-sol"
            paramValues={paramValues}
            setParamValues={setParamValues}
            setParamEnabled={setParamEnabled}
          />
        </div>
      </div>
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

/**
 * Shared free-text Codex model-slug input — backs Implementation model,
 * Plan review and Review alike. Inline best-effort shape hint only; the
 * server (`CODEX_MODEL_SLUG_PATTERN` in `parse-body.ts`) is the real gate.
 */
function CodexModelField({
  paramKey,
  label,
  placeholder,
  paramValues,
  setParamValues,
  setParamEnabled,
}: {
  paramKey: string;
  label: string;
  placeholder: string;
  paramValues: Record<string, string | boolean>;
  setParamValues: Dispatch<SetStateAction<Record<string, string | boolean>>>;
  setParamEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const value = paramValues[paramKey];
  const text = typeof value === "string" ? value : "";
  const trimmed = text.trim();
  const isInvalidShape = trimmed.length > 0 && !CODEX_MODEL_SLUG_PATTERN.test(trimmed);
  return (
    <FieldLabel label={label} hint="only for this session">
      <input
        type="text"
        value={text}
        onChange={(event) => {
          const nextValue = event.target.value;
          setParamValues((previous) => ({ ...previous, [paramKey]: nextValue }));
          setParamEnabled((previous) => ({
            ...previous,
            [paramKey]: nextValue.trim() !== "",
          }));
        }}
        placeholder={placeholder}
        className={`w-full rounded-[var(--radius-button,8px)] border-[1.5px] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)] ${
          isInvalidShape
            ? "border-[var(--color-error,#DC2626)]"
            : "border-[var(--color-border,#e0dbd4)]"
        }`}
        data-testid={`model-tier-override-${paramKey}`}
      />
      {isInvalidShape && (
        <p
          className="text-[11px] text-[var(--color-error,#DC2626)]"
          data-testid={`${paramKey}-hint`}
        >
          Letters, digits, {"."} _ - only (no spaces) — the launch will be
          rejected otherwise.
        </p>
      )}
    </FieldLabel>
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
