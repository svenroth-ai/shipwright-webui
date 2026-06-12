# Iterate: Manual dismiss/restore for Campaigns board cards

- **Run ID:** iterate-2026-06-12-campaign-dismiss
- **Intent:** FEATURE (new board affordance)
- **Complexity:** medium
- **Spec impact:** MODIFY (Campaigns lane FR-01.33 — board visibility) + ADD (webui-owned dismiss state)
- **Risk flags:** `touches_public_api` (additive `dismissed` on `GET /api/campaigns/:projectId` + two new POST endpoints) → mandatory full review + auto external review

## Problem

A campaign whose planning dir is gitignored/cleaned up surfaces on the board
purely from the tracked `shipwright_events.jsonl` (the `derivedFromEvents`
SYNTHESIZE path, PR #122). Such a card carries ONLY completed sub-iterates, so
`selectActiveCampaigns` deliberately **always** shows it (events can't reveal
pending steps → "all known steps done" ≠ "campaign finished"). Consequence: a
genuinely-finished campaign (e.g. `2026-06-07-tracked-campaign-status`, S1–S4 all
`work_completed`, dir gone) lingers on the board forever — it can't auto-hide and
there's no `status.json` left to flip. The tracked event log has **no terminal
campaign-level signal** (only per-sub-iterate `work_completed`), so the consumer
genuinely cannot prove completion from events alone.

## Decision (manual dismiss now; producer terminal-event later)

A campaign is hidden from the active lane when there's a **terminal
acknowledgment**. Today that acknowledgment is a user dismissal (this iterate);
the AUTOMATIC counterpart — a producer-emitted terminal `campaign_completed`
event into the tracked log — is filed as monorepo triage **trg-7580f4fe** and
will feed the same gate. Manual handles this legacy card + every future ghost
immediately; the producer event eliminates the operator step later.

Dismissal is a **WebUI-owned board quittance, NOT a producer status write**
(CLAUDE.md DO-NOT #12: webui is read-only on campaign/run-config producer state).
It does NOT write `status: complete` into any campaign dir.

### Scope (user-decided 2026-06-12)

- **Reach:** the dismiss button appears on **every visible campaign card**, not
  only `derivedFromEvents` ones. Dismissal is a general per-campaign hide; the
  ghost-card case is just the motivating instance.
- **Reversible:** a "show dismissed" toggle reveals dismissed cards with a
  "Wiederherstellen" (restore) action. No confirm dialog — reversible ⇒ low
  stakes.

### Behavior

1. **Persist:** dismissals live in the webui registry dir at
   `${registryDir}/dismissed-campaigns.json` (beside `sdk-sessions.json`),
   shape `{ schemaVersion: 1, dismissed: { [projectId]: string[] } }`. Keyed by
   `projectId` + campaign `slug`. NOT in any target project repo, NOT in the
   worktree.
2. **Annotate (not filter) server-side:** `GET /api/campaigns/:projectId` sets
   `dismissed: boolean` on each campaign (mirrors the existing `attachedRun` /
   `derivedFromEvents` runtime annotations). The full set is returned so the
   reversible "show dismissed/restore" UX works with one GET.
3. **Endpoints:** `POST /api/campaigns/:projectId/:slug/dismiss` and
   `POST /api/campaigns/:projectId/:slug/restore` — idempotent, lock-protected
   read-modify-write; unknown/synth project → 404; lock busy (ELOCKED) → 503.
4. **Client gate:** `selectActiveCampaigns` is unchanged (the "would-be-visible"
   set). New pure selectors layer dismiss on top:
   `selectVisibleCampaigns` = visible minus dismissed (default lane);
   `selectDismissedCampaigns` = the dismissed subset of would-be-visible
   (the restore list, shown only when the toggle is on).

### Architecture-constraint notes

- **`server/src/index.ts` (888 LOC, grandfathered) is untouched.** The route
  lazily resolves a memoized `getDefaultDismissedStore()` singleton from
  `getConfig().registryDir`; tests inject a store via an optional dep. Adding a
  second route mount or a store instantiation in index.ts would ratchet the
  frozen baseline (pre-commit hook blocks it).
- **`TaskBoardPage.tsx` (681 LOC, grandfathered) net-shrinks.** The campaigns
  lane (query + selector + JSX) is extracted **verbatim** into a new
  `CampaignsLane.tsx`, which also houses the toggle. TaskBoardPage drops to a
  one-line `<CampaignsLane …/>` (≈ −20 LOC; the baseline ratchets DOWN).
- **`campaigns.ts` stays ≤300 LOC** by extracting the shared lock-failure helpers
  (`isElockedError` / `lockUnavailable` / `releaseQuietly`, reused by `start`)
  into `campaign-route-helpers.ts` before adding the two endpoints.

## Affected Boundaries

- **Consume/Produce (NEW write surface):** `${registryDir}/dismissed-campaigns.json`
  — webui-owned, `proper-lockfile`-guarded read-modify-write (DO-NOT #6).
  Lock-free tolerant reads for annotation.
- **Produce:** `GET /api/campaigns/:projectId` response gains optional
  `dismissed` (additive, deploy-skew safe). Two additive POST endpoints.
- **No producer writes.** No write into any `.shipwright/.../campaigns/<slug>/`,
  no run-config write, no target-repo write.

## Confidence Calibration

- **Boundaries touched:** `${registryDir}/dismissed-campaigns.json` (JSON
  read/write under lock); `/api/campaigns` JSON response (additive `dismissed`
  field + 2 POST routes).
- **Empirical probes run** (all green):
  - Dismiss a `derivedFromEvents` ghost (events.jsonl, NO campaign dir) via the
    route → store gains `{projectId:[slug]}`, GET annotates `dismissed:true`
    (`campaigns.dismiss.test.ts` "headline case" + store "dismiss persists…").
  - Restore → store entry removed, GET annotates `dismissed:false`
    (`campaigns.dismiss.test.ts` restore + store restore/idempotent).
  - Lane partition + toggle: visible hides dismissed, "N erledigt" toggle reveals
    the dimmed list, restore returns the card (`CampaignsLane.test.tsx`,
    `campaignsApi.selectors.test.ts`).
  - Lock wraps the write (acquire→write→release, released even on write failure);
    idempotent repeat = no-op; missing/corrupt state file → tolerant empty read
    (`dismissed-campaigns-store.test.ts`, 9 cases).
  - 404 unknown/synthesized project, 400 control-char slug, 503 ELOCKED
    (`campaigns.dismiss.test.ts`, 8 cases).
  - Mutation invalidates `campaignsKey` only on success, not on throw
    (`useDismissCampaign.test.tsx`).
- **Test Completeness Ledger:** machine-readable block written at F5 into
  `shipwright_test_results.json iterate_latest.test_completeness`; every behavior
  `tested` (store/route/selector/API/hook/button/lane), 0 untested-testable.
- **Confidence-pattern check:** depth = store lock/idempotency/tolerant-read +
  route 404/400/503/annotation + selector partition + mutation-invalidation
  tests; breadth = server unit (9) + route integration (8) + client selector (5)
  + API wrapper (4) + hook (3) + button render (4) + lane (4) + F0.5 browser E2E
  (`campaign-dismiss.spec.ts`: dismiss ghost → leaves lane → show-dismissed →
  restore). Full server (1632) + client (1613) suites green; `tsc`/oxlint clean.
