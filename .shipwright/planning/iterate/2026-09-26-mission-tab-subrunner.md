# Iterate: Mission tab feed polish + subrunner visibility

- **run_id**: iterate-2026-09-26-mission-tab-subrunner
- **status**: implemented — all 6 acceptance criteria done, full review
  cascade (self/spec/code/doubt/external_code) completed, F0/F0.5/F1 green
- **type**: CHANGE (Path B), one item is net-new FEATURE scope
- **complexity**: medium (escalated from the auto-classifier's `small`; positive
  evidence from a Stage-2 Repo Scout across `client/src/components/external/mission/`,
  `client/src/lib/missionActivityFeed*.ts`, `mission-operation.css`, and confirmed
  empirically against real JSONL transcripts on this machine — see Confidence
  Calibration)

## Source

Sven's own description + 6 screenshots across two webui tasks/sessions
(`9d005c26.../9ba56d6e...` and `0a4d725c.../fd52a106...`), comparing the Mission
tab against the Claude Desktop App, refined through several rounds of feedback
on a visual mockup (Design artifact) before implementation began.

## Acceptance Criteria

All 6 items below are implemented, tested (unit + a real-browser Playwright
spec for item 3), and reviewed (self/spec/code/doubt/external_code, all
findings addressed — see the Mini-Plan's review-round subsections).

1. **[done] Delivered dedup + PR-card overflow.** The printed narrative text
   (`card.text`) is always real and must stay fully visible — it is never
   blanket-suppressed. It is what triggers the structured PR sub-card
   (`.mc-feed-pr`, sourced from `MissionContext`'s commit artifact) to render
   below it; the ONLY thing suppressed is a sentence that is an exact/near-
   exact auto-generated duplicate of the PR box's own title (e.g. `Merged as
   "X".` where X literally equals the box's title) — never any other real
   content. The PR box gets a green-checkmark icon (reusing `CheckIcon`, not
   the two-circle "delivery" glyph) and keeps its existing "Open commit" link
   (`card.artifact && onArtifactClick` button — already present, confirmed
   correct). Fix `.mc-feed-pr-meta` so a long merge-state label wraps instead
   of clipping on the right.
2. **[done] "You" cards need visual weight.** Give user-typed messages their own
   recognizable treatment: a greenish-tinted card background (final decision,
   after comparing a gray option) + a light-fill variant of the user icon —
   distinct from every other generic `.mc-feed-card`.
3. **[done] Subrunner visibility (new).** When work happens inside a delegated
   subagent (this harness's real dispatch tool is named `Agent`, not `Task` —
   confirmed by direct JSONL inspection; `Task` stays recognized too for the
   classic CLI convention other files here already assume), the Mission feed
   currently shows almost nothing useful: the dispatch gets no special card,
   and the subagent's completion — a `<task-notification>` envelope the
   parser already reclassifies to `kind: "task-notification"`, additionally
   carrying a `<result>` tag with the subagent's full final report — is today
   simply never consumed by the feed reducer at all. Add a dedicated
   `subrunner` card kind, with its own robot/bot icon (Sven's explicit
   request): shows the delegated task's description, a running/done/failed
   status, and (once resolved) opens a right-side detail panel with the
   subrunner's own report — reusing the existing click-a-node → right-panel
   mechanic (`MissionBody`'s `activeNode` + `ArtifactPanel`/
   `MissionArtifactPanel` slot). v1 shows dispatch description + final report
   only (no durable live step-by-step subagent activity exists to show).
   Multiple concurrent subrunners each get their own card; only one detail
   panel is open at a time (documented v1 scope — see Mini-Plan alternative).
4. **[done] Remove "Needs attention" pill, always.** Drop it unconditionally for
   every blocker card — the kind's red accent + detail already carry the
   signal.
5. **[done] Mute the "N command(s)" toggle color.** Switch from `--accent`
   (saturated teal) to a neutral/muted color — visible + clickable, not
   urgent-looking, matching the reference desktop app.
6. **[done] Remove kind-name labels + per-card timestamps, site-wide (new).** The
   uppercase kind label ("Implement", "Goal", "You", "Delivered",
   "Subrunner", "Blocker", …) is dropped everywhere — the timeline icon +
   its color already conveys kind. Per-card timestamps are dropped too (no
   reference desktop app timestamps every message); replaced with a single
   one-time "Session started · <date>, <time>" divider near the top of the
   feed, derived from the first card that carries a timestamp, never
   repeated per card.

## Affected Boundaries

- `client/src/lib/missionActivityFeedTypes.ts` (new `ActivityKind`, new
  `ActivityCard` fields)
- `client/src/lib/missionActivityFeed.ts` (dispatch/hand-back detection wiring)
- new `client/src/lib/missionActivityFeedSubrunner.ts` (dispatch + notification
  correlation — kept out of the two files already near the 300-line
  convention ceiling: `missionActivityFeedTurn.ts`, `missionActivityFeedClassify.ts`)
- `client/src/lib/missionActivityFeedResolve.ts` (ack tool_result → real
  `agentId` correlation) / `missionActivityFeed.ts` (`task-notification` event
  handling)
- `client/src/components/external/mission/{MissionActivityFeedCard.tsx,
  MissionActivityFeedCardParts.tsx, MissionFeedIcons.tsx, MissionActivityFeed.tsx,
  MissionBody.tsx}`
- new `client/src/components/external/mission/SubrunnerPanel.tsx`
- `client/src/styles/mission-operation.css`
- No server-side change, no schema change, no touched risk-flag path
  (`touches_auth`/`_rls`/`_middleware`/`_migrations`/`_billing`/`_public_api`/
  `_build`/`_io_boundary`/`_ci_supplychain` — none apply). `touches_shared_infra`
  applies (`mission-operation.css`, shared feed components) → full test suite.

## Mini-Plan

### Item 1 — Delivered dedup + overflow
- `MissionActivityFeedCard.tsx`: `card.text` renders exactly as it always has
  — it is real, transcript-sourced content and is never blanket-suppressed
  merely because `prDetail` is present. Only an exact/near-exact duplicate of
  the PR box's own title text (e.g. `Merged as "X".` matching `prDetail.message`
  verbatim) is stripped from the rendered text, since that specific sentence
  says nothing the PR box doesn't already say. Swap the PR sub-card's icon to
  `CheckIcon` (green checkmark) instead of `FeedIcon kind="delivery"`.
- `mission-operation.css`: give `.mc-feed-pr-meta` `min-width: 0` and let its
  merge-state span wrap (the PR-number span gets `flex-shrink: 0` so it never
  itself compresses) instead of being clipped by the row's `overflow` state.

### Item 2 — "You" card treatment
- `mission-operation.css`: a `data-kind="user"` rule giving `.mc-feed-card` a
  greenish tint background (final decision after comparing a gray option),
  plus a light-fill treatment on that card's timeline-node icon.

### Item 3 — Subrunner visibility (the new feature)
- **Detection.** New `missionActivityFeedSubrunner.ts` exports
  `isSubrunnerDispatch(name)` (`name === "Agent" || name === "Task"`). A
  dispatch is only classified `subrunner` when it is NOT already a
  review-flavored `Task` (`isReviewTask()` still owns that existing path
  untouched).
- **Card lifecycle — corrected mid-build against a real captured transcript**
  (a genuine `Agent` dispatch that hit its 200-turn limit, was resumed via
  `SendMessage`, and later finished; see Confidence Calibration). The
  original design assumed the hand-back arrives as a plain user-role message
  wrapped in harness scaffolding — that string occurs nowhere in the real
  transcript. On dispatch: push a `kind: "subrunner"` card with `subrunnerId`
  PROVISIONALLY set to the dispatch's own `tool_use.id`, `text` = the
  dispatch's own `description`, `subrunnerStatus: "running"`, and register it
  in `pendingTools` like any other tracked tool call. The dispatch's own ack
  `tool_result` names the agent's real, STABLE id ("agentId: <id>") —
  `resolveToolResults` overwrites `subrunnerId` with it the moment that ack
  arrives, because a `SendMessage`-continued agent's SECOND notification
  carries a DIFFERENT `<tool-use-id>` than its first, so the dispatch's own
  tool_use id cannot be the correlation key across a multi-notification
  lifecycle. The actual completion signal is the SAME `<task-notification>`
  envelope the parser already reclassifies for background Bash commands; an
  `Agent` completion additionally carries a `<result>` tag with the full
  report. `resolveSubrunnerNotification(cards, event)` correlates by
  `event.taskId === card.subrunnerId`, sets `subrunnerStatus` to `"done"` or
  `"failed"` from `<status>`, and attaches the report (bounded/full pair, the
  same "nie croppen" contract every other field follows) preferring `<result>`
  over the shorter `<summary>`. A `task-notification` whose `taskId` matches
  no open subrunner card (a plain background-command notification, or a
  dispatch outside the narrative window) is a no-op by construction — no
  separate "is this an Agent notification" check needed.
- **Doubt-review round (4 findings, all addressed):**
  1. HIGH — `Task` is recognized as a dispatch tool for the classic CLI
     convention but was never confirmed to be async like `Agent` in this
     harness; a synchronous `Task` whose ack carries no `agentId:` fingerprint
     would have gotten stuck on `"running"` forever (no `task-notification` is
     ever generated for a subagent with no async background lifecycle).
     Fixed: `applySubrunnerAck` now treats a no-`agentId` ack as a SYNCHRONOUS
     completion — the ack content itself becomes the report and the card
     resolves to done/failed immediately, mirroring how the untouched
     `review`-bucket branch already reads a review Task's ack directly.
  2. MEDIUM — is the ack always processed before any notification for the
     same agent? Documented (not code-changed): an ack is that same
     `tool_use`'s own `tool_result`, so it is structurally present before any
     notification for that agent can exist at all — there is no transcript
     order where the notification could arrive first.
  3. LOW — `AGENT_ID_RE` was an unanchored substring search that could
     misfire on unrelated content coincidentally containing "agentId: X".
     Fixed: anchored to the harness's own "Async agent launched successfully"
     launch preamble.
  4. LOW — `resolveSubrunnerNotification`'s `.find()` picked the first
     same-id match with no defense against a same-id collision across two
     open cards. Fixed: prefers a still-`"running"` card over an
     already-resolved one, so a collision degrades predictably.
- **External Code-Review Cascade (glm + openai, both `revise`; 4 medium +
  3 low, all addressed):**
  1. MEDIUM (both providers) — Item 1's dedup was whole-text-equality only,
     not sentence-level: a duplicate sentence embedded in a longer narrative
     (e.g. "Investigated the flaky test. Merged as \"X\".") rendered
     unstripped. Fixed: new `stripDuplicateSentence()` in
     `missionActivityFeedText.ts` matches the PR title as a whitespace-
     tolerant token sequence and removes only that span, stitching the
     remaining narration back together.
  2. MEDIUM (both providers) — `extractTaskNotification`'s size gate dropped
     the WHOLE envelope past 64KB, reproducing the exact "stuck on running
     forever" bug class this iterate exists to fix, just at a bigger
     threshold. Fixed: a 2MB sanity ceiling now gates parsing at all; only
     the extracted `result` field is capped (65,536 chars, with a truncation
     marker), so an oversized report is bounded, never silently discarded.
  3. MEDIUM (openai) — a resolved subrunner card showed the identical "View
     subrunner report" button/accent whether it succeeded or failed; the
     required done/failed distinction was invisible. Fixed:
     `kindAccent()` gives `"failed"` its own err/red accent (previously
     shared with `"done"`'s muted accent), and the button reads "View
     failure details" with an X icon for a failed card, "View subrunner
     report" with a check icon otherwise.
  4. MEDIUM (openai) — `resolveSubrunnerNotification` resolved EVERY
     notification status except `"failed"` to `"done"`, so a malformed or
     unrecognized status (the parser's `"unknown"` fallback for a missing
     `<status>` tag) could falsely mark a running agent complete. Fixed:
     only `"completed"`/`"failed"` resolve the card at all; any other value
     is a no-op, leaving the card `"running"`.
  5. LOW — `.mc-feed-pr-meta > span:first-child { flex-shrink: 0; }` relied
     on DOM position, but the PR-number span is conditionally rendered — when
     absent, the merge-state span would wrongly inherit the no-shrink rule.
     Fixed: dedicated `.mc-feed-pr-number` class.
  6. LOW — the session-start-divider test only asserted that a time string
     appeared somewhere, which would also pass for a divider in the wrong
     position or missing its "Today"/"Session started" framing entirely.
     Fixed: fixed fake-timers pin "Today"; the full text is asserted
     exactly, and a DOM-order check confirms the divider is the scroll
     container's first child, above every card entry. (Split into its own
     `MissionActivityFeedSessionStart.test.tsx` to keep the parent test file
     under the 300-line convention.)
  7. LOW — `SubrunnerPanel.tsx`'s focus-capture `useEffect` was keyed on
     `card.subrunnerId`, which the reducer overwrites mid-lifecycle (dispatch
     id → real agent id) — a change while the panel is open would re-run the
     effect and clobber the focus-return ref with the panel's own close
     button. Fixed: captures the opener once, on mount (`[]` deps).
- **UI.** `MissionActivityFeedCard.tsx` renders the subrunner card with a
  running-state indicator or a "View subrunner report" affordance once
  resolved. Clicking calls a new `onSubrunnerClick(subrunnerId)` prop threaded
  `MissionActivityFeed` → `FeedCard`, up to `MissionBody`, which extends its
  existing `activeNode`/right-panel mechanic with a `subrunner:<id>` key
  rendering the new `SubrunnerPanel` (mirrors `MissionArtifactPanel`'s shape).
  New robot/bot icon in `MissionFeedIcons.tsx`'s `PATHS` map (Sven's explicit
  request).
- **Alternative considered, declined for v1:** an expand-sideways stacked set
  of panels for several concurrent subrunners. Declined because (a)
  `MissionBody` has exactly one right-panel slot today and stacking N of them
  is a real layout redesign, not a small addition; (b) no real concurrent-
  subrunner transcript was available to design against. Ship the
  single-panel version, fast-follow a stacked/tabbed layout if real usage
  shows it's needed.

### Item 4 — Remove "Needs attention" pill
- `MissionActivityFeedCardParts.tsx`: `pillLabel()` — delete the
  `if (card.kind === "blocker") return "Needs attention";` branch.

### Item 5 — Mute the commands-expand green
- `mission-operation.css`: `.mc-feed-expand-btn` — `color: var(--accent)` →
  `var(--muted)`. Shared by three call sites (`ExpandToggle`, the blocker
  "Show details" toggle, `FeedCommands`' "N commands" toggle) — muting all
  three keeps them consistent with each other.

### Item 6 — Remove kind labels + per-card timestamps, add session-start divider
- `MissionActivityFeedCard.tsx`: drop the `.mc-feed-kind` label span and every
  per-card `FeedTime` render (both the system and non-system header
  branches). The header row now renders only the status pill, when one
  exists (`pillLabel()` output — unrelated to the removed "Needs attention"
  case above, e.g. "Passing"/"Failing"/"Recorded"/"Passed" still show).
- `MissionActivityFeedCardParts.tsx`: delete the now-unused `KIND_LABEL` map
  and `FeedTime` component; add a `formatSessionStart()` helper for the new
  divider's "Today, 09:14" / "Sep 26, 09:14" text.
- `MissionActivityFeed.tsx`: render a one-time "Session started · <date>,
  <time>" divider above the feed, derived from the first card carrying a
  `timestamp` — never repeated per card.
- `mission-operation.css`: remove the now-dead `.mc-feed-kind`/`.mc-feed-kind-row`/
  `.mc-feed-time` rules, fold `.mc-feed-head-system`'s `flex-end` alignment
  into the base `.mc-feed-head` rule (now always a single-child row), add a
  small rule for the new session-start divider.

## Confidence Calibration
- **Boundaries touched:** see Affected Boundaries above.
- **Empirical probes run:**
  - Confirmed via direct JSONL inspection on this machine (`node -e` against
    `~/.claude/projects/.../*.jsonl`) that this harness's subagent dispatch
    tool is literally named `"Agent"`, not `"Task"` — the existing
    `stage-markers.ts`/`narrator-transcript.ts`/`missionActivityFeedClassify.ts`
    `Task`-only checks silently miss it entirely, which is the root cause of
    "you see almost nothing" for a subrunner today.
  - **Initial design disproven, then corrected, via real-browser + real-JSONL
    investigation.** First pass assumed the subagent hand-back arrives as a
    plain-string `user`-role event content `"Another Claude session sent a
    message:\n<agent-message from=\"ID\">..."`. A real-browser check of task
    `9ba56d6e-c5e7-40f4-83e5-443c2ffad268`'s Mission tab showed the dispatch
    card rendering correctly but stuck permanently on "Running…"; direct
    inspection of the real transcript (`9d005c26-66a0-47f0-94db-41c990ea220d.jsonl`)
    proved that exact string occurs NOWHERE in the file. The actual completion
    signal is the pre-existing `<task-notification>` envelope (already parsed
    by `session-parser.ts` into `kind: "task-notification"`, previously
    consumed only for background Bash commands) — an `Agent` completion
    additionally carries a `<result>` tag with the full report. Correlation
    cannot use the dispatch's own `tool_use.id`: a `SendMessage`-continued
    agent's SECOND notification (observed at JSONL lines 408/458 of the same
    file) carried a DIFFERENT `<tool-use-id>` than its first, so the only
    stable identifier across an agent's full lifecycle is its own
    `agentId`/`<task-id>`, captured from the dispatch's own ack `tool_result`
    text ("agentId: <id>"). `session-parser.ts`'s `TaskNotificationEvent`/
    `extractTaskNotification` were extended to also capture `<result>`, and
    the content-length cap widened 4096→65536 chars (a real final report ran
    several KB and silently failed the old cap's `endsWith` check).
  - The "no sidechain-JSONL convention" finding (searched every locally-stored
    JSONL for `isSidechain: true` + a `"Task"`-named tool_use, zero hits
    across ~30 session files) still stands as a fact, but is no longer load-
    bearing for the design above — the design does not depend on the absence
    of a sidechain file, only on the `<task-notification>`/`taskId` mechanism
    now confirmed sufficient. A `subagents/agent-<id>.jsonl` sibling file WAS
    separately observed to exist alongside the parent transcript; not chased
    down further since the notification mechanism alone resolves the card.
  - Read `MissionBody.tsx` end-to-end to confirm the right-panel slot is a
    generic `activeNode`-keyed mechanic already reused for two different
    panel types (`ArtifactPanel`/`MissionArtifactPanel`) — a third consumer
    (`SubrunnerPanel`) is additive, not a new mechanic.
  - Confirmed `checked out real prod files (MissionActivityFeedCard.tsx,
    MissionActivityFeedCardParts.tsx, MissionActivityFeed.tsx, mission-
    operation.css, missionActivityFeed.ts + siblings) end-to-end before
    editing — the "Open commit" link (item 1) already exists and works
    (`card.artifact && onArtifactClick` button), so item 1's scope is
    narrower than first read: dedup logic + icon swap + CSS fix only, no new
    link to add.
- **Test Completeness Ledger:** filled at Step 7.5, before F0.
- **Confidence-pattern check:** filled at Step 7.5.
