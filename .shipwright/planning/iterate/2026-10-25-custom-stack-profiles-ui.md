# Iterate Spec: custom-stack-profiles-ui

- **Run ID:** iterate-2026-10-25-custom-stack-profiles-ui
- **Type:** feature
- **Complexity:** medium
- **Status:** in-progress

## Goal
Part 2 of shipwright trg-647df2d8 (campaign stack-profile-resolver): surface custom stack profiles (project / user / built-in) in the Command Center — a Settings card to list, validate and create-from-bundled, and an Intent Wizard question for people who already keep their own stack — by calling the shipwright resolver CLI (`resolve_profile.py list|validate --json`, contract_version 1), never by re-implementing it.

## Acceptance Criteria
- [ ] AC1 Settings lists profiles grouped by source with validity, error and resolver warnings; a missing resolver or a newer contract version is stated plainly.
- [ ] AC2 Create-from-bundled writes a renamed copy (wx, never overwrites; name unused in every source; reserved/malformed refused) and removes it if the resolver rejects it.
- [ ] AC3 The New-door wizard offers the user's own profiles in one explained question after the idea; choosing one skips remember/where and hands the profile to /shipwright-run; no own profiles = unchanged four questions.
- [ ] AC4 The contract is pinned by a real-output fixture; an unknown major is refused.
- [ ] AC5 The adopt snapshot 1.1 additive profile.source/warnings are read tolerantly (1.0 stays readable).

## Spec Impact
- **Classification:** add
- **ADD** (new FR appended): FR-01.75 — Custom stack profiles
- **MODIFY:** none
- **REMOVE:** none

## Out of Scope
- Generating a profile from the wizard's answers (operator may want it later).
- Preview for a project with a custom profile (profile-loader reads only the bundled snapshot).
- Wiring the adopt result card to a live snapshot (still stubData).

## Design Notes
Mirrors the campaign-readiness bridge: `uv run --no-project`, shell:false, honest engine-unavailable, no silent fallback to `server/profiles/`. Shapes are verbatim mirrors (DO-NOT #7). The only write surface is create-from-bundled, `wx` + resolver-validated + rolled back. Routes mount via `createProfilesRoutes({projectManager})` so `server/src/index.ts` (over the bloat limit) does not grow.
Wizard: `activeQuestions(state)` drives step numbering; `setCustomProfiles` is ignored once past step 1 so late data cannot shift the steps.

## Affected Boundaries
| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| shipwright `resolve_profile.py list --json` | `server/src/core/stack-profiles.ts` | JSON contract_version 1 (pinned fixture) |
| `stack-profiles-create.ts` | the resolver (user/project profile dirs) | profile JSON file |
| shipwright `analyze_codebase.py` snapshot 1.1 | `adoptSnapshotProfile.ts` | JSON schema_version 1.x |

## Confidence Calibration
- **Boundaries touched:** the three rows above.
- **Empirical probes run:** real `resolve_profile.py list --json` output with project/user/invalid profiles captured as the fixture; `validate` exit codes (0 / 2 not found / 3 invalid JSON) probed against the real CLI.
- **Test Completeness Ledger:** see F5 block.
- **Confidence-pattern check:** contract parsed from real output (depth); routes, create rollback, reducer step math, copy, reader covered (breadth).

## Verification (medium+)
- **Surface:** web
- **Runner command:** to be fixed at E2E authoring (isolated-stack.mjs harness)
- **Evidence path:** client/e2e output
