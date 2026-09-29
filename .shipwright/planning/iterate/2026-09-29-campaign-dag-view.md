# Iterate: campaign-dag-view

- **Run ID:** iterate-2026-09-29-campaign-dag-view
- **Card:** trg-e542ce03 (second half of monorepo trg-c196ba32)
- **Type / Complexity:** feature / medium
- **Spec Impact:** MODIFY FR-01.33 (new bullet "(F)")

## Goal

Show the campaign `depends_on` graph on the campaign card and let the operator
launch a ready step by hand. The WebUI renders the monorepo scheduler's verdict
(`loop_claim.py readiness`, contract `loop-readiness-1.0`) and never re-derives
readiness.

## Decisions (from the operator)

1. Readiness = the monorepo's read-only `readiness` command (monorepo PR #822).
2. Per-unit launch is guided only (`/shipwright-iterate "<specPath>"`); autonomous stays per campaign — no per-unit autonomous switch.
3. Launch guard is server-side, bounded: cache < ~15 s, else await ≤ ~10 s; fail open on timeout/unavailable and say so (`readinessChecked:false` + UI notice).
4. A campaign's state lives in `<root>/.worktrees/campaign-<slug>` — used as BOTH `--campaign-worktree` and the base of `--state`. Legacy fallback to the project root only if it holds that campaign's units. Missing state = "no loop running". The main root's state is never read for a worktree campaign.
5. Attached-run check covers claimed/running/built/reviewed/merging (+ legacy `in_progress`).

## Acceptance criteria

- AC-1 Each step row shows its dependency edges and, from the verdict, ready / waiting-on / in-flight / failed.
- AC-2 A Launch button appears only on ready steps and launches exactly that step (guided).
- AC-3 Scheduler unavailable/unsupported/unreachable → honest banner + old "Launch next" fallback.
- AC-4 `POST /launch` for a pending, not-ready step → `409 campaign_step_not_ready` with `blocked_by`.
- AC-5 Timeout / unavailable / unit missing from report → launch proceeds with `readinessChecked:false`; UI notice in the confirm dialog. No loop → not flagged.
- AC-6 Readiness runs in the campaign's own worktree; never reads the root state for a worktree campaign.
- AC-7 Results cached (15 s, errors 5 s) and coalesced; never on the 3 s campaigns poll.
- AC-8 "Run attached" recognises wave-run states in the campaign's worktree.
- AC-9 A different contract major → `unsupported-version`; additive minor tolerated; vendored contract has a drift guard.

## Accepted risks

- The readiness command may `git fetch origin` in the campaign's worktree (the monorepo command's own behaviour). It only ever runs against projects the operator registered in this local-only app, throttled by the 15 s cache and in-flight coalescing; the WebUI adds no remote of its own.
- A stale cached verdict can be up to 15 s old; the launch guard re-checks uncached before ever refusing.

## Out of scope

Per-unit autonomous toggle; writing any scheduler state; re-implementing ancestry/strategy checks; `index.ts` changes.

## Affected boundaries

Producer: monorepo `loop_claim.py readiness` (JSON, `loop-readiness-1.0`). Consumer: `core/campaign-readiness*.ts` → `GET /api/campaigns/:p/:slug/readiness` and the launch guard → client `useCampaignReadiness` / `CampaignDagSteps`. Verbatim mirror: `server/src/types/loop-readiness-1.0.contract.json` (DO-NOT #7).

## Mini-plan

1. Server: worktree-root resolver; readiness runner + schema guard + cache; route; `dependsOn` through parse/status.json/store; launch guard in `campaign-step-branch`.
2. Client: readiness api/hook/copy; `CampaignDagSteps`; card + launch button + dialog notice; failure copy.
3. Tests at each layer + real-pipeline E2E.

## Confidence calibration / Test Completeness Ledger

| Behaviour | Layer | Evidence |
|---|---|---|
| Worktree-vs-legacy state resolution | unit | `campaign-readiness.test.ts`, `campaign-loop-state.worktree.test.ts` |
| Outcome mapping, versions, cache, timeout | unit | `campaign-readiness.test.ts`, `campaign-readiness-schema.test.ts` |
| Readiness route (404/400/403/200) | route | `routes/campaigns-readiness.test.ts` |
| Launch guard 409 / fail-open / no-loop | unit + router | `campaign-step-branch.readiness.test.ts`, `campaign-step-branch.failopen.test.ts` |
| `dependsOn` parsing | unit | `campaign-store.depends-on.test.ts`, `campaign-parse.test.ts` |
| DAG rendering, stale/unreachable | component | `CampaignDagSteps.test.tsx`, `useLaunchCampaignStep.test.ts` |
| Real scheduler end to end | E2E | `client/e2e/flows/campaign-dag-view.spec.ts` (needs `SHIPWRIGHT_LOOP_CLAIM_SCRIPT`) |

Results: server 4618 passed/13 skipped (+fail-open test), client 4420 passed, E2E 8 passed. Residual risk: the real-pipeline E2E skips without the scheduler script (not a CI gate).
