# Iterate — Mission: an honest record for a finished run

- **Run-ID:** iterate-2026-07-23-mission-finished-run-artifacts
- **Date:** 2026-07-23
- **Intent:** bug (4 facets of one theme) · **Complexity:** medium
- **affected_frs:** `FR-01.66`
- **Reporter:** Sven — sessions `3cfa001d` (First Contact Hero, webui) + `2ed3c046` (grill module, monorepo)

## Context — reproduced against current source (NOT a stale build)

All four were confirmed against HEAD source + live on-disk data. Local `main`
(#319) lagged `origin/main` (#321); the reported run `first-contact-hero` **is**
#321.

## The four root causes

1. **"Merge status never green" (systemic).** The left stepper's green `Merge`
   dot lights only via `stageComplete`, which needs a pipeline run-join
   (`useRunDetail(task.runId)`) a standalone iterate never has → never green for
   ANY iterate. The genuine squash-merge check (`merge-check.ts`) works but only
   feeds the Commit detail panel's "Delivery" text.

2. **"Only Decisions on the left."** 5 of 6 artifacts gate on the
   `work_completed` row in the **working-tree** `shipwright_events.jsonl`. After
   a PR merges, that row is on `origin/main` but the working tree is not pulled,
   so the row is absent → Spec/Requirement/Tests/Review/Commit vanish. Decisions
   survives ALONE because decision-drops are written to the main tree directly
   at F3. VERIFIED: `origin/main:shipwright_events.jsonl` DOES contain the row
   locally (origin is fetched at finalization), so a git-blob fallback is viable.

3. **"Tests always empty."** `buildTestsArtifact` is diff-only — it reconstructs
   changed test files from `git show <commit>`. The worktree flow ships
   `commit == ""`, and `changed_files` (in the event) is ignored → the card is
   blank for most runs. The pass/total counts (`tests` field, present in 182/374
   rows, e.g. `{passed:3037,total:3037,e2e_run:true}`) are available and unused.

4. **Plugin pill white-on-white.** `.mc-top` flips `--color-text:#fff`;
   `iterate`/`project`/`adopt` pills use `text-[var(--color-text)]` on near-white
   `bg-inset` → invisible.

## Acceptance criteria

- **AC1 (B):** For a finished iterate whose `work_completed` is on the default
  remote ref but not in the working tree, `findWorkCompleted` resolves it via a
  bounded, TTL-cached `git show <ref>:shipwright_events.jsonl` fallback; an
  in-flight run (not on the ref yet) still resolves `absent`, never masked.
- **AC2 (C):** The Tests artifact renders as `available` whenever the run
  recorded meaningful test COUNTS, leading with `passed/total`; the per-file
  changed-test list (from the commit diff, when a real commit resolved) is
  enrichment, not a gate. A genuine zero-of-zero result is not shown.
- **AC3 (A):** The stepper's `Merge` step reaches the green `done` state when the
  run's real merge state is `merged` (commit artifact), independent of any
  pipeline run-join.
- **AC4 (D):** The `iterate`/`project`/`adopt` pills are legible in the `.mc-top`
  header (explicit readable fg, immune to the white flip).

## Affected boundaries (producers ↔ consumers)

- `shipwright_events.jsonl` (iterate pipeline F5b/F6 → webui reader). Adds a
  merged-ref read path; the tracked file's schema is unchanged.
- `git` ref read (`origin/main`) — arg-array, `shell:false`, constant path.
- No new write surface; DO-NOT #1 (read-only observer) preserved.

## Review dispositions

**Internal adversarial code review** (fresh-context, biased to disprove) — 1 HIGH,
1 MEDIUM, 2 LOW; all addressed:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | HIGH | The RC-D pill fix used `--ink`, which `on-photo.css` flips to `#fff` on every `.on-photo` route — so it stayed white in `.mc-top` AND regressed the board. | **accepted-and-fixed.** The first probe's CSS read was incomplete. Verified against the real cascade (`on-photo.css:59/80`, `--color-text` resolves `var(--ink)` at :root, `--inset` never themed dark) and switched the three neutral pills to a fixed dark literal `#1C1917` on `bg-inset` — immune to both the `--color-text` (`.mc-top`) and `--ink` (`.on-photo`) flips. Guard now forbids BOTH tokens. |
| 2 | MEDIUM | `merged-events` read the event blob through worktree-roots' 4 MB `defaultGit`, while the working-tree reader it substitutes for budgets 64 MB — so a >4 MB (append-only, never-evicted) `events.jsonl` overflows, degrades to `unavailable`, and silently re-collapses the rail, never recovering. | **accepted-and-fixed.** `merged-events` now uses its own arg-array git with a 64 MB `maxBuffer` matching `MAX_EVENT_LOG_BYTES`. |
| 3 | LOW | `{passed:0,total:0}` rendered the success-sounding "All 0 tests passing". | **accepted-and-fixed.** `normalizeResults` + `testsResultText` treat all-zero as no result; tests added both sides. |
| 4 | LOW | Theoretical run_id-reuse + `git worktree list` failure could bleed a ref row into a live run. | **noted, no action** — date-stamped run_ids make it effectively unreachable; the reviewer could not construct a realistic trigger. |

The reviewer separately VERIFIED as sound: the `mergedRefMiss` cache exclusion, the
`absent`/`unavailable` distinction end-to-end, `buildTestsArtifact` honesty (nothing
previously shown is now hidden), `isMergeConfirmed` (greens only on a real merge,
middle-card selection unchanged), and the wire mirror.

**External LLM code review** (openrouter: gemini + openai) — verdict ship-with-fixes,
4 medium; the two substantive ones overlap the internal HIGH/MEDIUM (fixed above).
The remaining two are AC-wording, dispositioned:

| # | Finding | Disposition |
|---|---|---|
| E1 | AC2 said "(+e2e)" but `e2e_run` is not surfaced. | **AC tightened.** e2e is a minor enrichment on a shared wire type (`MissionTests`, also the chip's); surfacing it is deferred rather than churning the mirror for it. AC2 no longer claims it. |
| E2 | AC2 said changed files come from `changed_files` (else the diff); the impl uses only the diff. | **rejected-with-reason + AC tightened.** `changed_files` carries no change-KIND (added/modified/removed); building rows from it would FABRICATE the kind the diff provides for free. The counts (which the event DOES carry) are the reliable lead; the per-file rows stay commit-diff-sourced. AC2 restated to match. |

## Confidence Calibration

Boundaries touched: `shipwright_events.jsonl` (working tree + the default remote
ref), a git-blob read, and the client theme tokens. Probes were empirical.

| Probe | Finding |
|---|---|
| `git show origin/main:shipwright_events.jsonl` on the main tree | **CONFIRMED** — carries the merged run's `work_completed` locally (origin is fetched at finalization); 389 KB, well under the 4 MB git buffer. |
| `tests` / `commit` / `changed_files` coverage across 374 real rows | **MEASURED** — 182 carry counts, 201 a real commit, 155 `changed_files`; first-contact-hero has counts `{3037,3037}`, `commit:""`, no `changed_files`. |
| END-TO-END on the real main tree for first-contact-hero | **CONFIRMED** — merged-ref lookup → found; PR #321 marker from transcript; `checkSquashMerged` → `merged`; Tests → available "All 3037 tests passing"; Commit → available, "Delivered — merged". |
| Pill cascade `.mc-top{--color-text:#fff}` over `bg-inset #F5F5F4` | **CONFIRMED** via source — three neutral pills used the surface text token; now `--ink`. |
| Live-run gate (`resolveWorkCompleted` with `isWorktree:true`) | **CONFIRMED** — ref never consulted for an in-flight run, so a stale ref cannot misread it. |

**Test Completeness Ledger** (each behavior → tested):

| Behavior (AC) | Status | Evidence |
|---|---|---|
| Merged-ref lookup found / absent / unavailable | `tested` | `merged-events.test.ts` (found, absent, unavailable) |
| Ref TTL-cached; live run never consulted | `tested` | `merged-events.test.ts` (TTL count; `isWorktree` gate; local-row short-circuit) |
| Merged-ref miss is uncacheable | `tested` | `merged-events.test.ts` "reports a miss (uncacheable)" |
| Tests leads with counts (commit:'' rows) | `tested` | `artifacts-tests.test.ts` counts-led block (6 cases) |
| Tests still hides/`unavailable` when truly nothing | `tested` | `artifacts-tests.test.ts` never-a-false-negative block |
| Tests wire mirror in sync | `tested` | `mission-context-types-sync.test.ts` (50) |
| Tests detail leads with result, no empty table | `tested` | `MissionSlice2Details.test.tsx` counts-led cases + `missionArtifacts.test.ts` `testsResultText` |
| Green Merge from real merge state (iterate) | `tested` | `MissionLeftPanel.test.tsx` merged→all-done, pending→current |
| Pill legibility (no `--color-text`; `--ink`) | `tested` | `phaseStyle.test.ts` legibility guard |
| Real-browser pixel of the pill / rail | `untestable` (`requires-manual-visual-judgment`) | covered by the visual-baseline regen (3 mission baselines) |

0 testable-but-untested. **Asymptote:** the merged-ref and Tests-counts suites
stopped surfacing new states after the found/absent/unavailable + counts/diff
matrices were covered; breadth spans absent / found / in-flight / miss.
