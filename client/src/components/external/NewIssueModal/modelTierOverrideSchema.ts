import type { RenderableParamSchema } from "../../../types/action-schema";

export const MODEL_OVERRIDE_PARAMETER_NAMES = [
  "plan-review-model",
  "review-model",
] as const;

const UNSUPPORTED_MODEL_OVERRIDE_PARAMETER_NAMES = [
  "finalization-model",
  "execution-model",
] as const;

type OverrideParameterName = (typeof MODEL_OVERRIDE_PARAMETER_NAMES)[number];

export function isModelOverrideField(
  field: RenderableParamSchema,
): field is RenderableParamSchema & { name: OverrideParameterName } {
  return (
    (MODEL_OVERRIDE_PARAMETER_NAMES as readonly string[]).includes(field.name) &&
    field.type === "enum" &&
    Array.isArray(field.enum) &&
    typeof field.cli_flag === "string"
  );
}

export function isUnsupportedModelOverrideField(
  field: RenderableParamSchema,
): boolean {
  return (
    (UNSUPPORTED_MODEL_OVERRIDE_PARAMETER_NAMES as readonly string[]).includes(field.name) &&
    field.type === "enum" &&
    Array.isArray(field.enum) &&
    typeof field.cli_flag === "string"
  );
}

export function isIterateModelTierField(field: RenderableParamSchema): boolean {
  return isModelOverrideField(field) || isUnsupportedModelOverrideField(field);
}
