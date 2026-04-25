/*
 * Schema-driven parameter field for the NewIssueModal "Advanced parameters"
 * collapsible. Renders one of three controls based on schema.type:
 *   - boolean → Radix Checkbox + label (consolidated: checked = enable + value)
 *   - enum    → Native <select> (project doesn't have Radix Select wired
 *               yet; switching later is a 1-LOC swap)
 *   - string  → <input>; sensitive: true → type=password with reveal toggle
 *
 * Plan v0.3 P1 + P5 (iterate/v030-five-ux-fixes):
 *   - Explicit enable-checkbox per string/enum field (when onEnableToggle
 *     is provided). Boolean stays consolidated. Required fields render a
 *     "Required" badge in place of the enable-checkbox (always emitted).
 *   - Auto-helpText "If omitted: …" when no explicit helpText is provided.
 *     Sensitive defaults are NEVER surfaced through the auto-text.
 *   - Inline muted hint "Value empty — flag will not be emitted" when
 *     enabled + non-required + value blank, to make skip-emit semantics
 *     visible without the user needing to open the live preview.
 *   - a11y: aria-describedby chains the enable-checkbox to the helpText
 *     and the value-control gets aria-disabled when enabled=false.
 *
 * Backward-compat: when `onEnableToggle` is undefined, the field renders
 * without the enable-checkbox (legacy "always editable" behavior). This
 * keeps existing call sites working until they migrate.
 */

import { useId } from "react";
import { Eye, EyeOff } from "lucide-react";

import type { RenderableParamSchema } from "../../types/action-schema";

export interface ParamFieldProps {
  schema: RenderableParamSchema;
  /** Current value. boolean → bool; enum/string → string. undefined when untouched. */
  value: string | boolean | undefined;
  onChange: (next: string | boolean) => void;
  /** Reveal-secret toggle is hoisted to the modal so it can reset on regenerations. */
  revealed?: boolean;
  onRevealToggle?: () => void;
  /** Required-empty hint when the field is required and the value is empty. */
  showRequiredError?: boolean;
  /**
   * iterate/v030-five-ux-fixes (P1) — explicit enable state for the
   * field. When `onEnableToggle` is provided, an enable-checkbox renders
   * to the left of the value-control (string/enum only). Required fields
   * render a "Required" badge instead — they are always enabled.
   *
   * Defaults to `true` so legacy callers without enable-state work.
   */
  enabled?: boolean;
  /**
   * Toggle the enable-checkbox. When undefined, the enable-checkbox does
   * NOT render (legacy mode) and the value-control is always editable.
   */
  onEnableToggle?: () => void;
}

/**
 * Build the auto-helpText that explains what happens when the field is
 * NOT enabled / left blank. Only fires for non-required fields without
 * an explicit helpText. Sensitive defaults are deliberately omitted —
 * exposing them through hint text would defeat the masking elsewhere.
 */
function autoHelpText(schema: RenderableParamSchema): string | undefined {
  if (schema.required) return undefined;
  if (schema.helpText) return undefined;
  if (
    schema.default !== undefined &&
    !schema.sensitive &&
    typeof schema.default !== "object"
  ) {
    return `If omitted: schema default is ${String(
      schema.default,
    )}; skill may apply its own default.`;
  }
  return "If omitted: skill applies its own default.";
}

export function ParamField({
  schema,
  value,
  onChange,
  revealed,
  onRevealToggle,
  showRequiredError,
  enabled = true,
  onEnableToggle,
}: ParamFieldProps) {
  const inputId = useId();
  const helpId = useId();
  const enableId = useId();

  const effectiveHelpText = schema.helpText ?? autoHelpText(schema);

  if (schema.type === "boolean") {
    return (
      <div className="flex items-start gap-2.5" data-testid={`paramfield-${schema.name}`}>
        <input
          id={inputId}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={effectiveHelpText ? helpId : undefined}
          className="mt-0.5 h-[16px] w-[16px] flex-shrink-0 cursor-pointer rounded-[4px] border-[1.5px] border-[var(--color-border,#e0dbd4)] accent-[var(--color-primary,#6b5e56)]"
        />
        <label htmlFor={inputId} className="select-none">
          <span className="text-[13px] font-medium text-[var(--color-text,#1a1a1a)]">
            {schema.label}
          </span>
          {effectiveHelpText && (
            <span
              id={helpId}
              className="block text-[11px] leading-[1.4] text-[var(--color-muted,#6b7280)]"
            >
              {effectiveHelpText}
            </span>
          )}
        </label>
      </div>
    );
  }

  // String + Enum share the enable-checkbox + value-control layout.
  const stringValue = typeof value === "string" ? value : "";
  const isSensitive = !!schema.sensitive;
  const showAsPassword = isSensitive && !revealed;
  const isRequired = !!schema.required;
  const showEnableToggle = !!onEnableToggle && !isRequired;
  const valueDisabled = !!onEnableToggle && !enabled && !isRequired;
  const trimmedValue = stringValue.trim();
  // The boolean branch above already returned; here we know we're on
  // string/enum, so the type-guard would be redundant.
  const showEmptyHint =
    !!onEnableToggle && enabled && !isRequired && trimmedValue === "";

  // iterate/fix-adopt-prompt-shape — Default appears as placeholder hint
  // when no explicit placeholder is set. Sensitive defaults are NEVER
  // surfaced as placeholders.
  const placeholderHint =
    schema.placeholder ??
    (!isSensitive && schema.default !== undefined
      ? `default: ${schema.default}`
      : undefined);

  const enableSlot = (
    <div className="flex h-[28px] w-[60px] flex-shrink-0 items-center pt-0">
      {showEnableToggle ? (
        <input
          id={enableId}
          type="checkbox"
          checked={enabled}
          onChange={onEnableToggle}
          aria-describedby={effectiveHelpText ? helpId : undefined}
          aria-controls={inputId}
          aria-label={`Enable ${schema.label}`}
          data-testid={`paramfield-${schema.name}-enable`}
          className="h-[16px] w-[16px] cursor-pointer rounded-[4px] border-[1.5px] border-[var(--color-border,#e0dbd4)] accent-[var(--color-primary,#6b5e56)]"
        />
      ) : isRequired ? (
        <span
          data-testid={`paramfield-${schema.name}-required-badge`}
          className="rounded-[4px] bg-[var(--color-error-bg,#FEE2E2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-error,#DC2626)]"
        >
          Required
        </span>
      ) : null}
    </div>
  );

  if (schema.type === "enum") {
    const enumOptions = schema.enum ?? [];
    return (
      <div className="flex items-start gap-2" data-testid={`paramfield-${schema.name}`}>
        {enableSlot}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            htmlFor={inputId}
            className="text-[12px] font-medium text-[var(--color-text,#1a1a1a)]"
          >
            {schema.label}
            {isRequired && <span className="ml-0.5 text-[var(--color-error,#DC2626)]">*</span>}
          </label>
          <select
            id={inputId}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={effectiveHelpText ? helpId : undefined}
            aria-disabled={valueDisabled || undefined}
            disabled={valueDisabled}
            className={`w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)] ${
              valueDisabled ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            {/* iterate/fix-adopt-prompt-shape — opt-in for ALL param types.
                Enum dropdown ALWAYS starts at Select…, even when default is
                defined. The user must explicitly pick to emit a flag. */}
            <option value="">
              {schema.default !== undefined
                ? `Select… (default: ${schema.default})`
                : "Select…"}
            </option>
            {enumOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {effectiveHelpText && (
            <span
              id={helpId}
              className="text-[11px] leading-[1.4] text-[var(--color-muted,#6b7280)]"
            >
              {effectiveHelpText}
            </span>
          )}
          {showEmptyHint && (
            <span
              data-testid={`paramfield-${schema.name}-empty-hint`}
              className="text-[11px] italic text-[var(--color-muted,#6b7280)]"
            >
              Value empty — flag will not be emitted
            </span>
          )}
          {showRequiredError && (
            <span className="text-[11px] text-[var(--color-error,#DC2626)]">
              Required
            </span>
          )}
        </div>
      </div>
    );
  }

  // String — sensitive renders password input with reveal toggle.
  return (
    <div className="flex items-start gap-2" data-testid={`paramfield-${schema.name}`}>
      {enableSlot}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label
          htmlFor={inputId}
          className="text-[12px] font-medium text-[var(--color-text,#1a1a1a)]"
        >
          {schema.label}
          {isRequired && <span className="ml-0.5 text-[var(--color-error,#DC2626)]">*</span>}
        </label>
        <div className="relative flex items-stretch">
          <input
            id={inputId}
            type={showAsPassword ? "password" : "text"}
            value={stringValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholderHint}
            disabled={valueDisabled}
            aria-disabled={valueDisabled || undefined}
            // `new-password` is the most defensive autocomplete value: most
            // browsers respect it for sensitive fields and skip the password
            // manager + autofill stash. `off` is widely ignored.
            autoComplete={isSensitive ? "new-password" : undefined}
            aria-describedby={effectiveHelpText ? helpId : undefined}
            aria-invalid={showRequiredError ? "true" : undefined}
            className={`w-full rounded-[var(--radius-button,8px)] border-[1.5px] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)] ${
              showRequiredError
                ? "border-[var(--color-error,#DC2626)]"
                : "border-[var(--color-border,#e0dbd4)]"
            } ${isSensitive ? "pr-8 font-mono" : ""} ${
              valueDisabled ? "cursor-not-allowed bg-[var(--color-muted-bg,#ede8e1)] opacity-60" : ""
            }`}
          />
          {isSensitive && onRevealToggle && (
            <button
              type="button"
              onClick={onRevealToggle}
              disabled={valueDisabled}
              aria-label={revealed ? "Hide value" : "Reveal value"}
              data-testid={`paramfield-${schema.name}-reveal`}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[4px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
        </div>
        {effectiveHelpText && (
          <span
            id={helpId}
            className="text-[11px] leading-[1.4] text-[var(--color-muted,#6b7280)]"
          >
            {effectiveHelpText}
          </span>
        )}
        {showEmptyHint && (
          <span
            data-testid={`paramfield-${schema.name}-empty-hint`}
            className="text-[11px] italic text-[var(--color-muted,#6b7280)]"
          >
            Value empty — flag will not be emitted
          </span>
        )}
        {showRequiredError && (
          <span className="text-[11px] text-[var(--color-error,#DC2626)]">
            Required
          </span>
        )}
      </div>
    </div>
  );
}
