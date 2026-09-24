/*
 * The Codex-runtime branch of ModelTierOverrideFields — split out
 * (Codextender integration Part B.5) once the parent crossed the 300-line
 * guideline. Free-text Codex/Codextender model-slug inputs (Implementation
 * model / Plan review / Review), backed by a shared `<datalist>` whose
 * source depends on `codexIntegrationMode`.
 */
import type { Dispatch, SetStateAction } from "react";

import { FieldLabel } from "./FieldLabel";

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
 * implementation-model override above.
 */
export const CODEX_PLAN_REVIEW_MODEL_PARAM_KEY = "codex-plan-review-model";
export const CODEX_REVIEW_MODEL_PARAM_KEY = "codex-review-model";

/** Mirrors `server/src/external/launch/parse-body.ts`'s
 *  `CODEX_MODEL_SLUG_PATTERN` verbatim (DO-NOT #7 forbids importing it
 *  directly) — used only for an inline, best-effort hint; the server is
 *  the actual gate. */
const CODEX_MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Codextender integration Part B.5 (mid-run user clarification, 2026-09-23)
 * — a Codextender-only operator has no other way to guess a valid alias
 * (unlike Codex Light, where `codex debug models` is available to run by
 * hand), so an unreachable proxy falls back to these instead of an empty
 * datalist. Codex Light's own empty-list behavior is intentionally
 * unchanged.
 */
const STATIC_CODEXTENDER_MODEL_SUGGESTIONS = [
  { slug: "sol", display_name: "sol" },
  { slug: "astra", display_name: "astra" },
];

export function CodexModelOverrideFields({
  datalistId,
  isCodextender,
  liveModels,
  catalogStatus,
  paramValues,
  setParamValues,
  setParamEnabled,
}: {
  datalistId: string;
  isCodextender: boolean;
  liveModels: { slug: string; display_name: string }[];
  catalogStatus: "ok" | "stale" | "unavailable" | undefined;
  paramValues: Record<string, string | boolean>;
  setParamValues: Dispatch<SetStateAction<Record<string, string | boolean>>>;
  setParamEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  // Codextender-only fallback (Part B.5) — Codex Light's own empty-list
  // behavior for "stale"/"unavailable" is unchanged.
  const models =
    isCodextender && liveModels.length === 0 ? STATIC_CODEXTENDER_MODEL_SUGGESTIONS : liveModels;
  const fieldProps = { paramValues, setParamValues, setParamEnabled, datalistId };

  return (
    <div className="flex flex-col gap-3" data-testid="model-tier-override-fields">
      <datalist id={datalistId}>
        {models.map((model) => (
          <option key={model.slug} value={model.slug} label={model.display_name} />
        ))}
      </datalist>
      <CodexModelField
        paramKey={CODEX_IMPLEMENTATION_MODEL_PARAM_KEY}
        label="Implementation model"
        placeholder={isCodextender ? "e.g. sol" : "Suggested policy (AGENTS.md) — gpt-5.6-terra"}
        {...fieldProps}
      />
      <div className="grid grid-cols-2 gap-3">
        <CodexModelField
          paramKey={CODEX_PLAN_REVIEW_MODEL_PARAM_KEY}
          label="Plan review"
          placeholder={isCodextender ? "e.g. sol" : "e.g. gpt-5.6-sol"}
          disabled={isCodextender}
          {...fieldProps}
        />
        <CodexModelField
          paramKey={CODEX_REVIEW_MODEL_PARAM_KEY}
          label="Review"
          placeholder={isCodextender ? "e.g. sol" : "e.g. gpt-5.6-sol"}
          disabled={isCodextender}
          {...fieldProps}
        />
      </div>
      {isCodextender && (
        <p
          className="text-[11px] text-[var(--body,#44403c)]"
          data-testid="codextender-review-inherit-note"
        >
          Reviews automatically follow the main model under Codextender.
        </p>
      )}
      {!isCodextender && (catalogStatus === "stale" || catalogStatus === "unavailable") && (
        <p
          className="text-[11px] text-[var(--body,#44403c)]"
          role="status"
          data-testid="codex-model-catalog-status"
        >
          {catalogStatus === "stale"
            ? "Model list may be out of date — you can still type any slug."
            : "Model suggestions unavailable — you can still type any slug."}
        </p>
      )}
      {isCodextender && catalogStatus !== "ok" && (
        <p
          className="text-[11px] text-[var(--body,#44403c)]"
          role="status"
          data-testid="codextender-model-catalog-status"
        >
          {catalogStatus === "stale"
            ? "Model list may be out of date — you can still type any slug."
            : "Codextender proxy isn't reachable — showing default suggestions; you can still type any slug."}
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
  datalistId,
  disabled,
}: {
  paramKey: string;
  label: string;
  placeholder: string;
  paramValues: Record<string, string | boolean>;
  setParamValues: Dispatch<SetStateAction<Record<string, string | boolean>>>;
  setParamEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
  /** Shared `<datalist>` id from the parent — turns the free-text input into
   *  a combobox suggesting live catalog slugs, without restricting input to
   *  them (`<input list>` always still accepts arbitrary text). */
  datalistId: string;
  /** Codextender review-model gap fix — `buildCodextenderCommands`
   *  (`server/src/core/launcher-codextender.ts`) never reads a plan-review
   *  or review model override, so under Codextender any value typed here
   *  would be silently dropped at launch. Disabled (not hidden) rather than
   *  removed, so the field's placement stays stable if a caller returns to
   *  Codex Light. */
  disabled?: boolean;
}) {
  const value = paramValues[paramKey];
  const text = typeof value === "string" ? value : "";
  const trimmed = text.trim();
  const isInvalidShape = trimmed.length > 0 && !CODEX_MODEL_SLUG_PATTERN.test(trimmed);
  return (
    <FieldLabel label={label} hint="only for this session">
      <input
        type="text"
        list={datalistId}
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
        disabled={disabled}
        className={`w-full rounded-[var(--radius-button,8px)] border-[1.5px] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)] disabled:cursor-not-allowed disabled:opacity-60 ${
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
