# Architecture Brief: mission-feed-content

## The problem
The Mission tab's activity feed narrates a running or finished session with
one sentence per turn. For five of nine card kinds that sentence is one of a
handful of fixed strings ("A command needs attention before work can
continue.", "The requested user input was received...") regardless of what
actually happened. A user reading the feed cannot tell WHICH command failed,
WHAT question was asked, or WHAT the test failure was — only that a category
of event occurred. This was reported directly by the project owner after a
prior iterate shipped a partial fix (4 of 9 kinds).

## What already exists here
- `missionActivityFeed.ts` already narrates FOUR card kinds (`investigate`,
  `spec`, `implement`, `review`) from the transcript's own assistant prose
  when present, falling back to a fixed sentence otherwise.
- `MissionContext` (server-resolved, "durable/vetted") already supplies the
  authoritative pass/fail verdict for tests and the availability state for
  spec/requirement/review/decision/commit artifacts.
- The sibling BubbleTranscript surface already renders real tool errors,
  real AskUserQuestion prompts, and real PR links — but as a separate,
  now-retired page route, not inside Mission.

## What would newly, permanently exist
Two additive, optional fields on the client-side-only `ActivityCard` shape
(`detail`, `question`) populated per-render from the live transcript;
nothing is persisted or written anywhere. The one standing-behavior change
is narrowing an existing documented constraint ("Mission never reads raw
tool output") to permit bounded, truncated raw-output text as accompanying
detail on specific card kinds, while the pass/fail verdict itself keeps
coming from `MissionContext` only.

## Options on the table
- **A:** Narrow the "no raw tool output" constraint — bounded, truncated,
  sanitized excerpts of real command/error/question output become
  accompanying detail text on `blocker`/`test`/`user-input` cards; the gate
  verdict itself stays sourced from `MissionContext` exclusively.
- **B:** Keep the constraint fully intact — write more specific *templated*
  sentences per outcome (e.g. distinguish "a read command failed" from "a
  write command failed") without ever surfacing the transcript's own raw
  text.
- **C:** Do nothing further — ship only the visual/presentation redesign
  (icons, pills, chips, connecting spine) on top of the four kinds that
  already narrate real prose; the remaining five keep their fixed
  sentences.

## Constraints that are not negotiable
None beyond what already governs this surface: Mission remains read-only
(no write path is added or changed), and any transcript-derived text
renders through the existing safe markdown/text path only, never raw HTML.
