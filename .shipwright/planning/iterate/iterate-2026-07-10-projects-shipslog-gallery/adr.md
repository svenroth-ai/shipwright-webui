# Iterate ADR — A15: Projects → Ship's-Log gallery (FR-01.59)

Run ID: `iterate-2026-07-10-projects-shipslog-gallery`
Campaign: `webui-wow-usability-2026-07-10` · sub-iterate `A15`
Complexity: classifier returned **large** (keyword-driven; `prior_source: keyword`).
Treated as **medium** — see Complexity note. All medium+ review gates run.

## Complexity note

`classify_complexity.py` returned `large` with risk flags
`touches_auth / touches_shared_infra / touches_public_api / touches_io_boundary`.
Those flags are keyword false-positives: this iterate is a read-only frontend
gallery that consumes existing hooks (A02 `useProjectRuns`, FR-01.43
`useProjectCompliance`) — it touches no auth, no shared infra, no public API, and
writes nothing. The real footprint is bounded (rebuild one page smaller + 4 small
files + tests). A15 is itself the orchestrator's deliberate split of the campaign,
so escalating "requires split" would loop. Proceeded, treating true complexity as
medium and running the full medium+ gates. Matches the A01–A14 pattern.

## External-Plan-Review-Findings

Plan review folded into the code review (single OpenRouter pass over the diff +
spec). No separate plan-review findings beyond the code-review table below.

## External-Code-Review-Findings (OpenRouter, openai + gemini)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | high | A still-loading / errored A02 read was treated identically to a confirmed empty logbook → card falsely claimed "No runs yet" (permanently, after an error). | **accepted-and-fixed.** Threaded `runsResolved`/`runsError` from `useQueries`; body now renders a neutral loading placeholder while in flight and "Run history unavailable." on error — the "No runs yet" sentence appears ONLY on a confirmed successful empty read. New tests cover both states. |
| 2 | high | "Grade it" navigates to `/wizard/grade` — a third option outside AC5's two (manifest CTA / hint popover); renders for any project lacking compliance. | **rejected-with-reason.** The default actions manifest exposes NO grade action, so AC5 preference-1 is N/A and preference-2's "name the command" would require hardcoding a slash string (forbidden by DO-NOT #11) since there is no manifest command to source. Navigating to the existing read-only in-app Grade door (`/wizard/grade`, FR-01.51) is a real, working CTA that never dead-ends, spawns nothing (rule 1), and hardcodes nothing — the honest interpretation the campaign brief explicitly blesses ("real CTA … OR a hint"). Gated on compliance being settled (no flash) and on the no-dashboard state (correct: `hasGrade === false`). |
| 3 | med | `runCount > 0` marked graded even with an empty `runs` array → graded card with no sparkline/proof. | **accepted-and-fixed.** `buildProjectLogModel` now gates on `runs.runs.length > 0`, not just the count (server keeps them equal — verified `run-data-join.ts:247` `runCount: runs.length` — but never trusted). Defensive unit test added; ordering fixture made realistic. |
| 4 | med | Stats renders "M FRs" not the spec's "X/Y FRs". | **rejected-with-reason.** No honest source for the denominator Y exists — compliance exposes no FR totals; a fabricated Y violates AC3. "M FRs" (distinct FRs touched, from A02 `affectedFrs ∪ newFrs`) is the honest derivation. Documented in the spec.md FR-01.59 row. |
| 5 | med | Grade-it test codifies the `/wizard/grade` navigation. | **accepted (as-is).** Correct for the chosen AC5 form (see #2); test asserts the real navigation, not a dead button. |
| 6 | med | No regenerated `/projects` visual baseline in the diff. | **accepted — handled via CI.** Baselines are regenerated ONLY in the pinned container (campaign rule; never locally on Windows). Done in the visual-baseline step after push. |

## Self-Review (7-item)

1. **Spec Compliance** — pass. AC1–AC5 + AC7 met; AC6 via CI baseline. ProjectsPage 452→218 (shrunk); all new files ≤ caps; bloat baseline un-ratcheted (ProjectsPage entry removed — now < 300).
2. **Error Handling** — pass. A02 read failure → honest "unavailable"; loading → neutral placeholder; compliance missing → graceful (no pill / Grade-it). `retry:false` respected.
3. **Security Basics** — pass. No new inputs/auth. Read-only observer; no run_config/JSONL/state writes. Name/path rendered as React-escaped text.
4. **Test Quality** — pass. Unit (empty/graded/edge/demo-literal-absence), component (4 body states, pill-vs-grade-it, click seam, gear/trash stopProp, synthesized), page (gallery-replaces-table, graded-first ordering, delete cascade), E2E (real-API seed, three states, open-board nav).
5. **Performance Basics** — pass (noted). `useQueries` fans out one run-data GET per project; each cached 30 s, cheap local read — acceptable, not a hot-loop N+1.
6. **Naming & Structure** — pass. Single `openProjectLog` seam; clear names; body extracted to `ProjectLogCardBody` to hold the ≤200 cap; no dead code, no chart lib.
7. **Affected Boundaries (ADR-024)** — pass. Producer = server `projectRunData` (event-log JSONL → RunsResponse); consumer = client `buildProjectLogModel`. Both identified; real round-trip probe run.

## Confidence Calibration (empirical probes)

- **Probe 1 — producer→file→consumer round trip.** Fed the E2E's seeded
  `shipwright_events.jsonl` fixture through the real server `projectRunData`:
  `runCount 2`, summaries present, distinct FRs = 2, test ratios `[80,100]`,
  last-proof = "The most recent proof quote" (newest by ts). Matches exactly what
  the card renders. No finding.
- **Probe 2 — honest degradation.** Fed a corrupt line + a keyless
  `work_completed` + a phase event: `runCount 0`, `skippedLines 1`; consumer
  returns `{graded:false}` (unit-tested). No finding.
- **Asymptote:** two consecutive probes, no findings → boundary calibrated.
- **Not probed:** the browser-level Playwright flow was authored and validated at
  the data layer via probe 1; it executes in the CI E2E smoke gate + the pinned
  visual container (baselines are CI-only on Windows).
