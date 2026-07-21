# Mini-Plan — FR-01.68 Mission narrative prose

## Chosen approach: two new pure modules + a quote-aware fix, render swap

**1. `client/src/lib/narrator-facts.ts` (NEW).** Pure. Takes the parsed
`ParsedEvent[]` plus the `tool_use_id → {content, is_error}` map and returns a
flat `NarrativeFacts` record: the ask, per-kind counts (files read / searched /
changed / commands), whether a spec was written, the ordered test-run outcomes,
commit count, PR number, the stages reached. It owns the NARRATIVE WINDOW (AC9)
— anchored at the iterate kickoff or `setup_iterate_worktree`, deliberately not
reusing `currentIterateEvents`, which stays untouched for the stepper.

**2. `client/src/lib/narrator-prose.ts` (NEW).** Pure. Takes `NarrativeFacts`
and returns `NarrativeParagraph[]`, where a paragraph is a list of spans:
`{kind: "text", text}` or `{kind: "link", text, artifact}`. It composes
sentences and owns nothing else — no parsing, no counting.

The split is deliberate (Ousterhout): the facts change when Shipwright's tooling
changes; the sentences change when the wording does. Folding both into
`narrator-transcript.ts` was REJECTED — that file is at 282 LOC against a 300
ceiling, and it would put two reasons-to-change in one module.

**3. `client/src/lib/stage-markers.ts` — quote-aware `commandHeads` (AC8).**
Segment splitting skips ranges inside single/double quotes, so a tool name in a
quoted argument no longer becomes a command head. Pure, local, and it corrects
the shipped stepper as well as the new narration.

**4. `client/src/external/session-parser.ts` — carry `<command-args>` (AC2).**
`SlashCommandEvent` gains an optional `args`; the detector already matches the
paired tags, so this is an additive field, no reclassification.

**5. `OperationLive.tsx` — render paragraphs.** `<p>` per paragraph, spans
inline, a link span rendered as a button that calls `onNodeClick(artifact)`.
Keeps `.mc-hero` (it already scrolls); drops `.mc-hero-line`. Under
`prefers-reduced-motion` the complete final text renders immediately (A20) —
prose is content, so it is never hidden and revealed.

**6. `MissionBody.tsx` + `useMissionLive.ts` — wiring.** Thread `onNodeClick`
into `OperationLive`; expose `narrative` on the model; a completed run renders
the narrative with the existing verdict pinned above (AC10).

## Alternative considered: render prose from the existing `TranscriptSummary`

Keep `summarizeTranscript` as the single entry point, raise `MAX_ACTIVITY`, and
have `OperationLive` join the activity lines into sentences.

Cheaper — one file, no new modules. Rejected: the activity lines are already
lossy (`activityFor` collapses each event to one mechanical phrase and discards
the tool result), so the outcomes AC3 needs are gone before the renderer sees
them. Joining lossy phrases with commas produces a run-on sentence, not a story.
Prose has to be composed from the FACTS, not from pre-rendered log lines.

## Test strategy (TDD)

Unit, pure-module first — both new modules are total functions with no I/O.
Fixtures are trimmed REAL transcripts (the prototype already runs against them),
so the tests pin measured behaviour rather than invented shapes:

- facts: window anchoring (kickoff / worktree / neither), the ask from
  `<command-args>`, flag stripping, injected-content rejection, `is_error`
  pairing, counts.
- prose: failure→recovery arc, still-failing arc, all-green arc, absent facts
  produce no sentence, no duration string ever appears, sanitization.
- markers: the quote-aware regression — `grep -n "…\|playwright" .gitignore`
  must NOT set the Test marker, while a real `npx vitest run` still does.
- component: paragraphs render, a link span invokes `onNodeClick`, empty
  transcript keeps the honest waiting line.

## Risks

- `touches_shared_infra` → full suite, both workspaces.
- AC8 changes SHIPPED stage behaviour; existing stage tests must be re-read, and
  any that encode the quote-blind behaviour are wrong and get corrected, not
  weakened.
