# iterate-2026-09-09-leadwright-gate-org-presence

Small-complexity CHANGE — no full iterate spec file per the phase matrix.
This file exists only to satisfy `external_review.py --spec-file`.

## Brief

The board shows leadwright affordances on an installation that has no leads
at all: the Bot dropdown and the BellDot shortcut (`LeadTagFilter.tsx`), and
the lead fields in the New-issue dialog (`LeadwrightFields.tsx`, mounted from
four modal files). Nothing gated them. Gate them on the existing
`useOrgChartPresence()` hook (FR-01.71 precedent) — hidden ONLY on a
confirmed `"absent"`; visible on `"loading"`/`"broken"`. Do NOT gate anything
that merely displays already-persisted lead data (chips, tags, the Inbox
lead-question card). No new hook, no new endpoint, no second presence signal.

## Acceptance Criteria

a) Confirmed `org_chart_missing` 404 → Bot dropdown, BellDot, and the New
   dialog's lead fields are absent — proven by test.
b) `"loading"` or `"broken"` → all three still render — proven by test, one
   case each.
c) A task carrying lead tags still renders its chips in every presence
   state, including `"absent"` — proven by test.
d) Exactly one presence signal exists in the codebase; a grep for a second
   hand-typed 404 condition finds nothing.
e) Existing tests green.
