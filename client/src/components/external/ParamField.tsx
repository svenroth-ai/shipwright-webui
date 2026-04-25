/*
 * Schema-driven parameter field for the NewIssueModal "Advanced parameters"
 * collapsible. Renders one of three controls based on schema.type:
 *   - boolean → Radix Checkbox + label
 *   - enum    → Native <select> (project doesn't have Radix Select wired
 *               yet; switching later is a 1-LOC swap)
 *   - string  → <input>; sensitive: true → type=password with reveal toggle
 *
 * Plan: iterate/launch-cli-parameters § 4.
 *
 * Required-validation messaging is rendered inline; the modal-level Copy
 * button enable check reads `required && empty` from the same schema.
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
}

export function ParamField({
  schema,
  value,
  onChange,
  revealed,
  onRevealToggle,
  showRequiredError,
}: ParamFieldProps) {
  const inputId = useId();
  const helpId = useId();

  if (schema.type === "boolean") {
    return (
      <div className="flex items-start gap-2.5" data-testid={`paramfield-${schema.name}`}>
        <input
          id={inputId}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={schema.helpText ? helpId : undefined}
          className="mt-0.5 h-[16px] w-[16px] flex-shrink-0 cursor-pointer rounded-[4px] border-[1.5px] border-[var(--color-border,#e0dbd4)] accent-[var(--color-primary,#6b5e56)]"
        />
        <label htmlFor={inputId} className="select-none">
          <span className="text-[13px] font-medium text-[var(--color-text,#1a1a1a)]">
            {schema.label}
          </span>
          {schema.helpText && (
            <span
              id={helpId}
              className="block text-[11px] leading-[1.4] text-[var(--color-muted,#6b7280)]"
            >
              {schema.helpText}
            </span>
          )}
        </label>
      </div>
    );
  }

  if (schema.type === "enum") {
    const enumOptions = schema.enum ?? [];
    return (
      <div className="flex flex-col gap-1" data-testid={`paramfield-${schema.name}`}>
        <label
          htmlFor={inputId}
          className="text-[12px] font-medium text-[var(--color-text,#1a1a1a)]"
        >
          {schema.label}
          {schema.required && <span className="ml-0.5 text-[var(--color-error,#DC2626)]">*</span>}
        </label>
        <select
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={schema.helpText ? helpId : undefined}
          className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
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
        {schema.helpText && (
          <span
            id={helpId}
            className="text-[11px] leading-[1.4] text-[var(--color-muted,#6b7280)]"
          >
            {schema.helpText}
          </span>
        )}
        {showRequiredError && (
          <span className="text-[11px] text-[var(--color-error,#DC2626)]">
            Required
          </span>
        )}
      </div>
    );
  }

  // String — sensitive renders password input with reveal toggle.
  const stringValue = typeof value === "string" ? value : "";
  const isSensitive = !!schema.sensitive;
  const showAsPassword = isSensitive && !revealed;

  // iterate/fix-adopt-prompt-shape — Default appears as placeholder hint
  // when no explicit placeholder is set. Sensitive defaults are NEVER
  // surfaced as placeholders (external review O11 — defaults could be
  // tokens in custom configs).
  const placeholderHint =
    schema.placeholder ??
    (!isSensitive && schema.default !== undefined
      ? `default: ${schema.default}`
      : undefined);
  return (
    <div className="flex flex-col gap-1" data-testid={`paramfield-${schema.name}`}>
      <label
        htmlFor={inputId}
        className="text-[12px] font-medium text-[var(--color-text,#1a1a1a)]"
      >
        {schema.label}
        {schema.required && <span className="ml-0.5 text-[var(--color-error,#DC2626)]">*</span>}
      </label>
      <div className="relative flex items-stretch">
        <input
          id={inputId}
          type={showAsPassword ? "password" : "text"}
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholderHint}
          // `new-password` is the most defensive autocomplete value: most
          // browsers respect it for sensitive fields and skip the password
          // manager + autofill stash. `off` is widely ignored (external
          // review O8).
          autoComplete={isSensitive ? "new-password" : undefined}
          aria-describedby={schema.helpText ? helpId : undefined}
          aria-invalid={showRequiredError ? "true" : undefined}
          className={`w-full rounded-[var(--radius-button,8px)] border-[1.5px] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)] ${
            showRequiredError
              ? "border-[var(--color-error,#DC2626)]"
              : "border-[var(--color-border,#e0dbd4)]"
          } ${isSensitive ? "pr-8 font-mono" : ""}`}
        />
        {isSensitive && onRevealToggle && (
          <button
            type="button"
            onClick={onRevealToggle}
            aria-label={revealed ? "Hide value" : "Reveal value"}
            data-testid={`paramfield-${schema.name}-reveal`}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[4px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]"
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {schema.helpText && (
        <span
          id={helpId}
          className="text-[11px] leading-[1.4] text-[var(--color-muted,#6b7280)]"
        >
          {schema.helpText}
        </span>
      )}
      {showRequiredError && (
        <span className="text-[11px] text-[var(--color-error,#DC2626)]">
          Required
        </span>
      )}
    </div>
  );
}
