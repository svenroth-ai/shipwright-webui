# Mini-Plan: w2 — Form convergence (S8): Origin -> Basis, add the Layers column

run_id: iterate-2026-09-07-w2-form-convergence
campaign: req3-06-mechanics-webui

## Files to create/modify

- `.shipwright/planning/01-adopted/spec.md` (edit only) — the 14 per-area
  Functional-Requirements sub-tables; the only PRODUCT/CONTENT file touched
  by this unit (pure documentation retrofit, no code touched).
- `.shipwright/agent_docs/decision-drops/iterate-2026-09-07-w2-form-convergence_001.json`
  + `.shipwright/planning/adr/iterate-2026-09-07-w2-form-convergence.md`
  (new, via F3 `write_decision_drop.py`) — the durable record of the resolved
  29-vs-35 discrepancy (Change detail #3) and the explicit Basis
  header-vs-value convergence-scope decision (Change detail #1a), per this
  repo's convention that an iterate's reasoning belongs in the decision log,
  never appended to `spec.md` itself.
- Standard per-run finalization artifacts (F4 changelog drop, F5/F5c test-
  results ledger + iterate entry) per every sub-iterate's own contract —
  not enumerated here since they carry no unit-specific content.

## Component hierarchy

N/A — spec-only change, no UI/API surface.

## Data model changes

None (spec.md is Markdown documentation, not a serialized data format any
runtime code reads). The sibling monorepo's shared FR-table reader
(`shared/scripts/lib/_fr_table_columns.py`) resolves columns by NAME via a
header map, so a renamed/added column is read correctly by that reader
class of tool without any code change here; this webui repo does not
itself vendor or run that reader (confirmed: no `_fr_table_columns` /
`fr_table_reader` / `check_fr_hygiene` tooling exists under this repo).

## Change detail

1. **Origin -> Basis.** All 14 `| ID | Area | Name | Priority | Description |
   Origin |` header rows (one per `### Area <CODE>` sub-table) renamed to
   `| ID | Area | Name | Priority | Description | Basis | Layers |`, matching
   the monorepo's converged shape byte-for-byte (`fr-authoring.md` §4a; cross-
   checked against `shipwright/.shipwright/planning/01-adopted/spec.md`'s own
   live table). Column ORDER preserved: Name stays left of Description (the
   sub-iterate spec's explicit load-bearing constraint) — only two columns are
   appended at the right edge.
   - The **existing cell values** (iterate-slug / enrichment-source
     provenance strings, e.g. `crawl+enrichment`, `iterate-2026-07-09-w3`) are
     carried over unchanged under the renamed `Basis` header. This is a
     structural rename, not a value migration: the monorepo's own
     `_fr_table_columns.py` docstring is explicit that `Origin`/`Source`
     values (file paths / iterate slugs — "where we looked") are a different
     kind of fact than the closed `Basis` vocabulary
     (`interview`/`code`/`observed`/`tests`/`assumed`/`other` — "how we know
     the requirement"), and deliberately keeps them un-scored for exactly
     that reason. Recoercing 32 rows of historical provenance strings into
     that 6-value vocabulary is a separate, judgement-heavy editorial pass
     (which value each historical string should become is not mechanically
     derivable) and is out of this unit's scope — the sub-iterate spec's own
     AC is "Origin is renamed Basis everywhere it is read", a naming change,
     not a revaluation.
   - **Explicit scope decision (addressing the external-review finding that
     this gap needed a named owner):** this table is, after this unit,
     **header-converged but not value-converged** on the `Basis` column.
     Neither w4 (tagging backfill — test-tag scope only) nor w5 (bind-and-
     promote — Layers-column promotion only, per its own spec) claims the
     Basis-value revaluation; no unit in this campaign owns it. It is
     recorded here as a deliberate, currently-unowned follow-on (not a
     silent gap) precisely so a future reader does not have to re-derive
     that state: if any compliance tooling ever validates `Basis` cell
     values against the closed vocabulary, this repo's 32 rows will read as
     non-conforming until a dedicated pass maps each provenance string to
     `interview`/`code`/`observed`/`tests`/`assumed`/`other`. Confirmed
     empirically (grep, this run): no such validator exists in this repo
     today, so nothing is broken by shipping the header-only rename now.
2. **Layers column added.** Appended as the last column of all 14 headers +
   all 32 data rows, cell value the literal `(inferred)` for every row (the
   campaign's own German intent text: "alle Zellen (inferred)"; the
   sub-iterate spec: "Every Layers cell starts (inferred); promotion is w5's").
   w5 (bind-and-promote) is the unit that later promotes individual cells to a
   bare declared value (e.g. `unit, e2e`) once AC-to-test binding proves
   coverage — this unit only lays the column down.
3. **29-vs-35 discrepancy — resolved, source found and verified.** The phrase
   is not this repo's own coinage: it is a direct quote from the monorepo's
   own `Spec/design/2026-07-22-req3-campaign-SPEC.md` §2/§2.1 ("Gemessener
   Ausgangszustand"), the design document this whole REQ3 campaign family
   implements. That document's own table states, for the WebUI as measured
   on 2026-07-22: **"FRs | 15 | 29 (35 AC-Blöcke — Diskrepanz zu klären)"**
   — i.e. **29 living FR table rows** vs **35 `### FR-01.NN` Acceptance-
   Criteria heading blocks** in the same `spec.md`, an internal-consistency
   gap the design doc flagged as needing resolution, not a cross-repo or
   cross-tool disagreement.
   - **§2.1 of that same document already explains the gap** (measured
     2026-07-22, decomposing 35 into 3 buckets): 17 AC-blocks
     (`FR-01.07`…`FR-01.26`) are orphaned leftovers from the 2026-07-17
     taxonomy fold — their table rows were folded away (per `## FR-Fold-Map`)
     but their AC-heading sections were never deleted; 11 living table rows
     (`FR-01.37`…`FR-01.65`) had no AC-block at all; the remaining 18 living
     FRs had both a row and a block (matches the document's separately-
     stated "18/29 FRs mit Akzeptanzkriterien" line). It explicitly flags
     whether the folded content actually migrated into the survivor's ACs
     as **still open**, i.e. real cleanup, not a formality.
   - **Re-measured today (this run, 2026-09-07), same method:** `spec.md`
     now has **32** living `| FR-01.NN |` table rows (independently confirmed
     three ways: `spec.md` itself, `traceability-matrix.md`'s `rtm-fr-`
     anchors, `test-traceability.json`'s `requirements` object) and **38**
     `### FR-01.NN` AC-heading blocks. The +3/+3 growth in both numbers is
     exactly the three capability FRs minted after the 2026-07-22 snapshot
     and never retired (`FR-01.70` Leads org route, `FR-01.71` Organization
     overview for AI leads, `FR-01.72` Lead-question inbox). Re-running the
     same set decomposition today: the same **17** orphaned folded-ID
     AC-blocks (`FR-01.07`…`FR-01.26`, byte-identical set — no further
     folding happened since 2026-07-17), **11** living rows still without an
     AC-block (`FR-01.37, 45, 47, 48, 49, 50, 51, 59, 64, 65, 72`), and **21**
     living FRs with both (up from 18 — `FR-01.70` and `FR-01.71` each
     picked up an AC-block after minting; `FR-01.72` has not yet).
   - **Resolution recorded:** "29-vs-35" was never a wrong number to correct
     — it is an accurately-measured, already-diagnosed internal mismatch
     between two different countable things in the same document (live
     table rows vs. AC-heading blocks), caused by the 2026-07-17 fold
     leaving 17 orphaned AC sections behind. The mismatch still exists today
     (now 32-vs-38, same root cause, same 17-orphan set, unchanged), and the
     open cleanup question from 2026-07-22 (whether the 17 folded-delta
     AC-blocks' content actually migrated into their survivors' ACs) is
     **still open** — it was not resolved by any iterate between 2026-07-22
     and today. This unit does not perform that cleanup (out of scope per
     the sub-iterate spec — only Origin->Basis and Layers are in scope); it
     records the up-to-date measurement and the still-open follow-on
     explicitly, so a future reader does not have to re-derive it. Full
     citation + numbers recorded in the iterate ADR (F3).

## Test strategy

No test suite exercises `spec.md` prose directly in this repo (no
`_fr_table_columns`/`check_fr_hygiene` tooling vendored here). Verification is:
- `grep`-count re-check after edit: 32 `| FR-01.NN |` rows, 14 renamed
  headers, 14 widened separator rows, 32 `(inferred)` Layers cells — all
  counted and asserted equal before finalization.
- Full existing test suites (server + client unit, typecheck, lint) run
  unchanged at F0 to confirm the docs-only edit has zero code-behavior
  impact (no source file touched).
- `client/src/test/doc-sync.test.ts` (the meta-test that guards
  CLAUDE.md/architecture.md/component_inventory.md token sync) is unaffected
  — it does not read `spec.md`'s FR table.

## Acceptance criteria mapping

- "Origin is renamed Basis everywhere it is read" -> all 14 header rows
  renamed; repo-wide `grep` for the FR-table `Origin` header confirms zero
  remaining occurrences (the two residual `Origin` hits in spec.md are
  unrelated WS-CORS prose, verified by content).
- "Layers exists with every cell (inferred)" -> 14 headers + 32 rows, each
  Layers cell literal `(inferred)`, `grep`-counted.
- "The 29-vs-35 discrepancy is resolved with the reason recorded" -> see
  Change detail #3 above; recorded verbatim in the iterate ADR (F3).

## Risk notes

Pure documentation edit, one file, no code/test/CI touched. No risk flags
from Step 3.4's diff-driven re-check (diff is 120 LOC over `spec.md` only,
which does not match any of the diff-driven detectors — `touches_io_boundary`,
`touches_auth`, `touches_rls`, `touches_migrations`, `touches_billing`,
`touches_shared_infra`, `touches_public_api`, `touches_build`,
`touches_ci_supplychain`, `cross_split`). The 100-LOC diff-size arm alone
triggers the mandatory External Plan Review / Code Review Cascade gates
(Step 3.5/3.7) even though nothing else about this change is risky.
