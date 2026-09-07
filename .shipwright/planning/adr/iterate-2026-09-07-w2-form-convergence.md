# Origin -> Basis rename + Layers column retrofit; 29-vs-35 discrepancy resolved

**Run:** `iterate-2026-09-07-w2-form-convergence` (sub-iterate `w2`, campaign
`req3-06-mechanics-webui`)

## Context

Sub-iterate w2 ("Form convergence", S8) retrofits
`.shipwright/planning/01-adopted/spec.md`'s 14 per-area Functional-
Requirements sub-tables onto the shape the monorepo already converged on
(`shared/fr-authoring.md` §4a): `| ID | Area | Name | Priority | Description |
Basis | Layers |`. Before this run every sub-table read `| ID | Area | Name |
Priority | Description | Origin |` — no `Basis`, no `Layers`. The campaign
brief also carried an unexplained "29-vs-35 discrepancy" with an instruction
to resolve it and record the reason.

## Decision

1. **Origin -> Basis.** All 14 header rows renamed
   `| ID | Area | Name | Priority | Description | Origin |` ->
   `| ID | Area | Name | Priority | Description | Basis | Layers |`. Column
   order preserved (Name left of Description — load-bearing per the
   sub-iterate spec). Existing cell values (iterate-slug / enrichment
   provenance strings, e.g. `crawl+enrichment`, `iterate-2026-07-09-w3`)
   carried over byte-for-byte under the renamed header.
2. **Layers column added.** Appended as the final column of all 14 headers
   and all 32 data rows, every cell the literal `(inferred)`. Promotion of
   individual cells to a bare declared value (`unit`, `unit, e2e`, …) once
   AC-to-test binding proves coverage is w5's job (bind-and-promote), not
   this unit's.
3. **29-vs-35 discrepancy — traced, re-measured, resolved.** The phrase is a
   direct quote from the monorepo's own
   `Spec/design/2026-07-22-req3-campaign-SPEC.md` §2 ("Gemessener
   Ausgangszustand"): *"FRs | 15 | 29 (35 AC-Blöcke — Diskrepanz zu
   klären)"* — 29 living FR table rows vs. 35 `### FR-01.NN` Acceptance-
   Criteria heading blocks in the same `spec.md`, as measured on
   2026-07-22. §2.1 of that same document already decomposed the 35: **17**
   AC-blocks (`FR-01.07`…`FR-01.26`) are orphaned leftovers from the
   2026-07-17 taxonomy fold (table rows folded away per `## FR-Fold-Map`,
   AC-heading sections never deleted); **11** living rows
   (`FR-01.37`…`FR-01.65`) had no AC-block at all; the remaining **18**
   living FRs had both. Whether the 17 folded-delta blocks' content actually
   migrated into their survivors' ACs was left **explicitly open** there.

   Re-measured this run (2026-09-07), same method (`grep`-derived sets, not
   re-typed by hand):
   - Living `| FR-01.NN |` table rows: **32** (confirmed three independent
     ways — `spec.md` itself, `traceability-matrix.md`'s `rtm-fr-` anchors,
     `test-traceability.json`'s `requirements` object all agree).
   - `### FR-01.NN` AC-heading blocks: **38**.
   - Intersection (both a row and a block): **21**.
   - Orphaned folded-ID AC-blocks (block, no row): **17** —
     `FR-01.07…09,11…15,18…26`, the **exact same set** as 2026-07-22; no
     further folding has happened since.
   - Living rows with no AC-block: **11** — `FR-01.37,45,47,48,49,50,51,
     59,64,65,72`.

   The +3/+3 growth in both totals (29->32, 35->38) is exactly the three
   capability FRs minted after the 2026-07-22 snapshot and never retired:
   `FR-01.70` (Leads org route), `FR-01.71` (Organization overview for AI
   leads) — both already picked up an AC-block — and `FR-01.72` (Lead-
   question inbox), which has not.

   **Resolution:** "29-vs-35" was never a wrong number needing correction —
   it is an accurately-measured, already-diagnosed internal mismatch between
   two different countable things in the same document (live table rows vs.
   AC-heading blocks), caused by the 2026-07-17 fold leaving 17 orphaned
   sections behind. The mismatch still exists today (now 32-vs-38, identical
   root cause, identical 17-orphan set), and the open cleanup question from
   2026-07-22 (did the folded content migrate into the survivors' ACs?) is
   **still open** — no iterate between 2026-07-22 and today resolved it.

## Scope boundary: diagnosis-and-record vs. content cleanup (external-review disagreement, resolved)

Both external plan-review and both external code-review passes raised the
same objection at high/medium severity: reading "the discrepancy is
resolved" as requiring the underlying mismatch to be *fixed* (the 17
orphaned blocks removed/merged, the 11 AC-less rows filled in), not merely
*diagnosed and recorded*. This ADR's position, held after considering it
twice: the monorepo's own design spec that defines this campaign's steps
(`Spec/design/2026-07-22-req3-campaign-SPEC.md` §8, lines 411/439)
classifies **S8 explicitly as "Mechanische Transformation"** (mechanical
transformation) — a table-shape retrofit — and separately marks the
folded-content migration question as **open**, i.e. undecided future work,
not a defined deliverable of S8. Auditing whether 17 folded `delta` rows'
substance actually landed in their survivors' ACs is a judgement-heavy
content review (reading each block, deciding whether its substance already
lives in the parent FR's ACs or needs to be moved), categorically different
from a mechanical column rename — and out of what a `small`-complexity unit
with zero risk flags should attempt inline. The sub-iterate spec's own three
acceptance criteria (rename, add column, "resolved with the reason
recorded") support this reading: the third AC asks for a **recorded
reason**, which this ADR provides with full citation and current numbers,
not for a cleanup pass the spec never named.

**Named, not silently dropped:** neither w4 (tagging backfill — test-tag
scope only) nor w5 (bind-and-promote — Layers-column promotion only, per its
own spec) claims the 17-orphan cleanup or the Basis-value revaluation
(below). No unit in this campaign currently owns either follow-on. That is
recorded here as a deliberate, currently-unowned gap — not an oversight —
precisely so a future reader/operator does not have to re-derive this
state from scratch, and can decide whether to file a new unit for it.

## Basis column: header-converged, not value-converged (explicit scope decision)

The existing `Origin` cell values (`crawl+enrichment`,
`iterate-2026-07-09-w3`, `backfill (iterate-2026-05-16)`, …) are file-path/
iterate-slug provenance strings answering "where we looked" — a
categorically different fact from the monorepo's closed `Basis` vocabulary
(`interview`/`code`/`observed`/`tests`/`assumed`/`other`, answering "how we
know the requirement" — `shared/scripts/lib/_fr_table_columns.py`'s own
docstring draws this exact distinction and deliberately excludes `origin`/
`source` from being scored against it). This run carries those values over
unchanged under the renamed `Basis` header — a structural rename, not a
value migration; recoercing 32 rows into a 6-value vocabulary is a
judgement call (which value each historical string becomes is not
mechanically derivable) and the sub-iterate spec's own AC is "Origin is
renamed Basis", not "Basis values are corrected".

**Consequence, stated plainly:** this repo's FR table is now
**header-converged** (any reader that resolves columns by name, like the
monorepo's shared `_fr_table_columns.py`, will find `Basis`/`Layers`
correctly) but **not value-converged** on `Basis` — 32 rows hold
non-vocabulary provenance strings. **Correction (Stage-1 spec review,
2026-09-07):** this repo DOES have an in-repo consumer of this file —
`server/src/core/mission-context/fold-map.ts` reads
`.shipwright/planning/01-adopted/spec.md` (`SPEC_REL_PARTS`, L29) and
resolves `Name`/`Description` **positionally** (`cols[2]`/`cols[4]`,
L105-106), not by header name. It is exactly the consumer that makes the
sub-iterate spec's column-order constraint load-bearing. This run's rename
is safe against it — both new columns are right-edge appends, so indices
0-4 are untouched — but the earlier claim that "no validator of any kind…
is vendored in this repo today" was wrong; it was scoped to monorepo tool
names (`_fr_table_columns`, `fr_table_reader`, `check_fr_hygiene`) and
missed this repo's own bespoke, header-agnostic reader. If shared
compliance tooling is ever run against this repo and validates `Basis`
values, these 32 rows will read as non-conforming until a dedicated
revaluation pass runs — unowned, as stated above.

## External-Plan-Review-Findings

Two rounds (`--mode iterate`, both `openrouter`/`codex`). Round 1: both
`revise`. Round 2 (after fixes): glm `approve`, openai `revise` (the
diagnosis-vs-fix scope disagreement above, held after consideration).

| # | Round | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|---|
| 1 | 1 | openai | high | Renaming `Origin`->`Basis` while keeping provenance values makes the table semantically invalid against the closed vocabulary; "byte-for-byte converged" claim was overstated | accepted-and-fixed: added the explicit "header-converged, not value-converged" scope-decision section above (this ADR), naming the gap and its non-owner rather than leaving it implicit |
| 2 | 1 | openai | medium | Plan authorized only `spec.md` but promised the discrepancy reason "in the ADR" — file scope didn't include an ADR | accepted-and-fixed: named this ADR + its decision-drop explicitly in the mini-plan's file list |
| 3 | 1 | openai | medium | Verification (grep counts) doesn't check per-row table structure (column count, `Layers` position) | accepted-and-fixed: ran a structural check (`awk -F'\|'`, every header/separator/data row in the FR-table section == 9 pipe-delimited fields == 7 columns) before finalizing; documented as the reproducible command below |
| 4 | 1 | openai | low | Rename verified only in this repo; no cross-repo consumer check | accepted-and-fixed: grepped the monorepo for any reference to this repo's `spec.md` path — none found (only unrelated triage/decision-log prose mentioning the WebUI spec conceptually, no path-based consumer) |
| 5 | 1 | glm | medium | Basis-value gap has no named owner | accepted-and-fixed: same as #1 above — explicit "no unit owns this" statement added |
| 6 | 1 | glm | low | Separator-row widening not explicit in edit steps, only in verification | accepted-and-fixed: mini-plan's Change-detail #2 and this ADR both now state the separator widening explicitly; verified by the same structural check as #3 |
| 7 | 1 | glm | low | Cross-repo consumer risk (repeat of #4, phrased as risk) | accepted-and-fixed: same as #4 |
| 8 | 1 | glm | low | 29-vs-35 resolution recorded only in the ADR — a stale "35" could keep propagating from the campaign brief | rejected-with-reason: the campaign brief is a historical trigger artifact (the triage/campaign-decomposition record); correcting it retroactively is not this unit's authority, and the durable canonical record (this ADR + spec.md itself) is what future readers should cite going forward |
| 9 | 2 | openai | high | "Resolved" should mean the underlying mismatch is fixed, not diagnosed-and-recorded | rejected-with-reason: see "Scope boundary" section above — S8 is spec'd and design-classified as mechanical transformation; the AC's own wording ("resolved **with the reason recorded**") is satisfied by a full, sourced, re-measured record; the cleanup itself is out of scope and explicitly named as an unowned follow-on, not silently dropped |
| 10 | 2 | openai | medium | Basis semantic gap "can break future shared tooling" | rejected-with-reason: repeat of round-1 #1/#5, already addressed by the explicit scope-decision section; no such tooling exists in this repo today (confirmed empirically) |
| 11 | 2 | openai | medium | Decision-drop schema/location not verified before editing | rejected-with-reason: `write_decision_drop.py --help` was read and the tool was run successfully at F3 (this ADR + its decision-drop JSON exist); the finding pre-dated that step in sequence |

## External-Code-Review-Findings

Two rounds (`--mode code`, diff against `HEAD~1`). Round 1 was run against a
diff accidentally polluted by an uncommitted, unrelated working-tree change
to the shared `external_review_state.json` legacy marker (a record-keeping
side effect of Step 3.5, not a real code change) — both reviewers correctly
flagged this as suspicious; **fixed by amending the commit** to include the
legitimate review-bookkeeping artifacts (`miniplan.md`, `reviews.json`,
`risk_recheck.json`, the marker update) before re-diffing, matching this
repo's convention (verified: w1's own committed tree includes the same
class of files). Round 2 ran a clean diff.

| # | Round | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|---|
| 1 | 1 | glm/openai | high | Diff included a hand-looking rewrite of `external_review_state.json`'s recorded verdicts (key order, timestamp, verdict flip) | accepted-and-fixed: root cause was `git diff HEAD~1` (no second ref) diffing the WORKING TREE against `HEAD~1`, so an uncommitted, unrelated marker-file update leaked into the reviewed diff; committed that file (a legitimate, expected artifact of this run — confirmed against w1's own committed tree) before re-diffing |
| 2 | 1 | glm | high/medium | AC #3 ("resolved with reason recorded") unmet — no resolution record in the diff | accepted-and-fixed: this ADR + its decision-drop JSON now exist and are committed; F3 had not yet run when round 1's diff was taken (sequencing gap, not a missing decision) |
| 3 | 1 | glm | medium | Rows beyond the shown diff hunk might be malformed (6 cells vs 7-column header) | rejected-with-reason, empirically checked: the structural check (`awk`, all header/separator/data rows in the FR-table section) covers the WHOLE file, not just the shown hunk; result: 14 headers + 14 separators + 32 data rows, all exactly 9 pipe-delimited fields, zero exceptions |
| 4 | 2 | openai | medium | Decision-drop file referenced by the mini-plan is absent from the diff | accepted-and-fixed: same as #2 — written and committed after this finding |
| 5 | 2 | openai | medium | "Resolution" leaves the mismatch in place (32-vs-38) | rejected-with-reason: repeat of plan-review finding #9 — see "Scope boundary" section |
| 6 | 2 | glm | medium | Mini-plan's own file list contradicted itself ("no other file changes" then listing a second file) | accepted-and-fixed: mini-plan's "Files to create/modify" section corrected to list both `spec.md` and the ADR/decision-drop explicitly, worded to avoid the contradiction |
| 7 | 2 | glm | medium | Same diagnosis-vs-fix scope question, phrased again with no named follow-on owner | accepted-and-fixed (partial): explicit "no unit owns this" statement added (Scope boundary + Basis sections); a concrete NEW follow-on unit is not created by this ADR (per this repo's "don't reflexively create triage items" convention) — the state is disclosed, not a fabricated owner invented |
| 8 | 2 | glm | medium (edge-case) | Basis-value non-conformance risk once shared tooling runs here | rejected-with-reason: repeat of plan-review #1/#5/round-2 #10; already addressed |
| 9 | 2 | glm | low | No committed, reproducible structural check (manual grep-counting only) | accepted-and-fixed: the exact `awk -F'\|'` command used is recorded verbatim below (Self-Review, item 4) as the reproducible check; no new permanent test file added (this repo vendors no FR-table parser/tooling at all, so a bespoke one-off validator for a single small-complexity docs edit would itself be the premature-tooling pattern the bloat checklist rejects) |
| 10 | 2 | glm | low | `code`/`spec`/`doubt` reviews recorded `not_run`, so nothing caught finding #4 (the missing decision drop) before this round | disclosed, known limitation: this runner has no Agent tool and cannot spawn those subagents (ADR-029/campaign-mode.md 3f-bis); the orchestrator runs that cascade before merge and promotes the rows — sequencing this ADR's write BEFORE the orchestrator's pass is exactly what closes this gap in practice |

**Structural verification (the reproducible command, run and green after
every edit):**

```
awk -F'|' '
/^### Area / { in_fr=1; next }
/^## / && !/^## Functional Requirements/ { in_fr=0 }
in_fr && /^\| ID \| Area \| Name \| Priority \| Description \| Basis \| Layers \|$/ { next }
in_fr && /^\|----/ { next }
in_fr && /^\| FR-01\./ { if (NF != 9) print NR": BAD ROW NF="NF; else count++ }
END { print "OK rows with NF==9:", count }
' .shipwright/planning/01-adopted/spec.md
```

Result: `OK rows with NF==9: 32`, zero `BAD ROW` lines; all 14 headers and 14
separators also independently confirmed at `NF==9`.

## Self-Review

1. **Spec Compliance** — PASS. All 3 sub-iterate ACs satisfied: Origin
   renamed Basis in the adopted `spec.md` (zero remaining FR-table `Origin`
   header occurrences there; the two residual `Origin` hits in `spec.md`
   are unrelated WS-CORS prose, confirmed by content). **Correction
   (Stage-1 spec review, 2026-09-07):** "repo-wide grep returns zero hits"
   was inaccurate — three synthetic fixture/test documents still construct
   the pre-retrofit FR-table shape: `server/src/core/mission-context/fold-map.test.ts:20`,
   `client/e2e/helpers/mission-s3-fixtures.ts:93`,
   `client/e2e/flows/mission-artifacts-s1.spec.ts:184`. These are out of
   this unit's scope (the sub-iterate spec retrofits the adopted FR table,
   not synthetic sample documents) and harmless (`fold-map.ts`'s parser is
   positional, not header-aware, so it ignores the header row entirely) —
   left deliberately, not missed. Layers column present with literal
   `(inferred)` in all 32 rows; 29-vs-35 traced to its source, re-measured,
   and recorded (this ADR).
2. **Error Handling** — N/A/PASS. Pure Markdown edit; no runtime error
   paths introduced or touched.
3. **Security Basics** — PASS. No secrets, no auth surface, no code
   touched; docs-only.
4. **Test Quality** — PASS. No vendored FR-table parser/tests exist in this
   repo to extend; verification is the structural `awk` check above
   (deterministic, whole-file, re-run and green), plus the full existing
   unit/typecheck/lint suites at F0 confirming zero code-behavior impact.
5. **Performance Basics** — N/A/PASS. Docs-only.
6. **Naming & Structure** — PASS. Column names match the monorepo's
   converged shape exactly (verified against `shipwright/shared/fr-
   authoring.md` §4a and the monorepo's own live `spec.md`); CRLF line
   endings preserved consistently (confirmed: 100% CRLF before and after).
7. **Affected Boundaries (ADR-024)** — PASS, corrected. `spec.md`'s FR
   table is a producer read by the monorepo's shared
   `_fr_table_columns.py`-based tooling family, cross-repo-confirmed safe
   (grepped the sibling monorepo for any reference to this repo's
   `spec.md` path — none found; the shared reader resolves columns by
   name, first-match-wins, no positional assumption, so the rename is
   compatible with it by construction). **Correction (Stage-1 spec review,
   2026-09-07):** the earlier claim "this repo does not vendor or run any
   such consumer… no real in-repo round-trip to probe" was wrong — there
   IS an in-repo consumer, `server/src/core/mission-context/fold-map.ts`
   (`SPEC_REL_PARTS`, L29), and unlike the monorepo's reader it resolves
   `Name`/`Description` **positionally** at `cols[2]`/`cols[4]` (L105-106),
   not by header name. The round-trip probe actually needed was: do the
   two new columns land at indices 5-6, past every index `fold-map.ts`
   reads? Yes — both are right-edge appends, so indices 0-4 (and this
   reader's behavior) are untouched. Safe, but for a different, narrower
   reason than originally recorded.

## Confidence Calibration

Not triggered: effective complexity is `small` (Step 3.4 diff-risk recheck:
no upgrade, no risk flags — the diff is a one-file Markdown edit that
matches none of the diff-driven detectors), and `touches_io_boundary` is not
set. Self-Review above is the only review for this class of change, per the
sub-iterate runner's own contract.

## Consequences

`spec.md`'s FR table is header-converged with the monorepo's shape
(`Basis`, `Layers` present, correctly named, correctly ordered) — any
shared, name-resolving FR-table tooling now reads this repo's table
correctly by column name. Two follow-ons are recorded as explicitly
unowned, not silently dropped: (a) the 17 orphaned AC-heading blocks
(`FR-01.07`…`FR-01.26`) left over from the 2026-07-17 taxonomy fold, and
whether their content migrated into their survivors' ACs; (b) revaluing the
32 `Basis` cells' provenance-string values into the closed 6-value
vocabulary, needed only if/when shared compliance tooling ever validates
this repo's `Basis` column. No code, tests, or CI touched; zero runtime
behavior change.

## Rejected alternatives

- Coercing the 32 existing `Origin`/`Basis` cell values into the closed
  vocabulary now — rejected: a judgement-heavy editorial pass (which value
  each historical provenance string becomes is not mechanically
  derivable), out of this small-complexity unit's scope, and not what the
  sub-iterate spec's AC asks for ("renamed", not "revalued").
- Cleaning up the 17 orphaned AC-heading blocks in this same unit —
  rejected: a content audit (does each block's substance already live in
  its survivor's ACs, or does it need to move?), categorically different
  work from a mechanical column-shape retrofit, and explicitly marked
  "open"/future work by the monorepo's own design spec, not a defined
  deliverable of S8.
- Inventing a named follow-on campaign/triage item for either gap above —
  rejected for this ADR: this repo's convention is not to reflexively
  create triage cards; both gaps are disclosed here in full so an operator
  can decide whether and how to file follow-on work, rather than this unit
  presuming to schedule it unasked.
