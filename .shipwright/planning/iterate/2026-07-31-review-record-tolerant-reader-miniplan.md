# Mini-Plan: review-record-tolerant-reader

- **Run ID:** iterate-2026-07-31-review-record-tolerant-reader
- **Spec:** `2026-07-31-review-record-tolerant-reader.md`

## Chosen approach — tolerate at the KEY, stay total at the FIELD

Two gates move, and only two:

1. **`schema_version`** — `RECORD_SCHEMA_VERSION` stops being an equality pin and
   becomes `MIN_RECORD_SCHEMA_VERSION`. Accept any integer `>= 1`; reject missing,
   boolean, non-integer, `< 1`. This is the same forward-compatibility stance the wire
   contract already documents for `MissionContext.schemaVersion` ("the client only needs
   to READ a number and must stay forward-compatible with a server that bumps it",
   `mission-context-types-sync.test.ts:128`).
2. **Unknown keys in `reviews`** — stop rejecting; map each one through the SAME
   `toRow` and append it after the pinned five.

**Everything else stays exactly as strict.** That is what makes accepting a newer
version safe rather than optimistic: a v2 entry that changed shape does not slip
through on the version number, it is rejected by `toRow` on its own merits. Forward
tolerance is bounded by "every entry still validates", and that sentence is the design.

### Where each piece lands

| # | File | Change |
|---|---|---|
| 1 | `server/src/core/mission-context/review-record-entry.ts` **(new)** | Extracted entry→row mapping: `toRow`, `toFinding`, `location`, `str`, the producer-status map, the parse-status / severity / disposition vocabularies, the per-row findings cap. Pure move, plus `reviewType: string`. |
| 2 | `server/src/core/mission-context/review-record.ts` | Keeps read + guards + record-level validation + assembly. Version pin → floor; unknown-key acceptance + key grammar + the 32-pass aggregate bound; pinned-first row assembly. |
| 3 | `server/src/core/mission-context/types-slice2.ts` | `ReviewType` widened to `"self" \| … \| (string & {})`. |
| 4 | `server/src/core/mission-context/review-state.ts` | One annotation tightened: `REVIEW_TYPE_ORDER` becomes `as const` so widening `ReviewType` cannot let a typo into the pinned order. **No behaviour change** — the marker fallback is otherwise untouched. |
| 5 | `client/src/lib/missionContextApi.ts` | Verbatim mirror of 3. |
| 6 | `client/src/lib/missionArtifacts.ts` | `reviewTypeLabel` gains a derived-from-the-key default. |

`MissionSlice2Details.tsx` needs **no change**: it already maps rows generically and
keys them by the raw review type.

**Why the split (row 1).** `review-record.ts` is at **291** lines against the 300
ceiling; this change cannot fit. The split is cohesive and file-level, not
per-handler (the house rule): the record module owns *is this file a record for this
run*, the entry module owns *is this one entry a row*. Both land well under the
ceiling, and the entry module is exactly the surface the unknown-type path reuses
unchanged — which is the point being made.

**Where the bound lives — revised after the external plan review (finding 3).** The
first draft capped rendered rows in the artifact builder and disclosed a `truncated`
flag. That was wrong twice over: it added wire-contract surface for a presentation
concern, and a cap that DROPS rows is the invisible-review failure this artifact
exists to prevent. Instead the reader carries one explicit aggregate bound — more than
**32** passes is an integrity fault, stated as such. Loud, never silent, no wire change,
no client renderer change, and it bounds what is built as well as what is sent.

## What the external plan review changed (openai, verdict `revise`; gemini degraded)

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | med | Widening `ReviewType` may break `Record<ReviewType, …>` / exhaustive switches / ordering maps beyond `reviewTypeLabel` | **Audited all 17 references.** No `Record<ReviewType, …>` exists anywhere. `Extract<ReviewType, "plan" \| "external_code">` still resolves to exactly those two. The two pinned arrays become `as const` so widening cannot admit a typo. A non-`spec` unknown key (`gut_feeling`) is asserted in the ordering test. |
| 2 | med | Label derivation underspecified for the full key grammar; risk of aliasing distinct keys | One deterministic formatter, specified in AC7: `_` → space, capitalise the first character, append " review". No casing normalisation (so `GATE` stays `GATE`), no name map. Where two keys could still render alike, the RAW key remains the row identity (`data-review-type` + React key) — the reviewer's own mitigation. Tested with hyphen, underscore and mixed case. |
| 3 | med | Unknown keys make a previously five-row record unbounded through the reader | Adopted the reviewer's preferred option: an explicit aggregate bound (32) at validation, failing as an integrity fault rather than dropping entries. The presentation cap and its wire flag are removed. |
| 4 | low | `RECORD_SCHEMA_VERSION` → `MIN_…` could blur writer vs reader semantics for other importers | **Audited:** the constant is module-private with exactly two uses and no importers; this repo never WRITES the record. Predicate written explicitly as `Number.isInteger(v) && v >= MIN`. A test pins the compatibility boundary: version 2 is accepted only while its entries still satisfy the entry contract. |
| 5 | low | Artifact-controlled keys become UI-visible text | The label is a plain string in a normal JSX text node (no `dangerouslySetInnerHTML` anywhere in the component). Iteration is `Object.keys` (own enumerable only) and the pinned lookups use `hasOwnProperty`, so no inherited property can participate. The key grammar rejects `__proto__` outright. |

## Alternative considered — skip unknown types instead of rendering them

Ignore unrecognised keys: the record stops being invalid, five rows render, the sixth
pass is invisible. Smaller diff, no `ReviewType` widening, no cap, no client change at
all.

**Rejected** (operator decision, 2026-07-31, and on the merits): the reason to promote
the row is to make the spec HARD-GATE *visible*. Skipping would ship a reader that
"tolerates" the promotion by hiding its payload, and a recorded review pass nobody can
see is precisely the not-run-versus-not-recorded confusion this whole artifact exists to
abolish. It would also need a THIRD change later to display it, defeating the
"one line each side" property the producer is waiting on.

## What the review cascade changed (Stage 1 REJECT → Stage 2, 0 high / 3 med / 6 low)

| Stage | Finding | Resolution |
|---|---|---|
| 1 spec | The Spec Impact block promised FR-01.66 AC (O); it was never written, and the existing AC (M) still asserted the closed-five rule this iterate inverts | AC (O) appended + the FR row's Updates field extended |
| 1 spec | Out of Scope said `review-state.ts` was "byte-for-byte untouched"; the mini-plan said the opposite about the same file | The sentence was wrong, not the code — reworded to BEHAVIOUR, with the `as const` named as the one attributed exception |
| 1 spec | `types-slice2.ts` still documented rows as "ALWAYS all five types" — false, in the file the client mirrors, and comment-stripped by the sync guard so no test could catch it | Rewritten |
| 1 spec | The split exported `str`, which had been private and has no importer | Made private again |
| 1 spec | AC4 named six clauses; only five had an unknown-key test | Sixth case added |
| 2 code | **`Record<ReviewRow["reviewType"], string>` in `artifacts-slice2.ts` collapsed into an index signature** — exhaustiveness lost, `reviewWord(): string` returning `undefined`. My own audit missed it because I grepped `ReviewType`, not `ReviewRow["reviewType"]` | Keyed on the pinned five spelled out; `reviewWord` falls back to the run's own key |
| 2 code | `spec` and `spec_` both render "Spec review"; the only disambiguator was a DOM attribute, and my test asserted exactly that invisible attribute | The raw key is now in the visible label; the test asserts rendered text |
| 2 code | The mirror drift-guard cannot see `(string & {})` at all — reverting the client mirror would pass green | New `mission-context-review-type-widening.test.ts` (own file; the sync test is past its ceiling) |
| 2 code | `reviewTypeLabel` could throw on a non-string; "missing" was the wrong word for a malformed stranger; the pinned five had become two unguarded literals; `hasOwnProperty` was undocumented; grammar untested on its accepting side; orphaned JSDoc | All six fixed |

## What the Stage-3 doubt review changed (8 doubts; 2 high)

It attacked the change's own safety claim and won, which is the most valuable thing
this run produced.

| # | Doubt | Resolution |
|---|---|---|
| D1 (high) | **"Entry validation is total" covers RESHAPES, not ADDITIONS** — and additions are what the producer's contract promises. `toRow` validates only the fields it names and rejects no added one, so the version pin this iterate removes was the ONLY thing that ever caught them. A v2 entry with `verdict:"blocked"` beside `status:"completed"` would render "ran" and feed "raised no issues" for a gate that blocked. | Forward-reading is now DISCLOSED: a version past the newest this build knows adds a caveat to the summary. New AC10. |
| D2 (high) | The tolerance's bound is not `reviews` but the record — and the real answer is already in a sibling. **This run's own record** carries `gates.spec` with 5 findings, two beginning "BLOCKING", which no webui code reads: its card said "14 issues across 3 reviews" for a record holding 19 across 5. | Passes under an unread record-level key are counted and disclosed, detected by SHAPE not by the name `gates`. Does NOT preempt the monorepo promotion. |
| D3 (med-high) | "Ship webui first" is necessary, not sufficient: the plugin auto-updates via the marketplace cache while the webui is hand-deployed, so new-plugin/old-webui is reachable — and that combination blanks all five rows with a message that is false under skew. | Accepted as a real constraint. Carried into the CHANGELOG, the ADR and the closing handoff so the promotion is gated on a deployed webui, not on merge order. |
| D4 (med) | The pinned five are an un-renameable FREEZE, and the header advertising tolerance never said so — a producer author could reasonably conclude a rename is safe. It blanks the card. | Stated in the header, where a producer author will actually read it. |
| D5 (med) | Tolerance is per-key but FAILURE was per-record: one unknown word in one unrecognised pass replaced five parsed rows with an integrity fault. The corruption prior is wrong for the one object this change defines as unknown-by-construction. | A stranger now degrades to its own unreadable row; pinned entries stay strict. AC4 amended. |
| D6 (low) | The planned `SCHEMA_VERSION = 2` bump buys this reader nothing (it is a floor now) and makes older plugin caches fail F11 CLOSED on an immutable git-tracked record. | **Changes the follow-up:** the monorepo half should be promotion-only. Raised with the operator. |
| D7 (low) | `MAX_FINDINGS_PER_ROW` was sized for a five-row list; the aggregate ceiling is now 6.4× larger. | Documented and deliberately left — the per-row share of the panel did not change. |
| D8 (low) | Two invariants a future "simplifier" reverts silently: iterating `keys` instead of `REVIEW_TYPES` deletes the missing-pinned check, and `REVIEW_WORD` is comment-only. | Comment added naming the consequence; ledger row 27 corrected from "covered by the suite" to `covered-by-existing-test`, because the reviewer was right that no test can fail on it. |

## Risks

| Risk | Mitigation |
|---|---|
| Accepting a newer version misreads a non-additive future change | Per-entry validation is unchanged and total; a reshaped entry is rejected on its own fields. Documented as the bound of the tolerance. |
| A garbage key renders a garbage label | Key grammar `^[A-Za-z][A-Za-z0-9_-]{0,63}$` enforced in the reader (AC5). |
| Widening `ReviewType` breaks the server↔client mirror guard | `unionMembers` extracts quoted literals only; `(string & {})` is invisible to it and both sides mirror verbatim. Verified by running the guard. |
| `MissionSlice2Details.test.tsx` (370) / `review-record.test.ts` (304) / `mission-context-types-sync.test.ts` (302) are over the 300 ceiling and baselined | New tests go into `review-record.validation.test.ts` (122) and a NEW client test file. No line is added to any file already crossing. |
| The E2E asserts `toHaveCount(5)` | Updated to the new count in the same commit, with the unknown row asserted by label — not just by arithmetic. |

## Test plan (TDD — red first)

- `review-record.validation.test.ts` — AC1–AC6: unknown key accepted + mapped; ordering;
  `schema_version` 2 accepted, `0`/`"1"`/`true`/missing rejected; a malformed unknown
  entry invalidates; a bad key grammar invalidates; a missing pinned type invalidates.
- `review-record.validation.test.ts` — AC8: 32 passes read; 33 is an integrity fault.
- New `MissionSlice2Details.review-unknown.test.tsx` — AC7 rendering + label derivation
  (underscore, hyphen, mixed case), and that the raw key survives on the row.
- `mission-artifacts-s2.spec.ts` (Playwright, real browser) — seed a record carrying an
  unknown `spec` pass; assert six rows, the "Spec review" label, and its findings.
- Regression: full `server` + `client` vitest suites (AC9), plus the mirror guard.
