# Iterate Spec: wizard-profile-contract-and-adopt-rows

- **Run ID:** iterate-2026-10-25-wizard-profile-contract-and-adopt-rows
- **Type:** change
- **Complexity:** medium
- **Status:** in-progress

## Goal
Follow-up to PR #535 and to the monorepo PR #923 (B2b). B2b makes `/shipwright-run` honor the stack profile named in the wizard brief (`Stack profile: <name>` item of the `(Intake — ...)` trailer, name rule `^[a-z0-9][a-z0-9-]*$`) and states that wording is now a compatibility commitment. This repo (1) pins that contract with a test and enforces the name rule on the client, and (2) turns more of the Adopt result screen's sample rows into live ones, using the snapshot the existing `POST /api/adopt/scan` already reads.

## Acceptance Criteria
- [ ] AC1 `composeNewBrief` returns a brief that ends with one physical line `... (Intake — Stack profile: <name>; <other items>.)`: the profile item comes FIRST in the trailer, and typed text can neither hide it nor forge a second one: the items who, remember and where lose `(`, `)`, `;`, control characters and the `Stack profile:` label, and the idea (the user's own prose, kept as typed so brackets and line breaks survive) only has a nested `(Intake` marker and the `Stack profile:` label neutralised, so the monorepo reader (`brief_profile.py` @ B2b `3fbc03e1a`: last physical line, last `(Intake`, head ends at the first inner bracket, two items = ambiguous) always finds exactly the one item. A test ports that reader's rules and proves it, for a custom, a built-in (`vite-hono`, `supabase-nextjs`) and an inferred profile, and for hostile user text.
- [ ] AC2 A name that fails `^[a-z0-9][a-z0-9-]*$` (uppercase, underscore, dot, space, `;`, newline, empty, over-long) can never become the wizard's profile answer: the `setProfile` reducer refuses it even when the server list marks it valid, and `composeNewBrief`/`resolveStackProfile` never emit it. The client mirrors the server's `PROFILE_NAME_RE` AND `MAX_PROFILE_NAME_LENGTH` (64) verbatim, with no `g`/`i`/`m` flag, guarded by a drift test that reads the server source text.
- [ ] AC3 `POST /api/adopt/scan` for a repo returns, next to `profile`, an additive `findings` block (stack, routes, tests, ci, conventions, commands). Every value is derived from the snapshot and safe to show: short strings (<= 120 chars, control/bidi characters and whitespace runs cleaned, all-blank = nothing found), lists <= 8 items, counts finite non-negative integers, one bad key nulls only that key. A key the snapshot does not report is OMITTED (1.0 stays readable); a key it reports with nothing found is `null`. Commands are exposed as NAMES only (dev, build, test, lint), never as command text. The response is `Cache-Control: no-store`, is never logged, and the `profile` block is unchanged (additive).
- [ ] AC4 On the Adopt result screen, once the scan is `ok`, the rows Stack, Routes, Tests, CI, Conventions and Commands show the live value, or "Nothing found at the top of the repo - it may be in a sub-folder" (reported, empty) or "Not reported by this scan version" (key absent); Profile stays live; Features stays a sample and is marked "sample". While loading, or when the scan is unavailable/fails, every row stays the sample and the note says so; the banner text is derived from the per-row live flags (all live / some live / none), the "sample" tag is text not colour, values render as React text with `overflow-wrap:anywhere`, and the banner never claims more is live than is.
- [ ] AC5 Real browser: with a real analyzer run on a temp repo, the Adopt result shows the live Stack and CI values and marks Features as sample (spec 108 extended; skips with an explicit reason when the analyzer is not installed). A committed real analyzer snapshot fixture is also run through `extractFindings` in CI (server); `AdoptResult` is exercised with typed findings in unit tests and with the real analyzer in the browser run (client and server cannot share the fixture without a cross-package import).
- [ ] AC6 (tidy) The bundled-profile Preview e2e asserts the exact `enabled` value, not just a boolean; the duplicated loader type is merged into one.
- [ ] AC7 (verification, result reported not assumed; read FIRST: done against the B2b branch @ `3fbc03e1a`, re-run against the merged #923 at the end) Against the monorepo #923: a wizard brief naming a valid custom profile reaches the run config as that profile; an invalid name is reported with `profile_error` / exit 3 and never turned into null or another profile.

## Spec Impact
- **Classification:** modify
- **MODIFY:** FR-01.75 (the Adopt bullet: more live rows; new bullet: wizard brief profile-name contract)
- **ADD / REMOVE:** none

## Out of Scope
- Splitting `server/src/index.ts` (958 lines, grandfathered): moving one mount line cannot reduce it and the current placement is documented; a real extraction is its own iterate.
- Features row (inferred from enrichment, not in the snapshot), the "What I'll write" column.
- A `.venv` in the plugin cache: this repo's own `uv` calls all use `--no-project` except `grade-runner` (`--project <plugin>`, documented in its header); the cache `.venv` folders come from the plugins' own `uv run`. No code change.
- Surfacing `brief_intake` exit 3 in the Command Center: the failure happens inside the terminal session the user watches; the Command Center has no hook on it.

## Design Notes
Server: `extractFindings(raw)` in `core/adopt-scan.ts` next to `extractProfile`, same cleaning helpers; `AdoptScanOutcome.ok` gains `findings`. Client: `adoptLiveRows.ts` maps `findings` onto the sample rows (label stays, value replaced, `live` flag per row); `AdoptResult` renders a "sample" tag on non-live rows. Name rule: `PROFILE_NAME_RE` mirror in `contract.ts`, enforced in the reducer and in `resolveStackProfile`.

## Affected Boundaries
| Producer | Consumer | Format |
|---|---|---|
| `composeNewBrief` (wizard) | monorepo `brief_intake` | `Stack profile: <name>` item in the `(Intake — ...)` trailer |
| `analyze_codebase.py` snapshot 1.1 | `extractFindings` → `/api/adopt/scan` → `adoptLiveRows` | JSON |

## Confidence Calibration
- **Boundaries touched:** the two rows above.
- **Empirical probes run:** real analyzer run on this repo and on a fixture (shape + nulls observed: this monorepo yields null tests/commands at the root, so "not detected" is a first-class state); B2b PR text and diff read for the exact wording.
- **Test Completeness Ledger:** see F5 block.
- **Confidence-pattern check:** unit (findings extractor, row mapper, contract, reducer, drift) + real-browser Adopt e2e.

## Verification (medium+)
- **Surface:** web
- **Runner command:** to be fixed at E2E authoring (isolated-stack harness)
- **Evidence path:** client/e2e output

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Sound and well scoped; largest risks are the intake trailer being read by the monorepo and untrusted snapshot text shown as trustworthy findings.
- **Findings:** security/medium untrusted text (commands) -> fixed (names only, caps stated, React text, wrap); security/medium secrets in response -> fixed (names only, no-store, no logging; redaction declined, nothing free-form is returned); architecture/medium length cap + regex flags in mirror -> fixed (mirror both, drift test, no flags); completeness/medium invalid-name fallback + trailing parenthetical -> fixed in part (the claimed parenthetical does not exist in `composeNewBrief`; the reader was read and it DOES lose the item when an earlier item holds a bracket, so the profile item goes first and user text is cleaned); security/medium brief injection -> fixed (cleaning + tests vs the ported reader rules); completeness/medium misleading banner states -> fixed (per-row flags, reported-empty vs unreported); completeness/low per-key type safety + fixture -> fixed; completeness/low client/server findings type drift -> fixed (shape sync test, stale headers updated); performance/low e2e not a CI gate -> fixed (fixture test in CI, explicit skip); completeness/low AC7 last -> fixed (read first).
- **Known limitations:** a repo whose code lives in sub-folders reports "nothing found at the top"; the scan does not descend into workspaces.
- **Status:** 10 fixed, 0 declined

## External Plan Review
- glm=approve, openai=revise (verdicts agree within one step). Accepted and fixed: sanitise all four user fields and put the profile item first, tested through the ported reader on real `composeNewBrief` output (openai 2, glm 2); AC7 run against B2b first and again against merged #923 (openai 1); empty-state wording follows AC4 (openai 4). Already covered: non-object snapshot nodes (glm 3), server-side stripping (glm 7), mapper kept free of React (glm 6). Declined: behaviour-battery instead of source-text equality for the drift test (glm 1: the repo's established mirror pattern reads the declaration; the shape rule is also pinned behaviourally in `briefIntakeContract.test.ts`). Disclosed: existing saved profile names that fail the rule - the server's own list already marks such names invalid, so no new refusal path (glm 4); a re-scan that errors keeps the last real read on screen (glm 5); the real-snapshot fixture runs through the server extractor in CI, the client test uses typed findings guarded by the shape-sync test (openai 3).

## Internal Architecture Review (architecture-internal-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Build the contract half now; the live Adopt rows are a nice-to-have with a survivable fallback, so splitting them out is the smaller option - if kept, option A is the right shape.
- **Findings:** necessity/low contract half justified -> accepted; smallest-option/medium split the Adopt rows out -> declined (the operator asked for both in this iterate; the rows were already requested in the previous review round); smallest-option/low take A not B/C -> accepted; complexity-cost/medium three couplings -> mitigated (drift tests + committed real snapshot fixture kept; AC6 stays, it is two small edits); security/medium one shared cleaning helper -> fixed (`CONTROL` exported once, used by both extractors), hostile bidi/long-string tests exist, reducer stays authoritative; completeness/low silent character loss + pinned reader commit -> fixed in part (characters become spaces, not deletions; commit pinned in the test header; re-run against merged #923).
- **Known limitations:** characters `( ) ;` typed in the idea trailer parts become spaces in the brief the run reads.
- **Status:** 4 fixed, 1 mitigated, 1 declined

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-10-25-wizard-profile-contract-and-adopt-rows/architecture_brief.md`
- **Verdicts:** glm=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed (option A)
- **Findings:** low proportionality (three row states triple the wording surface) -> accepted, key set pinned by the shape-sync test; low name-rule mirror duplicates a server-owned rule -> accepted (established mirror convention)
- **Reconciliation:** the internal reviewer's "split the Adopt rows" was declined as above; the external pair did not raise it.
