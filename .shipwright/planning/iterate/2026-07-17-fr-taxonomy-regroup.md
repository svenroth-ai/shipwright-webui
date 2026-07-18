# Iterate Spec: fr-taxonomy-regroup

- **Run ID:** iterate-2026-07-17-fr-taxonomy-regroup
- **Type:** change (spec-hygiene refactor, behavior-neutral)
- **Complexity:** medium
- **Status:** draft

## Goal
Restructure `.shipwright/planning/01-adopted/spec.md`'s Functional-Requirements table from ~66 mixed-altitude rows into **area-grouped capability FRs with stable `FR-01.NN` IDs**, folding endpoint-FRs into Interface bullets and delta-FRs into parent Acceptance-Criteria, and adding a separate `## FR-Fold-Map` alias table. Rationale + full mapping: `Spec/design/2026-07-17-fr-taxonomy-regrouping.md`.

## Acceptance Criteria
- [ ] AC1 — The FRs are reorganised into **14 per-area sub-tables** (parser-verified layout), each under a `### Area <CODE> — <name>` heading — codes BRD/TSK/TRM/INB/PRJ/ACT/RUN/CMP/TRG/PRV/INS/FDR/UX/PLT (Mission = FR-01.66 lives under **TSK** "Task Detail, Mission & Transcript") — each sub-table repeating the header row `| ID | Area | Name | Priority | Description | Origin |` so the header-driven compliance parser (`_requirement_parse.py`) re-reads its colmap per sub-table (FR-ID stays **column 0**; a `priority` header is present; `Area` is an ignored-by-parser extra column). Exactly **29 surviving FR rows** total remain (IDs: 01,02,03,04,05,06,10,16,17,27,28,29,30,31,33,35,37,38,43,45,47,48,49,50,51,59,64,65,66).
- [ ] AC9 — **Descriptions are plain business language** (product-owner readable): the "what" + behavioural guarantees kept, implementation "how" (file paths, ADR numbers, symbols, HTTP verbs, library names) dropped; each carries a one-line `**Updates:**` history of its iterate changes + folded deltas where any exist. No genuine behavioural requirement lost.
- [ ] AC10 — **`Source` (file-path) column dropped** (architecture.md territory; no test/parser consumes it); `Origin` (iterate-slug provenance) kept. Table is `ID·Area·Name·Priority·Description·Origin`.
- [ ] AC11 — **Abstract rewritten to the current model** (auto-execute in the embedded terminal, current feature surface, the two hard rules) — no stale copy-command narrative.
- [ ] AC2 — Every one of the **37 folded FR IDs** (07,08,09,11,12,13,14,15,18,19,20,21,22,23,24,25,26,32,34,36,39,40,41,44,46,52,53,54,55,56,57,58,60,61,62,63,67) appears exactly once in the new `## FR-Fold-Map` table with a target survivor FR + a reason ∈ {endpoint, delta, dup}. No folded ID remains as a `| FR-01.NN |` row.
- [ ] AC3 — No survivor FR loses information: each folded FR's substance is preserved either as an `Interfaces:` bullet in the target's Description (endpoints) or as an AC line under the target (deltas), with the original `(iterate-…)` provenance tags kept verbatim.
- [ ] AC4 — Remap scope is bounded to **the 68 test-file `@fr`/string tags** of folded IDs → their survivor target, so compliance traceability shows **0 orphan FR tags** and `client/src/test/doc-sync.test.ts` is green. The **104 non-test source-comment provenance references** (e.g. `// FR-01.44 …`) are **intentionally left in place** — they carry finer-grained provenance than the umbrella survivor and stay resolvable via the Fold-Map. (Empirical measure: 252 live folded-ID refs across 172 files in `client/src`+`server/src`; 68 test / 104 source. Verified during Confidence probe 1; if the traceability audit also flags source comments, those are remapped too.)
- [ ] AC7 — A new `## How to read & extend this spec (requirements taxonomy)` section is added, stating: capability altitude, Area grouping, stable/immutable IDs, folded-IDs-resolve-via-Fold-Map, source-comment-provenance-left-in-place, and the extend rules (fold as AC, don't mint sibling deltas; new FR = next free `FR-01.NN` under its area). Orients future iterates incl. the Mission Control rebuild.
- [ ] AC5 — Historical/immutable files are byte-untouched: `shipwright_events.jsonl`, `CHANGELOG.md`, `CHANGELOG-unreleased.d/**`, `Spec/prototype/**`. (git diff shows zero changes to these paths.)
- [ ] AC6 — No FR ID is renumbered (every survivor keeps its exact `FR-01.NN`); no new FR is minted; `npm run build && npm run test` green in both workspaces.

## Spec Impact
- **Classification:** **none** (behavior-preserving) → No-FR branch, `change_type=docs`.
- **ADD / MODIFY / REMOVE:** none in the **behavioural** sense — no FR's observable behaviour changes; the heavy spec.md edit restructures the requirements **documentation** (area grouping, capability-altitude names, business-language descriptions, `Source` column dropped, endpoint/delta rows folded into their owning capability + a `## FR-Fold-Map` alias table + an updated Abstract). The app behaves identically.
- **NONE justification:** behavior-preserving requirements-documentation restructure — regroup into 14 areas, rename to capability altitude, rewrite descriptions in plain business language, fold 37 endpoint/delta rows into their capability (recorded in the Fold-Map, IDs stable), refresh the Abstract; zero runtime/behaviour change, zero code touched. The F11 spec-edit requirement is satisfied (spec.md is heavily edited).

## Out of Scope
- **No renumber** of any FR ID (hard constraint — event-log/history coupling, §1.3 of the design doc).
- No touching `shipwright_events.jsonl`, `CHANGELOG*`, `Spec/prototype/**` (historical).
- No runtime/product code change; no behavior change; no new FR minted.
- The monorepo plugin fixes (adopt/iterate/compliance) — separate triage `trg-8e840ca0` in `../shipwright`.
- Teaching the compliance audit to resolve Fold-Map aliases — a monorepo change (out of scope; instead we remap live refs).

## Design Notes
n/a (no UI/mockup change — this is a spec/traceability artifact refactor).

## Affected Boundaries
The FR-ID namespace is a soft contract consumed by traceability. No serialized *format* changes; the change is which IDs appear as FR rows.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `spec.md` FR table (FR-ID set) | `doc-sync.test.ts`, compliance traceability audit, test `@fr` tags, `plan.md` | Markdown table / FR-ID string tags |

No `touches_io_boundary` risk flag (no `.env`/`*_config.json`/`*_state.json` producer-consumer). Remap of live folded-ID references is the boundary-safety step.

## Confidence Calibration
- **Boundaries touched:** FR-ID namespace → traceability consumers (doc-sync, compliance audit, test tags, plan.md).
- **Empirical probes run (ALL DONE — results):**
  0. Read `_requirement_parse.py`: header-driven (column-name), FR-ID must stay col 0, extra `Area` column ignored, section headings skipped. `doc-sync.test.ts` reads CLAUDE.md/architecture.md/component_inventory.md, **not** the FR table. → per-area sub-tables + Area column are parser-safe; no doc-sync FR-table risk.
  1. **Faithful parser-simulation over the whole new spec.md** (mirrors the real row-detection): **29 active FRs parsed** (== the 29 survivors), **0 folded IDs seen as active**, 0 duplicates, 0 survivors missing. The `## FR-Fold-Map` ID cells are backticked → the `^FR-\d{2}\.\d{2}$` gate skips them.
  2. **Tag corpus:** `grep` for real traceability tags (`@FR-…` / `@covers FR-…`) across `client`+`server` → **ZERO exist in the repo**. So folding causes **0 orphans** (there are no FR tags to orphan); the remap is a genuine no-op. The 252 bare `FR-01.NN` refs (68 test-file / 104 source) are comments the collector never reads.
  3. `git diff --cached` confirms events.jsonl/CHANGELOG*/prototype **byte-untouched**; only 4 files changed (spec.md + design doc + 2 planning files); **zero code**.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | 29 survivor rows + Area column + 14 area headers | tested | grep: 29 survivor rows / 29 distinct IDs / 14 `### Area` headers |
  | 2 | 37 folded IDs in FR-Fold-Map; 0 folded IDs as an active FR row | tested | parser-sim: 29 active, 0 folded-active; fold-map rows == 37 |
  | 3 | 0 orphan-causing folded-ID references | tested | 0 `@FR`/`@covers FR` tags exist repo-wide → folding orphans nothing |
  | 8 | Every folded ID exactly ONE Fold-Map row; provenance (original name) preserved per row | tested | fold-map count == 37; each row carries `Was (original name)` |
  | 4 | doc-sync + doc-link/anchor consumers green | tested | 5 files / 133 tests PASSED (incl. `#fr-0101` survivor anchor) |
  | 5 | Compliance parser sees exactly the 29 survivors (no resurrection) | tested | parser-sim active==29; full audit re-runs at F5b |
  | 6 | Historical files byte-untouched; zero code changed | tested | `git diff --cached`: 4 doc/planning files, 0 code, 0 historical |
  | 7 | Client suite + typecheck green | tested | client vitest 2695/2695 PASSED; client+server `tsc --noEmit` clean |

- **Confidence-pattern check:** asymptote — the remap is a mechanical grep-sweep with a re-grep verification (probe 1), not "I re-read it". Coverage — all 7 ledger rows `tested`, 0 untested-testable.

## Verification (medium+)
- **Surface:** none
- **Runner command:** n/a — no startable surface behavior changes; verification is the meta-test suite (doc-sync + compliance traceability + build/test), executed at F0.
- **Evidence path:** `shipwright_test_results.json` `iterate_latest`.
- **Justification (surface=none):** This iterate edits only the requirements/traceability documentation and remaps FR-ID string tags in tests; no API route, store, UI, or runtime code path changes — there is no user-facing surface to drive. The backend-affects-frontend rule does not apply (no code consumed by the UI is touched).
