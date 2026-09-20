# Mission activity feed: transcript fidelity fixes

## Context

Sven reviewed a real iterate session's Mission tab and reported (German,
translated) seven gaps between what the feed showed and what actually
happened in the transcript:

1. Wordless `implement`/`investigate` tool-only cards clutter the feed with
   no explanatory text; his own typed replies never show up at all.
2. The "Delivered" success box and the "Open commit" link beneath it are
   cramped together with no spacing.
3. The run's start and end/closing summary never print in the feed.
4. Blocker cards render red with no information about what happened or
   whether they need the user's interaction.
5. A spec card showing only "Open Spec" with no other content should be
   omitted entirely.
6. Nothing indicates a reviewer subagent has started — the feed jumps
   straight to verdict sentences.
7. General: "my gut tells me not everything that would appear in the
   terminal is showing up" — an open-ended request to re-verify transcript
   fidelity broadly, not just the six enumerated items.

## Decision

Extended `missionActivityFeed.ts`'s reducer and its cooperating modules
(`missionActivityFeedTurn.ts` — new, `missionActivityFeedClassify.ts`,
`missionActivityFeedText.ts`, `missionActivityFeedReconcile.ts`) to:
filter wordless implement/investigate/spec cards while preserving any real
artifact summary evidence; surface a human's own typed replies as `"user"`-
kind cards; give the `/shipwright-iterate` intro banner its own "goal" card
(deduped against re-prints); flush trailing narration with no following
tool call as a closing "system" card, gated off while the run is confirmed
still live to avoid mid-run flicker; attach a live/ended/loading-aware
explanation to every blocker card; synthesize a "Spawned the reviewer..."
sentence for a wordless reviewer-spawn Task card; and add one CSS
sibling-combinator spacing rule between the PR box and the "Open commit"
link.

## Consequences

Pure client-side reducer change plus one CSS rule — no server or API
changes. Three files pushed over the project's 300-line bloat-baseline
convention by real correctness fixes found across 3 internal + 3 external
code-review rounds (each grandfathered with a causal note, not reflowed to
hide the crossing): `missionActivityFeed.ts` (313), `missionActivityFeedCard.tsx`
(301), `missionActivityFeedReconcile.ts` (324), `missionActivityFeed.test.ts`
(315), `missionActivityFeedText.ts` (312).

## Rationale

The review cascade caught issues in layers: round-1 internal review found
10 findings; round-2 internal review found 2 self-inflicted regressions in
round-1's own fixes; round-3 internal review confirmed those fixes and
surfaced 3 more low-severity items. External review then ran 3 times: run 1
found 2 medium correctness bugs (blocker cards with no explanation under a
loading context; a combined banner+tool turn losing its own real narration);
run 2's own fix for the second bug was itself broken by a regex anchoring
mistake, self-caught by an internal round-4 sanity-pass review before
external run 2 even reported its own (correct) finding of the same root
cause from a different angle; run 3 got clean "approve" verdicts from both
reviewers, with 2 of 4 remaining low findings fixed anyway (a duplicate
"goal" card on a replayed transcript segment; command-chip evidence lost
when a wordless card is dropped and backfilled from an artifact summary).

## Rejected alternatives

Adding Claude Code's `<command-name>`/`<command-message>`/`<command-args>`
slash-command XML tags to the shared `INJECTED` denylist (an external
reviewer's suggestion) was investigated and declined: that exact shape is
already reclassified to its own `"slash-command"` `ParsedEvent` kind by the
existing `detectSlashCommand()` parser, upstream of where this denylist
runs — adding it there would both never fire for the described case and
would also delete a user's real command arguments, contradicting the
denylist's own documented "deliberately tiny" design. A CSS `display`
override for the "Delivered" box spacing rule (also externally suggested)
was declined after tracing the DOM: the sibling element is a `<button>`,
whose UA-default `display: inline-block` already makes the `margin-top`
rule effective — no code change was needed.

## Test completeness

Full ledger in `.shipwright/planning/iterate/2026-09-20-mission-feed-transcript-fidelity.md`.
Highlights: direct unit coverage of `humanText`/`buildUserReplyCard`/
`reviewerDisplayName`/`stripIterateBanner` (including the verbatim real
12-line `/shipwright-iterate` banner text from SKILL.md, not just a
truncated test fixture); a real-browser Playwright spec
(`mission-feed-transcript-fidelity.spec.ts`, 5 scenarios) driving the actual
JSONL → reducer → DOM chain for the behaviors a synthetic fixture cannot
exercise. Full suite: 4304/4304 vitest tests, `tsc --noEmit` clean, lint
clean (0 errors), F0.5 web-surface Playwright run: 5/5 passed.
