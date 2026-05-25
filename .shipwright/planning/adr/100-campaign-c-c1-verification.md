# ADR-100 spec — Campaign C, sub-iterate C1: CLAUDE.md verification (Phase-0f organic outcome)

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-100.
**Status:** accepted.
**Date:** 2026-05-25.
**Section:** Campaign C — WebUI bloat cleanup, sub-iterate C1.
**Predecessors:** Phase 0f compliance-hygiene cleanup (PR #55, commit `f4d52fd`).
**Run ID:** `sub_iterate-20260525-213548`.

## Context

The Campaign-C source plan listed C1 as the first split: "`CLAUDE.md` ~1.600 LOC → Kern ~200 + references/{...}". When C1 was opened on 2026-05-25 the premise was already false on `origin/main`:

- `CLAUDE.md` was **197 LOC**, well below the project-wide 300-LOC source limit.
- `CLAUDE.md` was **not** an entry in `shipwright_bloat_baseline.json`.

The cause is Phase 0f compliance-hygiene cleanup (PR #55, commit `f4d52fd`), which removed file-tree details from `CLAUDE.md` and pushed structural reference content into `.shipwright/agent_docs/architecture.md` + `component_inventory.md`. That cleanup organically achieved the outcome the source plan called for. `CLAUDE.md` line 20 already records the move: *"Detailed file-tree details (which rot fast and duplicate architecture.md / a live `ls`) were removed in the Phase 0f compliance-hygiene cleanup."*

## Decision

C1 is reframed from "Split CLAUDE.md" to **Verification Iterate**:

1. Author a tiny pytest probe — `.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c1_verify.py` — that asserts both invariants empirically (LOC ≤ 300, no baseline entry).
2. Run the probe at F0.5 alongside the existing `client/src/test/doc-sync.test.ts` guard.
3. Document the outcome here so a future auditor doesn't re-open the C1 question.
4. Make no code change to `CLAUDE.md` itself (the Phase-0f outcome stands verbatim).

`CLAUDE.md` keeps its current 197 LOC. The stacked-chain topology for Campaign C is preserved (C1 remains the first node).

## Empirical evidence

- **pytest probe** (this iterate): `_c1_verify.py` — 2/2 passed.
  - `test_claude_md_within_loc_limit` — 197 ≤ 300.
  - `test_claude_md_not_in_bloat_baseline` — `CLAUDE.md` ∉ baseline entries.
- **vitest doc-sync guard**: `client/src/test/doc-sync.test.ts` — 20/20 passed. Guards the CLAUDE.md ∪ architecture.md ∪ component_inventory.md file-map bundle per CLAUDE.md rule 11 (ADR-044).

## Confidence Calibration

- **Boundaries touched:** none. This iterate writes a probe + ADR + changelog fragment; no producer/consumer of any serialised format is modified.
- **Probes run:** (1) LOC count of `CLAUDE.md`; (2) JSON-parse of `shipwright_bloat_baseline.json` + membership assertion; (3) vitest doc-sync run.
- **Edge cases not probed + why acceptable:** n/a — no boundaries touched, no I/O contract.
- **Confidence-pattern check:** the verification is an empirical fact-check against the working tree, not an unfalsifiable "are you confident?" — the probe is the answer.

## External Review + Code Review (ADR-029)

- Step 3.5 (External LLM Plan Review): **SKIP** — verification iterate, ~30 LOC of pytest + a short ADR note, no functional code, no FR impact. Recorded as `reviews.plan.status = "skipped_trivial_verification"` in `result.json`.
- Step 3.7 (Code-Review Cascade): **SKIP** — same reasoning. Recorded as `reviews.code.status = "skipped_trivial_verification"`.

## Self-Review (7-item)

1. **Spec Compliance** — pass. Spec called for verification + ADR; both delivered.
2. **Error Handling** — pass. Probe asserts existence before reading.
3. **Security Basics** — pass. Read-only filesystem access; no inputs.
4. **Test Quality** — pass. Two focused assertions, descriptive failure messages.
5. **Performance Basics** — pass. O(file-size) line count; negligible.
6. **Naming & Structure** — pass. Underscore-prefixed test file (`_c1_verify.py`) avoids pytest-discovery noise outside this iterate.
7. **Affected Boundaries** — pass. None touched. The probe reads `CLAUDE.md` + `shipwright_bloat_baseline.json` but does not modify or re-serialise them.

## Consequences

- The Campaign-C topology is preserved: C1 stays first in the stacked chain so C2 (`server/src/external/routes.ts` split) bases on C1, not on `origin/main`.
- Future auditors see this ADR + the probe + commit `f4d52fd` together and don't need to re-derive the "why didn't C1 split CLAUDE.md" question.
- If a later iterate causes `CLAUDE.md` to cross 300 LOC again, the probe in this iterate fails and the regression is caught at gate time.
