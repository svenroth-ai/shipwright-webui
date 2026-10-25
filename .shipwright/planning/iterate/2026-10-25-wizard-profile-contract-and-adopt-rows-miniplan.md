# Mini-Plan: wizard-profile-contract-and-adopt-rows

- **Run ID:** iterate-2026-10-25-wizard-profile-contract-and-adopt-rows
- **Complexity:** medium

## Files
- edit `server/src/core/adopt-scan.ts` (+ `adopt-scan.test.ts`): `extractFindings`, `findings` on the ok outcome.
- edit `client/src/lib/adoptScanApi.ts`: `findings` type.
- new `client/src/components/wizard/IntentWizard/adoptLiveRows.ts` (+ test): findings -> rows.
- edit `client/src/components/wizard/IntentWizard/AdoptResult.tsx` (+ `AdoptResult.live.test.tsx`): live rows, "sample" tag, accurate banner.
- edit `client/src/components/wizard/IntentWizard/contract.ts`, `wizardState.ts` (+ `contract.test.ts`, `customProfile.test.tsx`): name rule.
- new `client/src/test/profile-name-rule-sync.test.ts` and `adopt-scan-findings-sync.test.ts`: client mirrors equal the server's.
- new `server/src/core/adopt-scan-findings.ts` (+ test, committed real analyzer snapshot fixture).
- edit `client/e2e/flows/108-custom-profile-preview-and-adopt.spec.ts`: live Stack/CI rows; exact bundled `enabled`.
- edit `server/src/core/custom-profile-loader.ts`: merge duplicated type.
- docs: `spec.md` FR-01.75, `architecture.md`, `component_inventory.md`, decision drop, CHANGELOG drop.

## Work breakdown
1. Name rule: mirror constant + length, reducer guard, `resolveStackProfile` guard; `composeNewBrief` puts the profile item first and cleans all four user fields; tests through the ported monorepo reader on real output, incl. hostile text (red first).
2. `extractFindings` on the server with caps; tests incl. 1.0 snapshot, null keys, hostile strings.
3. `adoptLiveRows` mapper; tests for each row, reported-empty -> "Nothing found at the top of the repo - it may be in a sub-folder"; key absent -> "Not reported by this scan version".
4. `AdoptResult` wiring + "sample" tag + honest banner; live test.
5. E2E: extend spec 108; run in the isolated stack.
6. Tidy: exact bundled assertion, loader type merge.
7. AC7 FIRST (done early): run the real `brief_intake.py` of the B2b branch on wizard-composed briefs (custom / inferred / hostile / unknown name); re-run against merged #923 at the end.

## Test strategy
Unit for 1-4 and 6; one real-browser run for 5 (real analyzer on a temp repo).

## Alternative rejected
Return pre-formatted row strings from the server: simpler client, but copy would live in the server and the "Not detected" wording could not be tested at the UI. Rejected; the server returns structured, capped data and the client words it.
