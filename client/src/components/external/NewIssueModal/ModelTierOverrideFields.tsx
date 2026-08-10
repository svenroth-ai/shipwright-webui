import { useModelTierConfig } from "../../../hooks/useModelTierConfig";
import type { RenderableParamSchema } from "../../../types/action-schema";
import type { Dispatch, SetStateAction } from "react";

import { FieldLabel } from "./FieldLabel";
import { isModelOverrideField } from "./modelTierOverrideSchema";

type OverrideParameterName = "plan-review-model" | "review-model";

type TierRole = "plan_review" | "review";

interface ModelTierOverrideFieldsProps {
  fields: RenderableParamSchema[];
  projectId: string | undefined;
  paramValues: Record<string, string | boolean>;
  setParamValues: Dispatch<SetStateAction<Record<string, string | boolean>>>;
  setParamEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
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
}: ModelTierOverrideFieldsProps) {
  const { data, isError, isLoading } = useModelTierConfig(projectId);
  const supportedFields = fields.filter(isModelOverrideField);
  const defaultStatus = projectDefaultStatus(projectId, data, isLoading, isError);
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
