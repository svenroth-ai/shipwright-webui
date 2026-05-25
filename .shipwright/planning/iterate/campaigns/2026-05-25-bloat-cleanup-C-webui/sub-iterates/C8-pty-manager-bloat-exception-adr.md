# Sub-Iterate C8 — pty-manager.ts state=exception ADR (no code split)

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C8
- **Risk:** Null (Doku only)
- **Complexity:** small (ADR + baseline entry-state flip only)
- **Surface:** `cli`
- **Branch base:** C1's branch (stacked)
- **Type:** change

## Goal

Acknowledge `server/src/terminal/pty-manager.ts` (1198 LOC) as a **deep module** per Ousterhout's "Modules should be deep" principle (narrow public interface — `attach()` / `spawn()` / `flushMirrorSnapshot()` / `detachAndCount()` — with substantial, atomically-coupled internal behavior: PTY spawn + backpressure + idle + scrollback + headless-mirror serialization). Splitting would expose internals that should stay encapsulated.

Transition the baseline entry from `state=grandfathered` (anonymous TODO) to `state=exception` (named accepted decision) with a written ADR. **No code change to pty-manager.ts.**

## Acceptance Criteria

- [ ] (E) `.shipwright/planning/adr/<NNN>-bloat-exception-pty-manager.md` exists, follows the `_template-bloat-exception.md` shape (sourced from sibling shipwright clone), and fills:
  - Status, Date, Re-Review-Date (3 months out by default: 2026-08-25)
  - Incident Reference (Campaign C / this iterate run-id)
  - Context (PTY lifecycle as a single concern)
  - Ousterhout Argument (deep module justification; explicit list of atomically-coupled responsibilities)
  - YAGNI Check (none of pty-manager's responsibilities can be removed today)
  - Chesterton-Fence Check (git history / ADR-067 / ADR-068-A1 establish the deep-module shape)
  - Decision (raise allowed LOC for this file to current 1198; retire only when an auth layer is added that genuinely separates concerns)
  - Consequences (which downstream tests now operate against the new limit)
  - Rejected alternatives (≥1: "just split spawn from scrollback")
- [ ] (E) `shipwright_bloat_baseline.json` entry for `server/src/terminal/pty-manager.ts` changes from `state=grandfathered` + `adr=null` to `state=exception` + `adr="<NNN>"` — verified empirically via pytest probe at F0.5.
- [ ] (E) Re-Review-Trigger documented in ADR: "when an auth layer is added to pty-manager", per source plan.
- [ ] (E) PR description includes the bloat-check workflow's PR-comment showing the allowlist-diff (`pty-manager: grandfathered → exception`).
- [ ] (E) `npm.cmd --prefix server run typecheck` passes (no code change but we re-verify nothing rotted).

## Spec Impact

- **Classification:** none
- **NONE justification:** Documentation-only iterate. No FR change, no API change. ADR + baseline-state flip.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| (none — Doku + JSON entry-state flip) | (none) | n/a |

`touches_io_boundary` = no.

## Verification (F0.5)

- **Surface:** `cli`
- **Runner command (probe 1 — pytest baseline assertion):**
  ```bash
  uv run --with openai pytest .shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c8_verify.py -v
  ```
  Where `_c8_verify.py` (~50 LOC) asserts:
  - The ADR file exists at `.shipwright/planning/adr/<NNN>-bloat-exception-pty-manager.md`
  - The ADR contains all mandatory sections (Status, Date, Re-Review-Date, Incident Reference, Context, Ousterhout Argument, YAGNI Check, Chesterton-Fence Check, Decision, Consequences, Rejected alternatives)
  - The baseline entry for `server/src/terminal/pty-manager.ts` has `state == "exception"` AND `adr` is non-null AND `adr` matches the ADR filename's NNN prefix.
- **Runner command (probe 2 — server typecheck):**
  ```bash
  cmd /c npm.cmd --prefix server run typecheck
  ```
- **Evidence path:** `.shipwright/runs/<run_id>/surface_verification.json` + pytest log + tsc output.
- **`tests_run` MUST be ≥ 2.**

## Confidence Calibration

- **Boundaries touched:** none.
- **Empirical probes run:** (1) ADR file existence + section-completeness; (2) baseline JSON entry-state transition; (3) server typecheck.
- **Edge cases NOT probed + why acceptable:** N/A — no boundaries touched.

## External Review + Code Review (ADR-029)

- Step 3.5 External LLM Plan Review: **SKIP justified** — Doku-only iterate, ~150 LOC ADR + 1 JSON edit. Record `reviews.plan.status = "skipped_doc_only"`.
- Step 3.7 Code-Review-Cascade: **SKIP justified** — same reasoning.

## Hard constraints

- DO NOT touch `server/src/terminal/pty-manager.ts` itself (the whole point of C8 is to formally accept it as-is).
- DO NOT touch `scripts/hooks/anti_ratchet_check.py` (canonical-source-hash pin).
- This is the **ONLY** Campaign-C iterate that may ADD an entry to the baseline (changes existing entry from grandfathered to exception; logically a flip, not an add). NO other C-iterate may add a fresh entry — they all REMOVE.

## How to source the ADR template

Copy `.shipwright/planning/adr/_template-bloat-exception.md` from the sibling shipwright clone at `C:/01_Development/shipwright/.shipwright/planning/adr/_template-bloat-exception.md` (post-A.defense merge — the template lives there). Fill every section honestly; pure pro-forma alternatives are a red flag per template's own guidance.

---

(Cleanup-Invariant block applies. C8 is the literal exception per the invariant block: ONE state=exception entry is added.)

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the full invariant block.
