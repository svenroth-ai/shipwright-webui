# Iterate: Project campaign status from tracked events.jsonl

- **Run ID:** iterate-2026-06-11-campaign-events-projection
- **Intent:** CHANGE (consumer migration)
- **Complexity:** medium
- **Spec impact:** MODIFY (Campaigns lane FR-01.33 — status source) + ADD (events projection)
- **Risk flags:** `touches_io_boundary` (parses `shipwright_events.jsonl`, JSON.parse), `touches_public_api` (additive `derivedFromEvents` on `GET /api/campaigns/:projectId`)

## Problem

The WebUI Campaigns board derives each sub-iterate's status from a campaign's
`.shipwright/planning/iterate/campaigns/<slug>/status.json` (+ skeleton from
`campaign.md`). Both the monorepo (`.gitignore:184`) and webui (`.gitignore:80`,
PR #121) now gitignore the **entire** campaigns dir — "local-only operational
planning, not durable product artifacts." So a fresh clone / redeploy has **no
campaign dirs** → `readCampaigns` returns `[]` → the board shows nothing, even
though the campaign actually ran. A local working-tree instance still works
(dirs present on disk, gitignored ≠ absent locally).

The monorepo's prescribed fix (its own gitignore comment): *"progress is
projectable from the tracked events.jsonl (campaign + sub_iterate_id event
extras)."* The producer side already shipped: S1 made `work_completed` events
self-identifying (top-level `campaign` / `sub_iterate_id`), and
`shared/scripts/lib/campaign_status.py::project_campaign_status` (ADR-121 family,
campaign `2026-06-07-tracked-campaign-status`) defines the projection semantics.
This iterate is the **webui-consumer counterpart**: port those semantics to TS.

## Decision (Option 1 — events-only, honor the gitignore)

Picked over re-tracking `campaign.md` because: (a) honors the deliberate 2-day-old
local-only decision; (b) matches the monorepo's stated intent verbatim; (c)
self-contained consumer change, no producer/gitignore churn; (d) only S1-stamped
campaigns project, so the deployed board surfaces recent/relevant progress, not
unbounded history.

### Behavior

1. **Overlay (campaign dir present):** for each local campaign, never-downgrade a
   step to `complete` when a matching `work_completed` event exists; prefer a
   non-empty event `commit` over an empty local value. This is
   `merge_status` parity and actively corrects a stale `status.json` (the exact
   `done==total` bug class reported 2026-06-05).
2. **Synthesize (campaign dir absent):** build a `Campaign` per event-only slug
   from its completed sub-iterates (each `complete`, with commit). No
   skeleton ⇒ no titles/order/total/pending; `total == done == #completed`,
   `specPath == null` (launch buttons correctly disable), `derivedFromEvents:
   true`.
3. **Surface:** `selectActiveCampaigns` keeps `derivedFromEvents` campaigns
   visible (a done==total events-only campaign would otherwise be hidden). Lane
   card shows a subtle "events" provenance badge.

### Projection semantics (parity with `_project_events` + `merge_status`)

- Match `type == "work_completed"` AND top-level `campaign == slug` AND truthy
  `sub_iterate_id` (NOT `extras`).
- Latest event wins per `sub_iterate_id` — `ts` epoch, file-index tiebreak;
  unparseable `ts` sorts oldest.
- Carry `commit` only. Tests are deliberately NOT projected (divergence from the
  Python reference, which carries them because its `status.json` schema has
  `tests_*` fields): the webui `CampaignStep` shape has no tests field and the
  board renders no test column — `readCampaigns` never surfaced tests either, so
  projecting them would mean a dead field + client mirror + lane-card churn for
  zero UI value (anti-bloat ratchet). [external-review-2026-06-11 #1/#4 resolved
  this way — align spec to YAGNI, not add the field.]
- Whitespace in `campaign`/`sub_iterate_id` is NOT trimmed (parity with the
  reference's truthy check; producer ids are machine-generated). [review #3]
- `nextPending` recompute uses `status !== "complete"` — identical to the
  existing `campaign-store.ts readCampaigns` (failed/escalated CAN be the
  next-pending step that needs a re-run, per the `Campaign.nextPending` doc).
  [review #2 — parity, not a regression]
- Never-downgrade ladder `pending < in_progress < complete`; `failed`/`escalated`
  terminal, superseded only by a projected `complete`.
- Corrupt/non-object lines skipped (tolerant), torn read → empty projection.

## Affected Boundaries

- **Consume:** `<projectRoot>/shipwright_events.jsonl` (tracked, per
  `events_log.resolve_events_path`) — NEW read surface for campaigns.
- **Produce:** `GET /api/campaigns/:projectId` response gains optional
  `derivedFromEvents`. Additive, deploy-skew safe (older client ignores it).
- No writes. WebUI stays a read-only observer of events.jsonl.

## Confidence Calibration

- **Boundaries touched:** `shipwright_events.jsonl` (JSONL parse / per-line
  `JSON.parse`); `/api/campaigns` JSON response shape (additive field).
- **Empirical probes run:** (filled at F0.5)
  - Real events.jsonl with a synthetic S1-stamped campaign → overlay bumps a
    stale `pending` step to `complete`; commit/tests carried.
  - Same stamp with NO campaign dir → synthesized campaign appears with N
    complete steps + `derivedFromEvents:true`, launch disabled.
  - Torn / corrupt event line mid-file → projection tolerant, route still 200.
- **Test Completeness Ledger:** (table at F5 — every projection + merge + route +
  selector behavior → `tested`; `requires-manual-visual-judgment` only for the
  badge pixel placement, covered by a render-presence assertion otherwise.)
- **Confidence-pattern check:** depth = projection parity unit tests vs the
  Python reference's documented edge cases (latest-wins, never-downgrade,
  terminal-supersede, corrupt-skip); breadth = server unit + route integration +
  client selector + lane-card render + E2E against a live stack.
