# iterate-2026-09-26-codex-model-field-removal

**Status:** implemented (F1 drift check: no drift, 2026-09-26)

## Trigger

Operator report (live Codextender test, 2026-09-26): the free-text
"Implementation model" field (`CodexModelOverrideFields.tsx`,
`CODEX_IMPLEMENTATION_MODEL_PARAM_KEY`) still renders in every Codex-runtime
task-creation dialog (New Issue / New Task / New Iterate — all served by the
same `NewIssueModal`), for both `codexIntegrationMode` values. Per the
operator: this field must always be gone for Codex runtime, no exceptions.

This reverses PR #481 (commit a98e218a, 2026-09-24), which deliberately kept
this field enabled ("the implementation-model field is unaffected — it IS
wired through"). That statement was true and is still true of the
*mechanism* (`buildCodextenderCommands` / `launcher-codex.ts` do read a
supplied override) — what changed is the product decision that no UI should
ever supply one.

## Product decision (confirmed with Sven before implementing)

Q: once the field is gone, what decides which Codex model actually runs?
A (verbatim): "das normale model das eingestellt ist. Mit /model in der CLI.
das wird genommen." — the model the CLI already has configured; its own
`/model` selection is what gets used. No project-level setting, no fixed
override sent from webui.

Concretely:
- **Codex Light** — the task's Codex CLI process already has this: no
  override is threaded through, so `buildCodexCommands` never emits a
  `-c model=` flag (`launcher-codex.ts:111,136`, unchanged), and the `codex`
  binary falls through to whatever model its own `/model` command last
  persisted for that CLI installation.
- **Codextender** — there is no real `codex` CLI in this path (it launches
  plain `claude` pointed at a local LiteLLM proxy via env vars), so there is
  no CLI-persisted preference to inherit. `buildCodextenderCommands` already
  falls back to `DEFAULT_CODEXTENDER_MODEL_ALIAS` ("sol" / gpt-6-sol) when no
  `model` arg is supplied (`launcher-codextender.ts:243`, unchanged) — this
  fixed default is what now always applies.

Neither launcher needed a code change — both already handled "no override"
correctly. Only the UI path that could ever construct one is removed.

## Spec Impact

MODIFY — FR-01.74 (Codex CLI as an alternate task runtime). The AC sentence
describing the Implementation-model field's Codextender-catalog suggestion
behavior is replaced with a sentence stating the field is removed entirely
and what determines the model instead. See `.shipwright/planning/01-adopted/spec.md`.

## Affected Boundaries

- Client UI: `CodexModelOverrideFields.tsx` (removes the field + its
  `CODEX_IMPLEMENTATION_MODEL_PARAM_KEY` constant), `ModelTierOverrideFields.tsx`
  (drops the re-export), `useNewIssueFormSubmit.ts` (drops the
  paramValues-read → `body.codexImplementationModel` wiring),
  `externalApi.ts` (drops the now-unreachable request-body type field).
- No server-side change: `parse-body.ts` / `runtime-chokepoint.ts` /
  `launcher-codex.ts` / `launcher-codextender.ts` keep accepting
  `codexImplementationModel` on the wire. **Accepted, deliberate gap**
  (external plan review, GLM leg, medium severity): this means a direct
  API caller (script, curl, a future client) could still supply an
  override the UI can no longer construct. Removing that server-side
  acceptance was out of scope for this operator report — it only asked
  for the dialog field to be gone — and is deferred rather than silently
  dropped; a follow-up iterate can strip `codexImplementationModel` from
  `parse-body.ts` if the API surface itself should also be closed.
- Compliance artifacts: `.shipwright/compliance/test-traceability.json`
  still records the OLD test names for
  `payload-launch.codex-model.test.tsx` at the point this iterate was
  built. This is expected mid-build drift, not a gap in scope — F5b's
  compliance regen (part of this same run's finalization) refreshes
  derived traceability from the actual test files on disk; it is not
  hand-maintained and is not edited directly here (internal plan review
  finding, opus-plan-reviewer).
- Tests: 3 unit test files named in the operator report
  (`ModelTierOverrideFields.codextender.test.tsx`,
  `NewIterateModal.codex-model.test.tsx`, `payload-launch.codex-model.test.tsx`)
  plus 2 Playwright E2E files discovered by grep for the removed testid
  (`codextender-integration.spec.ts`, `model-tier-defaults.spec.ts`) that the
  operator report did not enumerate but exercise the same removed field.

## Confidence Calibration

- **Boundaries touched:** client UI (NewIssueModal family), client→server
  launch-body request shape (narrowed, not widened).
- **Empirical probes run:**
  - Grepped every reference to `CODEX_IMPLEMENTATION_MODEL_PARAM_KEY` /
    `codex-implementation-model` / `codexImplementationModel` across
    `client/src` and `client/e2e` after the edit — the only hits left are
    the new "assert it's gone" test assertions; no dead import/export
    remains (confirmed by a clean `tsc --noEmit`).
  - Ran the isolated-stack E2E harness against the two updated Playwright
    files, real browser, real dev stack, both `codexIntegrationMode` values:
    7/7 passed.
- **Test Completeness Ledger:**

  | Behavior | Status | Evidence |
  |---|---|---|
  | Implementation-model field never renders under Codex Light | tested | `NewIterateModal.codex-model.test.tsx`, `model-tier-defaults.spec.ts` (E2E) |
  | Implementation-model field never renders under Codextender | tested | `ModelTierOverrideFields.codextender.test.tsx`, `codextender-integration.spec.ts` (E2E) |
  | `codexImplementationModel` is never sent in the launch POST body for a Codex-runtime launch | tested | `payload-launch.codex-model.test.tsx` |
  | Plan review / Review fields (and their Codextender-disabled state) are unaffected by the removal | tested | all 4 files above, existing assertions retained/re-targeted |
  | Codex Light launch emits no `-c model=` flag when unset (pre-existing launcher behavior, unchanged) | covered-by-existing-test | `launcher-codex.test.ts` ("implementationModel unset, fresh launch — emits no -c model= flag") |
  | Codextender launch falls back to the "sol" alias when unset (pre-existing launcher behavior, unchanged) | covered-by-existing-test | `launcher-codextender.ts`'s existing default-alias tests |

- **Confidence-pattern check:** asymptote — depth is one focused UI/wiring
  removal across a component, its re-export, its one caller, and the
  client's own request-body type, verified by a clean typecheck plus every
  consuming test updated (none skipped). Coverage — breadth spans both
  `codexIntegrationMode` values, both unit (Vitest/RTL) and E2E
  (Playwright, real browser) layers, and the negative-existence assertions
  the removal specifically requires (field absent, key absent from the
  wire body) rather than only re-asserting the surviving behavior.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Plan is coherent and was implemented faithfully; every affected boundary was verified consistent with no orphaned imports/exports/testids. One completeness gap (compliance-artifact drift) and one clarity suggestion (accepted residual server capability).
- **Findings:**
  - completeness/medium: `test-traceability.json` still names the pre-rename test cases for `payload-launch.codex-model.test.tsx` — disposition: disclose (see Affected Boundaries note above; F5b's compliance regen resolves this as part of normal finalization, not a manual step).
  - completeness/low: the residual server-side `codexImplementationModel` acceptance reads like an oversight rather than a deliberate accepted decision — disposition: fix (Affected Boundaries section above now states this explicitly).
- **Known limitations:** none beyond the disclosed item above.
- **Status:** 1 fixed, 1 disclosed

## External Plan Review
- **Verdicts:** glm=approve · openai=revise
- **Findings:**
  - risk/medium (glm): server-side `codexImplementationModel` acceptance survives the removal — accepted-and-disclosed (see Affected Boundaries note above).
  - approach/medium (glm + openai's revise): FR-01.74's AC rewrite must not collapse the Codex Light vs. Codextender model-determination behavior into one sentence — accepted-and-fixed; the actual `spec.md` edit already states both cases explicitly (Codex Light inherits the CLI's own `/model` selection; Codextender always uses the fixed default alias), so no further edit was needed once verified.
  - edge-case/low (glm): confirm no other client-side consumer (persistence, URL builders, duplicate-task flow) round-trips the removed param key — verified via a repo-wide grep for the key/testid: no such consumer exists, only the new negative-assertion tests reference it.
  - dependency/low (glm): check for stale docs/runbooks mentioning "Implementation model" outside `client/` — grepped; only historical, immutable iterate/ADR records from the field's original introduction reference it (correctly left untouched), plus one live `architecture.md` line, which was updated to reflect the two surviving fields.
- **Reconciliation:** no plan change needed — all findings were either already satisfied by the actual (already-implemented) diff once cross-checked, or addressed with a documentation note; none required reworking the approach itself.

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-09-26-codex-model-field-removal/architecture_brief.md`
- **Verdicts:** glm=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed (Option 1 — send no override at all; each runtime keeps its existing "no override" fallback).
- **Findings:**
  - existence/low (glm): this change removes a standing mechanism and adds none; the one open permanent obligation is the deferred server-side `codexImplementationModel` acceptance, which currently has no owner or trigger — disclosed (see Affected Boundaries note above), not filed as a separate triage item given its low severity and non-urgency, per this project's "don't reflexively create triage items" convention.
- **Reconciliation:** no rework — both reviewers independently converged on the plan as built.

## Code Review (code-reviewer, Stage 2)
- **Verdict:** PASS with CONCERNS
- **Findings and disposition:**
  - M1 (medium, correctness/UX): removing Implementation-model left it as the *only* enabled Codextender consumer of the model catalog; the "…you can still type any slug" caption and the "follow the main model" note became literally false once every Codextender field was disabled — accepted-and-fixed: `codextender-model-catalog-status`'s two Codextender-branch strings dropped the now-false "you can still type any slug" clause, and the inherit-note now names the actual default ("Reviews automatically follow Codextender's default model (sol)."). The Codextender catalog fetch/datalist itself is left in place (harmless — decorative for disabled fields, not misleading) rather than removed, to keep this fix scoped to the correctness defect (false text) rather than a broader behavior change.
  - L1 (low, readability): folded into the M1 fix above (inherit-note wording).
  - L2 (low, readability): fixed — `NewIterateModal.codex-model.test.tsx`'s stale test title renamed to "Plan review / Review inputs show the invalid-shape hint".
  - L3 (low, test duplication, optional): declined — reviewer flagged as optional/no coverage loss either way.
- All 3 retargeted unit test files re-run green (17/17) after the fix; `tsc --noEmit` clean.

## External Code Review
- **Verdicts:** openai=approve · glm=approve
- **Findings:**
  - test/low (glm): `payload-launch.codex-model.test.tsx`'s renamed first test only asserts render-absence, not a launch/POST-body assertion, despite living in a file about the launch body — disclosed, not fixed: it is intentionally redundant with the other three files' render-absence checks; the second test in the same file already covers the POST-body-absence claim for Codex Light. No Codextender-mode POST-body assertion exists, since Codextender is not evaluated on this path at all (payload-launch tests exercise `ITERATE_ACTION` with `runtime-codex` only, not the `codexIntegrationMode` axis) — accepted, both reviewers verdict is `approve`/ship-as-is.
  - edge-case/low (glm): deleting the old stale-`paramValues` leak test means a future re-introduction of the literal key `"codex-implementation-model"` is only guarded by component structure, not a failing test — disclosed, not fixed: both reviewers marked this optional test-hardening, not a defect, and verdict was `approve` on both.
- **Reconciliation:** no rework — both findings are optional hardening suggestions on an `approve`/`ship-as-is` verdict, not defects; recorded here as the disclosed record rather than silently dropped.

## F1/F2 Finalization Notes
- **F1 (artifact_sync.py, ref = merge-base with origin/main):** no drift detected across 14 changed files.
- **F2:** none of the trigger conditions apply (no new route/component/schema/service/write-surface/read-surface/convention — this is a field *removal* from an existing component). The one architecture.md line touched (§11 "Codex model catalog" bullet) is an in-place factual correction of an existing description, not a new dated bullet, so `--architecture-impact none` at F3.
