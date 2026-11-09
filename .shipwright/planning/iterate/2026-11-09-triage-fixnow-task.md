# Iterate Spec: triage-fixnow-task

- **Run ID:** iterate-2026-11-09-triage-fixnow-task
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal
A triage card remembers the task that Fix now created and shows it (In progress box, tile, Resolve); the card Dismiss asks for an optional reason; the campaign source variant gets the Campaign help; all help texts are exported for review.

## Acceptance Criteria
- [ ] Creating a task through Fix now links it to the triage item; the card shows an In progress box (task title, task state, Open task link) and replaces Fix now / Promote / Snooze by Resolve.
- [ ] An In progress tile counts open items whose linked task is not done; selecting it narrows the list and shows a removable chip.
- [ ] The card Dismiss cross opens a popup with an optional reason and Dismiss / Cancel; nothing happens until Dismiss.
- [ ] The campaign source variant shows the Campaign help; a reviewable help-text list sits in the spec folder.

## Spec Impact
- **Classification:** modify
- **MODIFY** (existing FR changed): FR-01.30 — four acceptance-criteria lines appended (FOLD: completes the redesigned Triage page).

## Out of Scope
- Un-snooze ("Return now") of parked cards (no server endpoint).
- Writing the link into triage.jsonl (shared plugin schema) — the link lives on the task.
- Changing the task creation wizard itself.

## Design Notes
Mockup `.shipwright/designs/triage-redesign-proposal.html` (taskbox, "In progress" tile, Resolve). Link is stored on the webui-owned task (`fixNowForTriageId`), keyed per project because triage ids collide across projects.

## Affected Boundaries
| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `POST /api/external/tasks` create handler → `sdk-sessions.json` | loader `sdk-sessions-validate.ts`, client `useExternalTasks` | JSON field `fixNowForTriageId` (`trg-` + 8 hex) |

## Confidence Calibration
- **Boundaries touched:** task create body → store → loader → client list.
- **Empirical probes run:** round-trip create→persist→reload→list test (server); bad id shapes dropped.
- **Test Completeness Ledger:** see F5.
- **Confidence-pattern check:** pending.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `npx playwright test client/e2e/flows/triage-fixnow-task.spec.ts` (via isolated stack)
- **Evidence path:** scratchpad JSON staged at F5

## Internal Architecture Review

architecture-internal-reviewer: PROCEED. Link-on-task is the smallest sound shape (no plugin-schema write, additive field). Accepted caveats: scope bundles four items (kept — folded into FR-01.30); join key is always `projectId:triageId`; newest task wins when several link to one item; release is derived from task state, so a reopened task re-attaches automatically.

## Internal Plan Review

opus-plan-reviewer: medium findings dispositioned. (1) `launch_failed` also releases the link and "latest" = newest `createdAt` — now documented in `triageTaskLinks.ts` and covered by a test. (2) Resolve = the same dismiss mutation as the card cross, reason prefilled "Resolved via task: <title>"; the linked task is left untouched by design (no cross-write). (3) Orphan/Unassigned tasks can never match — accepted, cosmetic link. (4) Per-card `select` cost: accepted (cheap map build; `refetchOnMount` off). (5) PATCH never reads the field (create-only) — verified by grep. Help-text generator is in the boundaries via the sync test.
