# Remove the Codex "Implementation model" override field

## Context

PR #481 (commit a98e218a, 2026-09-24) deliberately kept the free-text
"Implementation model" field enabled for Codex-runtime task creation,
reasoning that it was "wired through" end-to-end (`useNewIssueFormSubmit.ts`
→ `body.codexImplementationModel` → `buildCodextenderCommands` /
`launcher-codex.ts`). A live Codextender-integration operator test
(2026-09-26) reported that this field must be gone entirely, for both
`codexIntegrationMode` values, no exceptions — reversing that decision one
PR later.

## Decision

Remove the field, its param-key constant, its re-export, and its
client→server request-body wiring entirely. Confirmed with the operator
before implementing (verbatim, translated): "the normal model that's
configured — via `/model` in the CLI. That's what gets used." No override
is ever sent from webui again; each runtime falls back to its own
pre-existing default — Codex Light inherits the `codex` CLI's own
persisted `/model` selection (unchanged: `launcher-codex.ts` already emits
no `-c model=` flag when unset); Codextender falls back to
`DEFAULT_CODEXTENDER_MODEL_ALIAS` ("sol", unchanged in
`launcher-codextender.ts`). Neither launcher needed a code change.

## Consequences

- 3 unit test files + 2 Playwright E2E files (discovered by grep, beyond
  the operator's named 3) retargeted to assert the field's absence and
  move their datalist/catalog assertions onto the surviving Plan-review
  field, which shares the same `<datalist>`.
- Code review (Stage 2) found removing the field's last enabled
  Codextender consumer left the Codextender catalog caption text ("…you
  can still type any slug") and the review-inherit note ("follow the main
  model") literally false once every Codextender field was disabled;
  fixed both strings in the same PR (`CodexModelOverrideFields.tsx`).
- Server-side acceptance of `codexImplementationModel` in the launch body
  is an accepted, disclosed gap (out of scope for this operator report) —
  a future iterate can strip it from `parse-body.ts` if the API surface
  itself should also be closed.
- FR-01.74's AC updated to describe the removal and each runtime's actual
  fallback, explicitly distinguishing Codex Light from Codextender rather
  than collapsing them into one sentence (external plan review finding).

## Rationale

The operator's instruction was unconditional ("no exceptions"), and the
confirmed product answer describes a world with no per-task override
surface at all — not a disabled-with-explanation one. Sending no override
and relying on each runtime's own existing fallback is the smallest change
that satisfies both the operator's report and the confirmed product
decision; both the internal plan reviewer and both external review
cascades (plan, architecture, code) converged on this as proportionate,
with no reviewer requesting a broader mechanism.

## Rejected alternatives

**Disable the field instead of removing it** (matching the existing
disabled-Plan-review/Review pattern under Codextender): rejected because
the operator was explicit that the field must always be *gone*, and a
disabled field would misrepresent Codex Light, where the CLI's own
`/model` preference is genuinely live and adjustable outside webui —
disabling it would wrongly suggest no adjustment is possible at all.

**Add a project-level Codex-model setting the client always sends**:
rejected — the confirmed product answer explicitly describes inheriting
the CLI's own configured model, not introducing a new webui-owned
override mechanism; this would have added a standing mechanism the
product decision doesn't call for.

## Full review record

Internal Plan Review, External Plan Review, Architecture Review, Code
Review (Stage 2) and External Code Review sections, each with verdicts,
findings and dispositions, are in the iterate spec:
`.shipwright/planning/iterate/iterate-2026-09-26-codex-model-field-removal/spec.md`.
