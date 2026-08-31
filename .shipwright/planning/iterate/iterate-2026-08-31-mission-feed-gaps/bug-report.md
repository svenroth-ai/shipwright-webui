# Bug Report — Mission Activity Feed gaps (iterate-2026-08-31-mission-feed-gaps)

No formal iterate spec exists for this run (BUG type, small complexity skips
it). This file stands in as the `--spec-file` baseline for external review.

## Reported issues (translated from German)

1. The Mission tab stops documenting/updating after the first delivery/PR
   goes through — later work (further iterates on the same session) never
   shows up.
2. No date/timestamp information is shown on feed items.
3. The feed opens with a generic fallback sentence ("The implementation was
   updated in compact steps.") instead of recognizing/showing that a new
   `/shipwright-iterate` run has started.
4. The Mission tab should default-scroll to the BOTTOM (latest activity) when
   switching to the tab, not the top (oldest activity).

The user was explicitly asked whether to fix all four in one pass now, and
chose to fix all four together — implementing all four in one diff is IN
SCOPE.

## What was implemented

1. **Root cause of #1**: `scenario.ts` rule 2b (persisted association) always
   won unconditionally over rule 5 (transcript recovery), with no freshness
   check. Fix: rule 2b now consults the transcript-recovery thunk; a
   different, corroborated run id supersedes a stale association. Throttled
   via a content-fingerprinted memo (`resolver-parts.ts`) to avoid re-scanning
   every ~1s poll.
2. **#2**: `ActivityCard.timestamp` threaded from the JSONL event's own
   timestamp at card-creation time; rendered via the existing
   `formatRelativeTime` helper with a full-date tooltip.
3. **#3**: The `/shipwright-iterate` intro banner is now recognized
   (`containsIterateBanner`) and gets its own dedicated "goal" card, instead
   of being silently absorbed into generic narration-carry.
4. **#4**: `MissionActivityFeed.tsx` now uses the existing, already-tested
   `useAutoScroll` hook for initial scroll-to-bottom and ongoing auto-follow.

Acceptance criteria (assertion-shaped):
- AC1: a session with a stale `task.missionContext` association, whose own
  transcript's last corroborated `Run-ID:` footer names a DIFFERENT run than
  the association, resolves `scenario=iterate` with the NEWER run id, not the
  stale one.
- AC2: `ActivityCard.timestamp` equals the creating JSONL event's own
  `timestamp` field, never a client-side "now"; absent only when the source
  event carried none.
- AC3: a transcript containing the `/shipwright-iterate` intro banner
  produces a dedicated `kind: "goal"` card whose text names the run start,
  and the banner's own boilerplate text never appears as another card's
  headline.
- AC4: `MissionActivityFeed`'s scroll container's `scrollTop` equals its
  `scrollHeight` shortly after mount when cards exist (bottom-anchored).
