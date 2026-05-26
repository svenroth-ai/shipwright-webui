# ADR-102: Campaign C — C4 — NewIssueModal.tsx split

- **Run-ID:** `iterate-2026-05-26-campaign-C-C4-new-issue-modal-split`
- **Campaign:** `2026-05-25-bloat-cleanup-C-webui`
- **Status:** Accepted
- **Date:** 2026-05-26
- **Architecture impact:** component

## Context

`NewIssueModal.tsx` (1516 LOC) was a five-mode monolith covering `new-task / new-pipeline / new-iterate / new-plain / generic`. Both the source file and its 1292-LOC test were on `shipwright_bloat_baseline.json` as `state: "grandfathered"`. Campaign C bloat-cleanup mandates splitting and removing the entries.

The five modes share ONE underlying API surface — `POST /api/external/tasks` (createTask) + `POST /api/external/tasks/:taskId/launch` (launchExternalTask). The mode branches CONTENT (fields, autonomy gating, palette) but NOT the wire shape. Bit-perfect preservation of those two POST bodies + the sessionStorage auto-launch handoff was the cleanup-invariant boundary.

Two call-sites consume `NewIssueModal` extensionless: `TaskBoardPage.tsx` + `TriagePage.tsx`. Both pass identical props.

## Decision

Split `client/src/components/external/NewIssueModal.tsx` into a directory:

```
client/src/components/external/NewIssueModal/
├── index.tsx                       # re-export for the extensionless path
├── NewIssueModal.tsx               # dispatcher: action.id → body
├── ModalShell.tsx                  # Radix Dialog + header + footer + form
├── NewTaskModal.tsx                # phase + phase-aware autonomy + params
├── NewPipelineModal.tsx            # autonomy always
├── NewIterateModal.tsx             # autonomy always; description on launch
├── NewPlainModal.tsx               # title + description only
├── NewGenericModal.tsx             # custom actions, static command-preview hint
├── useNewIssueForm.ts              # composer hook (210 LOC)
├── useNewIssueFormState.ts         # useState + reset-on-open effect
├── useNewIssueFormDerived.ts       # useMemo + schema-seed + classifyPhase
├── useNewIssueFormSubmit.ts        # createPayload + launchBody (bit-perfect)
├── SimpleFields.tsx                # Project / Title / Description / Autonomy
├── LeadwrightFields.tsx            # 5-field routing grid
├── ParamSections.tsx               # Required + Advanced
├── PhaseDropdown.tsx               # Radix DropdownMenu phase picker
├── FieldLabel.tsx                  # label primitive
├── palette.tsx                     # PALETTE + resolveMode + headings
├── paramHelpers.ts                 # paramsToPreview + explicitParamEntries
├── types.ts                        # NewIssueModalProps + Mode + ModePalette
├── __testFixtures.tsx              # shared test fixtures
└── (12 test files, each ≤300 LOC)
```

The 5-mode count exceeds the spec's stated 3-mode count because Plain Claude (v0.4.0) and Generic mode (v0.4 — `.webui/actions.json` custom actions) are active production paths — silently dropping either would be a behavior regression.

`useNewIssueForm` is the composer over three slices. The submit slice owns the createPayload + launchBody shape — that is the single bit-perfectness boundary.

The dispatcher wraps each body in `<ModeBody key={action.id}/>` so an action change mid-open remounts the body (fresh-state-on-mode-switch per Step 3.5 review Gemini #5) without losing the centralised hook ownership.

Both baseline entries removed (`NewIssueModal.tsx` 1516→deleted; `NewIssueModal.test.tsx` 1292→deleted) — cleanup-invariant case (b) "original path replaced by directory".

## Rationale

- Mode bodies separate naturally along visible UI gates (phase dropdown task-only; autonomy gating differs per mode; leadwright opt-in per action; generic replaces live preview with static hint).
- Centralised hook + bit-perfect submit boundary keeps payload-shape testable in one place.
- Directory + `index.tsx` preserves the extensionless import path so both call-sites compile unchanged.
- Hook decomposes 3-ways (state/derived/submit) to keep every file ≤300 LOC per cleanup-invariant.
- The `key={action.id}` pattern provides fresh-on-mode-switch state without sacrificing dispatcher-level hook ownership (Gemini #5 accepted; Gemini #4 rejected).

## Consequences

- Every new source + test file ≤300 LOC. Both baseline entries removed (84 → 84 entries after net -2 +0; ratchet-check PASS).
- 84 vitest probes cover the 5 modes × 2 POST bodies + sessionStorage handoff with `hasOwnProperty` omission semantics. Full 1124-test client suite passes.
- Two latent bugs found via Step 3.7 external code review and fixed in the same iterate: (1) hardcoded `"unassigned"` literal restored to `UNASSIGNED_PROJECT_ID`; (2) snapshot-based setState in `onParamEnableToggleImpl` restored to functional `(prev) => next` pattern.
- Defense-in-depth: synchronous `inFlightRef` guard added in `useNewIssueFormSubmit.ts` for duplicate-submit protection (Step 3.5 OpenAI #3).
- `architecture.md:151` and `component_inventory.md:14` still reference the old path string; the `NewIssueModal` token is preserved in CLAUDE.md ∪ architecture.md ∪ component_inventory.md so the doc-sync meta-test stays green. Stale path strings are Phase-0f-style cosmetic drift — out of scope for C4.

## Rejected alternatives

- **Swap Radix Dialog for another dialog library** — hard constraint in the C4 spec; would change behavior + dependencies.
- **Instantiate `useNewIssueForm` per-body component** (Gemini #4) — loses centralised state on mode-switch; the `key={action.id}` pattern (Gemini #5) gives the same fresh-on-mode-switch semantic without losing dispatcher ownership. ADR-29 Self-Review/Code-Review-Cascade also lives at the dispatcher level.
- **Keep `NewIssueModal.tsx` as a 200-LOC shim alongside the directory** — file+directory namespace collision risk on Windows/Git per Step 3.5 Gemini #1.

## Verification

- `npx tsc --noEmit` clean.
- `vitest run` (client): 99 files / 1124 tests pass.
- `vitest run src/components/external/NewIssueModal`: 12 files / 84 tests pass.
- F0.5 surface_verification.json: `exit_code: 0, tests_run: 84` (`>= 8` required by spec).
- `scripts/hooks/anti_ratchet_check.py`: PASS (exit 0).
