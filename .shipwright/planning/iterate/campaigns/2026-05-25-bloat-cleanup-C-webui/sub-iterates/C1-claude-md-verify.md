# Sub-Iterate C1 — CLAUDE.md verification (Phase 0f already handled the split)

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C1
- **Risk:** Niedrig (no code change)
- **Complexity:** small (verification + documentation only)
- **Surface:** `cli`
- **Branch base:** origin/main (first in chain)
- **Type:** change

## Pre-condition discovery (load-bearing)

At Campaign-C planning time, CLAUDE.md on `origin/main` (post Phase 0f compliance-hygiene cleanup, PR #55) is **197 LOC** — already below the 300-LOC source limit AND **not in `shipwright_bloat_baseline.json`**. The source plan's premise ("CLAUDE.md ~1.600 LOC → Kern ~200 + references/{...}") is stale: Phase 0f organically removed file-tree detail and pushed structural references into `.shipwright/agent_docs/architecture.md` + `component_inventory.md` (see CLAUDE.md line 20: "Detailed file-tree details (which rot fast and duplicate architecture.md / a live `ls`) were removed in the Phase 0f compliance-hygiene cleanup.").

**Therefore C1 is reframed as a Verification Iterate**: empirically confirm the target state, document the organic Phase-0f outcome, and produce a tiny PR that codifies the verification. **No code change.** Topology integrity preserved (C1 stays as first node in stacked chain).

## Goal

Verify that `CLAUDE.md` already meets the Campaign-C target state (Kern ≤ 300 LOC, no bloat-baseline entry, references factored out organically) and document the Phase-0f outcome in a small note so a future auditor doesn't re-open the C1 question.

## Acceptance Criteria

- [ ] (E) `CLAUDE.md` LOC ≤ 300 — verified empirically via pytest probe at F0.5.
- [ ] (E) No entry for `CLAUDE.md` exists in `shipwright_bloat_baseline.json` — verified via pytest probe at F0.5.
- [ ] (E) `client/src/test/doc-sync.test.ts` passes — guards CLAUDE.md ∪ architecture.md ∪ component_inventory.md file-map bundle (per ADR-044, rule 11 in CLAUDE.md). Empirically run via `cd client && cmd /c node_modules\\.bin\\vitest.cmd run src/test/doc-sync.test.ts` (Windows: cmd-wrapper not bare npm).
- [ ] (E) Campaign-C verification note in `.shipwright/planning/adr/<NNN>-campaign-c-c1-verification.md` explaining Phase-0f organic split — exists and contains the cross-reference to PR #55 + commit f4d52fd.
- [ ] (E) PR description includes the bloat-check workflow's PR-comment showing zero allowlist-diff (no entries added, no entries removed — pure verification).

## Spec Impact

- **Classification:** none
- **NONE justification:** Verification iterate with no functional or architectural change. CLAUDE.md content unchanged; only adds a campaign-C verification note to `.shipwright/planning/adr/`.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| (none — pure verification) | (none) | n/a |

`touches_io_boundary` = no. Boundary Probe sub-step not required.

## Verification (F0.5)

- **Surface:** `cli`
- **Runner command (probe 1 — LOC + baseline assertion):**
  ```bash
  uv run --with openai pytest .shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c1_verify.py -v
  ```
  Where `_c1_verify.py` is authored by this iterate (~30 LOC) and asserts:
  - `Path("CLAUDE.md").read_text().count("\n") + 1 <= 300`
  - `"CLAUDE.md" not in [e["path"] for e in json.loads(Path("shipwright_bloat_baseline.json").read_text())["entries"]]`
- **Runner command (probe 2 — doc-sync.test.ts):**
  ```bash
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/test/doc-sync.test.ts
  ```
- **Evidence path:** `.shipwright/runs/<run_id>/surface_verification.json` + pytest log + vitest log.
- **`tests_run` MUST be ≥ 2** (pytest assertions + vitest cases). Zero matches → fail.

## Confidence Calibration

- **Boundaries touched:** none.
- **Empirical probes run:** (1) LOC count of CLAUDE.md on disk; (2) JSON parse of bloat baseline + membership assertion; (3) vitest doc-sync run.
- **Edge cases NOT probed + why acceptable:** N/A — no boundaries touched.
- **Confidence-pattern check:** runner records explicitly in the iterate ADR.

## External Review + Code Review (ADR-029)

- Step 3.5 External LLM Plan Review: **SKIP justified** — this iterate writes a ~30-LOC pytest + a short ADR note, no functional code, no FR impact. Record `reviews.plan.status = "skipped_trivial_verification"` in result-JSON.
- Step 3.7 Code-Review-Cascade: **SKIP justified** — same reasoning. Record `reviews.code.status = "skipped_trivial_verification"`.

## Hard constraints

- DO NOT edit `CLAUDE.md` content itself in this iterate (Phase 0f outcome should stand verbatim).
- DO NOT touch `scripts/hooks/anti_ratchet_check.py` (canonical-source-hash pin: `99020b73f7f5f8ca8b5540ead53ddf78b9cd86f9184ede0ddfbd00a21b2318b1`).

---

(Cleanup-Invariant block applies. For C1: cases (a)/(b) do NOT apply because there is no baseline entry to remove. The cleanup-invariant gate passes trivially.)

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the full invariant block.
