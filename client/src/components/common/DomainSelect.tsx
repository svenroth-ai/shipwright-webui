/*
 * DomainSelect — the ONE shared domain-picker (iterate-2026-09-07-
 * leadwright-setup-wizard, W14). Used by BOTH the lead-setup wizard's
 * domain step AND `LeadwrightFields.tsx`'s converted domain field, backed
 * by the same `useDomainVocabulary()` read — closing the defect at its
 * source (previously free text on both sides, matched via exact string
 * equality, so a typo silently created an unclaimable domain).
 *
 * Style-agnostic by design: this component owns the SELECT-vs-CREATE
 * logic and the kebab-case enforcement on a new domain, not any visual
 * chrome — each consumer passes its own `className` for the select
 * (NewIssueModal's tailwind-utility inputs vs. the wizard's `wz-input`
 * idiom are too different to share one hardcoded look).
 *
 * A domain that exists on disk (via the union with existing card/lead
 * data) but fails `LEAD_ID_RE` — a legacy free-text value from before this
 * fix — is listed but NOT selectable, with an inline explanation, rather
 * than letting the user pick a value the verdict step would always reject
 * (external-review finding, openai, low severity).
 *
 * `unavailable` degrades to a plain free-text input (the field's PRE-this-
 * card behavior) when the vocabulary fetch failed — a `<select>` with a
 * possibly-empty option list must never be the only way to fill a field
 * that worked fine as free text before this feature existed (spec-review
 * fix: NewIssueModal must not regress on a `GET /api/org/domains` failure).
 */
import { useState } from "react";

import { LEAD_ID_RE } from "../../lib/leadSetupWizardApi";

const CREATE_NEW_VALUE = "__create_new__";

export interface DomainSelectProps {
  value: string;
  onChange: (domain: string) => void;
  domains: string[];
  unclaimedCounts?: Record<string, number>;
  className?: string;
  createInputClassName?: string;
  testIdPrefix?: string;
  /** True when the vocabulary fetch itself failed — degrades to a plain
   *  free-text input rather than a select nobody can populate. */
  unavailable?: boolean;
}

export function DomainSelect({
  value,
  onChange,
  domains,
  unclaimedCounts,
  className,
  createInputClassName,
  testIdPrefix = "domain-select",
  unavailable = false,
}: DomainSelectProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const draftValid = draft.length > 0 && LEAD_ID_RE.test(draft);

  if (unavailable) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="domain"
        data-testid={`${testIdPrefix}-unavailable-input`}
        className={className}
      />
    );
  }

  if (creating) {
    return (
      <div data-testid={`${testIdPrefix}-create`}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="new-domain-name"
          data-testid={`${testIdPrefix}-create-input`}
          className={createInputClassName}
        />
        {draft.length > 0 && !draftValid ? (
          <div data-testid={`${testIdPrefix}-create-invalid`} style={{ fontSize: 12, marginTop: 4 }}>
            Lowercase letters, numbers, and hyphens only — must start with a letter or number.
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button
            type="button"
            data-testid={`${testIdPrefix}-create-confirm`}
            disabled={!draftValid}
            onClick={() => {
              onChange(draft);
              setCreating(false);
              setDraft("");
            }}
          >
            Use this domain
          </button>
          <button
            type="button"
            data-testid={`${testIdPrefix}-create-cancel`}
            onClick={() => {
              setCreating(false);
              setDraft("");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const legacyInvalid = domains.filter((d) => !LEAD_ID_RE.test(d));
  // The current value always renders as an option even before the
  // vocabulary has loaded (or if it isn't in the fetched list yet) — a
  // prefilled/carried-over value (e.g. the triage "Fix now" flow) must
  // never be silently blanked by an empty/stale fetch.
  const selectable = Array.from(new Set([...(value ? [value] : []), ...domains.filter((d) => LEAD_ID_RE.test(d))]));

  return (
    <div>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === CREATE_NEW_VALUE) {
            setCreating(true);
            return;
          }
          onChange(e.target.value);
        }}
        data-testid={testIdPrefix}
        className={className}
      >
        <option value="">— select a domain —</option>
        {selectable.map((d) => (
          <option key={d} value={d}>
            {d}
            {unclaimedCounts?.[d] ? ` (${unclaimedCounts[d]} unclaimed)` : ""}
          </option>
        ))}
        <option value={CREATE_NEW_VALUE}>+ create a new domain…</option>
      </select>
      {legacyInvalid.length > 0 ? (
        <div data-testid={`${testIdPrefix}-legacy-note`} style={{ fontSize: 12, marginTop: 4 }}>
          Also seen (not selectable — not in the shared kebab-case format): {legacyInvalid.join(", ")}
        </div>
      ) : null}
    </div>
  );
}
