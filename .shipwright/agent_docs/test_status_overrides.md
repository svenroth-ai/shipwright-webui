# Test Status Overrides

Single source of truth for FAIL-row dismissals from `test-evidence.md` +
`traceability-matrix.md`. The current RTM/test-evidence generators do
not consume this file — they continue to render FAIL based on the
event-log snapshot at commit time. Plan-of-record: Iterate B.4 (RTM
generator refactor) wires this file as the dismiss-aware overlay so
historic-dismissed rows render as `FAIL [dismissed YYYY-MM-DD — historic]`.

Until B.4 lands, this file is the **audit trail** for "we looked at
these FAILs and they are NOT lived bugs". Reviewers (Senior, audit)
should treat any FAIL in RTM/test-evidence that is also listed here as
historic.

Created by Phase 0d of the artifact-polish plan
(`~/.claude/plans/ich-habe-ein-paar-imperative-emerson.md`).

---

## Iterate-row dismissals

| event_id | commit | description | tests at commit | dismissed_at | reason |
|---|---|---|---|---|---|
| evt-{resume-guard-browser-reload} | 23f4a38 | Resume guard survives a browser reload — ptyReused ready-envelope flag arms the one-shot inject guard on a reused pty | 1939/1940 (1 fail) | 2026-05-21 | snapshot-only with 1 single test fail at commit. Subsequent iterates touching the same surface (Remove orphaned Resume-CTA liveness-gate, Remove Resume-CTA activity gate, edit-task-dialog, move-to-backlog) all green: 1935/1935, 1948/1948, 2042/2042, 1994/1994. Single failing test was a flaky CI test — explicitly named in the orphan-removal commit "Remove orphaned Resume-CTA liveness-gate code — dead since PR #29; eliminates a flaky CI test". |

## FR-level dismissals (RTM "FAIL" status that is generator-stale)

Each entry below has FAIL status in `traceability-matrix.md` despite
current iterate test runs being green. Diagnosed root cause: the RTM
generator sets FAIL from an older `work_completed` event whose tests
< total, and does not consult later events whose tests are equal-and-
green. Iterate B.4 (RTM generator refactor + Action-Unit triage link)
addresses this structurally.

| fr_id | title | rtm-shown current tests | last-verified | dismissed_at | reason |
|---|---|---|---|---|---|
| FR-01.08 | GET returns every persisted task from `sdk-sessions.json` | 1780/1780 → 2042/2042 | 2026-05-18 (iter) | 2026-05-21 | STALE — current iterate (edit-task-dialog, evt-21e2941) shows 2042/2042 green. FR is exercised by the GET /api/external/tasks listing tests in the leadwright Phase 1 + edit-task-dialog iterates. |
| FR-01.11 | Same shape as launch but for `--resume` of an existing session | 1717/1717 → 1123/1123 | 2026-05-18 (iter) | 2026-05-21 | STALE — current iterate (fix launch dropping description on Resume, evt-d097820) shows 1123/1123 green. The Resume CTA + state-machine surface is covered by ADR-085/086/092/096/097/098 iterates, all green. |
| FR-01.28 | TaskDetail center pane renders Toggle-Tab `Transcript / Terminal` | 632/632 → 970/970 | 2026-05-18 (iter) | 2026-05-21 | STALE — current iterate (terminal keyboard copy/paste with multi-line paste fidelity, evt-086b72c) shows 970/970 green. The TaskDetail Toggle-Tab surface is the headless-terminal-refactor campaign target (ADR-087/088/089/097) — all green. |
| FR-01.30 | New top-level `/triage` route + sidebar entry | 0/0 → 2189/2189 | 2026-05-20 (iter) | 2026-05-21 | STALE — current iterate (triage-launch-surface-webui launchPayload + Fix-now, evt-2189-row-1) shows 2189/2189 green. Triage tab + Promote bridge (ADR-101) is covered by the launchPayload/PromoteModal/TriageBadge tests added in iterate-2026-05-20-triage-launch-surface-webui. |

## Coverage gaps (NOT dismissed — separate category)

The following FR has RTM status FAIL with current tests `0/0`. This is
NOT a stale FAIL — it is a **coverage gap**: the previously-anchoring
test surface (786 tests) was retired without a replacement. Decision
pending — either backfill tests (own iterate) or annotate the FR as
"no-automated-coverage" with a manual-verification process.

| fr_id | title | rtm-shown current tests | last-verified | classification |
|---|---|---|---|---|
| FR-01.03 | CRUD for the project registry persisted at `~/.shipwright-webui/projects.json` | 786/786 → 0/0 | 2026-05-14 (build) | **COVERAGE-GAP** — pending decision (not dismissed). |

## Pending re-verify (none)

All webui stale-FAIL rows have been classified above.

## Out of scope for Phase 0d

- **Other NOT VERIFIED Must FRs** (FR-01.05/06/07/12/14/17/18/19/20/21/22/23 — 12 items): not stale-FAILs; require new tests or explicit `no-automated-coverage` annotation. Track separately.
- **Generator refactor** (Iterate B.4): consumes this file as overlay.

---

_Last updated: 2026-05-21 by Phase 0d (artifact-polish plan)._
