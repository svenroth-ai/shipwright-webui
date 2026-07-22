# Iterate — Mission middle card: a told story, not a log tail (FR-01.68)

- **Run ID:** `iterate-2026-07-21-mission-narrative-prose`
- **Type:** FEATURE · **Complexity:** medium · **Spec Impact:** ADD (FR-01.68)
- **Risk flags:** `touches_shared_infra` (`client/src/lib/`) → full test suite

## Problem

The Mission tab's middle card is a rolling window of the last six mechanical
tool lines. `summarizeTranscript` caps at `MAX_ACTIVITY = 6` and returns
`lines.slice(-6)`; `OperationLive` renders them as equal-weight `<div>`s.

Measured on a real session (the one that produced PR #307): **152 narratable
steps existed, 146 were discarded.** What survived was a truncated shell
command, two notes-file edits, and the same pull request twice. No beginning,
no outcome, no causality — and nothing in it means anything to a reader who is
not a developer, which is precisely the audience the campaign SPEC §1 names.

Sven cannot scroll it, either. `.mc-hero` already carries `overflow-y: auto`
and is a correct flex scroll container (`mission-operation.css:38`) — the cap is
in the DATA, so the container never overflows and there is nothing to scroll to.

Three facts the card already has and throws away:

1. **The six lifecycle stages** are derived honestly since S4
   (`stage-derivation.ts`) and consumed only by the LEFT stepper.
2. **`toolResults()`** (`session-parser.ts:520`) extracts `is_error` + content
   paired by `tool_use_id`. The narrator never imports it. This is the
   difference between "running tests" and "tests ran → six failed → all green".
3. **The operator's ask** lives in the iterate kickoff's `<command-args>`; the
   parser classifies the event as `slash-command` and drops the arguments.

## Approach

Replace the activity list with **narrated prose**: paragraphs of real sentences,
composed deterministically from the parsed facts. No language model — cost,
latency and non-determinism aside, a card that may fabricate would forfeit the
honesty contract S4 exists to enforce. Every sentence is earned by a fact; an
absent fact yields NO sentence rather than a placeholder.

Prose is not a styling choice, it is the load-bearing decision. Prototyped
against real transcripts (`scratchpad/prototype_prose.py`), it also dissolves
the chapter-segmentation problem that sank the accordion design — there are no
chapter boundaries left to get wrong.

**Rejected, with evidence** (all three measured on real transcripts, not
reasoned about):

- *Per-acceptance-criterion live progress* ("now on to AC2"). Over 119 real
  iterate transcripts: 35% name ≥2 distinct ACs in prose, and only 47% of those
  advance in order — correct in ~16% of sessions. An AC is named in a commit
  message in 1% and in a test command in 0%, so "AC1 is tested and passing" is
  0% evidenced. It would fabricate in five sessions out of six.
- *Chapters/accordion.* A disguised list; "klickbar ist alles rundherum".
- *Per-event stage classification.* Produced 18 chapters of Build/Test ping-pong
  on a real session. The monotone latch is right; the 7 h "Merge" blob it was
  blamed for was a WINDOWING defect.

## Acceptance Criteria

**AC1 — Prose, not a list.** The middle card renders paragraphs of sentences.
No rolling window, no per-step enumeration, no accordion, no link column. The
`MAX_ACTIVITY = 6` truncation is gone and the card scrolls its own content.

**AC2 — The ask is narrated, selected by PROVENANCE not by pattern.** The
operator's request opens the story, sourced from the iterate kickoff's
`<command-args>`, falling back to the first user-role event the SHIPPING PARSER
still classifies as `kind: "user"`. That parser already reclassifies skill
manuals, task notifications and stop-hook banners into their own kinds, so
event structure — not a growing text denylist — does the filtering. Only the
harness artefacts it does not yet reclassify (`[Request interrupted…]`) are
rejected by content, and that list is closed and tested.

Leading CLI flags are stripped from the ask (`--autonomous` is how it was
asked, not what was asked): flag stripping stops at `--`, handles a flag
carrying a value, and a request that legitimately begins with a dash survives
intact. One fixture each.

**AC3 — Outcomes, not just actions, GRADED BY EVIDENCE.** Tool results are
paired to their calls by `tool_use_id`. The narrated strength never exceeds what
the result proves — `is_error` alone establishes that an invocation errored, NOT
that "six failed" or that "the whole suite came back green" (a command may run a
targeted subset, swallow the status with `|| true`, or carry several heads under
one result). Three tiers, tested separately:

| evidence | narration |
|---|---|
| failure count parsed from recognised test output | "six of them failed" |
| `is_error` only | "the tests did not pass" |
| success with a parsed pass count | "the whole suite came back green" |
| success, no parsed counts | "a later run completed without errors" |

Recovery ("… until it came back green") is narrated ONLY when a later comparable
invocation carries positive success evidence — never inferred from the absence
of an error.

**AC3b — Pending results.** A tool call whose `tool_result` has not arrived (the
live case, or an interrupted run) narrates as in-progress. It is never dropped,
never treated as success, and never throws.

**AC4 — Noise is counted, never listed.** Reads, searches and incidental
commands aggregate into counts inside a sentence. No line per step.

**AC5 — Links live inside the sentences, and only when they resolve.** An
artifact reference is an inline link on the noun it belongs to ("pull request
#307", "the tests"), activating the SAME `activeNode` selection the left rail
drives — one artifact panel, no second viewer, no parallel link list. A link
span is emitted ONLY when the reference resolves to a node the rail actually
offers; otherwise the same words render as ordinary text. No dead buttons, and
no second selection model. The link target is always a trusted node identifier
— NEVER a value read out of the transcript. Rendered as a real
`<button type="button">` reaching selection by keyboard on the same path as the
left rail.

**AC6 — No durations.** No elapsed time, anywhere in the narration. Wall-clock
across a session that is mostly thinking, paused or resumed measures something
other than what it would claim.

**AC7 — Honest by construction, sanitized at the boundary.** A fact the
transcript does not evidence produces no sentence. An empty transcript yields
the existing honest waiting line, never invented activity.

This card promotes previously-discarded transcript content (command arguments,
tool output) into prominent UI text, so sanitization happens in
`narrator-facts.ts` at the point a fact is created — NOT in the renderer.
Everything transcript-derived is untrusted: `<command-args>`, the user-message
fallback, tool output, filenames. Control/bidi-stripped and length-capped via
`sanitizeProofText`. Committed fixtures are trimmed AND audited for credentials,
absolute user paths and personal content before they land.

**AC7b — No regression in the states that already work.** Every current
`TranscriptSummary` consumer and every `OperationLive` branch (waiting, empty,
loading) is traced before activity rendering is removed, and the established
behaviour is preserved. The left stepper's inputs are not changed by this
iterate beyond the AC8 correctness fix.

**AC8 — Quote-aware command heads (defect fix).** `commandHeads`
(`stage-markers.ts:104`) splits on `\n ; && || | &` with no quote awareness, so
a tool name inside a QUOTED argument becomes its own command head and sets a
phase marker. `grep -n "visual\|screenshot\|playwright" .gitignore` currently
sets the Test marker. Measured: **47 of 198 real transcripts (23%)** contain at
least one such command (63 test, 11 build, 4 merge). This also corrects the
SHIPPED left-hand stepper, so its existing tests are re-read: any that encode
the quote-blind behaviour are WRONG and get corrected, never weakened.

Implemented as a small stateful scanner, NOT a cleverer regex: it tracks single
quotes, double quotes and backslash escapes, and recognises a separator only in
the unquoted, unescaped state. Regression fixtures cover escaped quotes inside
a quoted string, an escaped separator, mixed quoting, and an UNCLOSED quote
(which must degrade to the old behaviour rather than swallow the line). Shell
syntax deliberately not supported (command substitution, heredocs) is documented
at the function rather than silently misclassified. A real `npx vitest run`
must still set the marker — the fix must not buy honesty with blindness.

**AC9 — Narrative window, stated as an algorithm.** The story spans the current
(sub-)iterate, NOT the tail after the last `pr-link`. The shipped
`currentIterateEvents` rule is correct for a stepper and amputating for a story
— measured, it cut 286 events to 8 and 321 to 109. It is left untouched; the
narrative gets its own window, defined exactly:

1. An ANCHOR is an iterate kickoff `slash-command`, or a Bash call running
   `setup_iterate_worktree` (measured 89% frequency).
2. The window starts at the LAST anchor by event index — a later sub-iterate
   always wins over an earlier one.
3. The window ends at the last event. A `pr-link` never closes it; post-PR
   review fixes belong to the iterate that produced them.
4. NO anchor → the whole event array, which is the pre-existing behaviour for a
   plain session and cannot narrate a foreign task, because the array is already
   one session's transcript.

Each of the four is a separate test.

**AC10 — Completed runs tell their story too.** A completed run renders the same
narrative with its existing verdict/proof pinned above it, so a run reads the
same before and after, only more complete.

## Affected Boundaries

- `client/src/lib/` — shared infra (`touches_shared_infra`): a new prose module
  (`narrator-transcript.ts` is at 282 LOC, so this is NOT an extension of it)
  and a quote-aware `commandHeads` in `stage-markers.ts`.
- The JSONL io-boundary: untrusted third-party content, already sanitized.
- `MissionBody` wiring for the inline-anchor callback (`activeNode`).

## Non-goals

- No language model, no server round-trip, no second poller (rule 4 / DO-NOT #1).
- No per-AC progress claim (falsified above).
- No German UI. The card stays English like the rest of the Command Center;
  translating one surface alone would be incoherent.
- The left panel and the artifact rail are not touched.

## External plan review (2026-07-21, openrouter — gemini + openai, both success)

12 findings, ALL accepted; the ACs above already carry them. Nothing deferred.

| # | Sev | Finding | Landed in |
|---|---|---|---|
| 1 | high | `is_error` does not prove "six failed" / "all green" | AC3 evidence tiers |
| 2 | high | Quote-aware splitting is a trap (escapes, nesting, unclosed) | AC8 stateful scanner |
| 3 | high | Does a completed run still hold the source facts? | **verified** — `useTaskTranscript` is ungated, both paths share one derivation (AC10) |
| 4 | high | Window rule underspecified (which anchor, what ends it) | AC9, four numbered rules |
| 5 | med | Inline links may not resolve to a rail node → dead button | AC5 resolve-or-plain-text |
| 6 | med | Transcript content promoted to UI; link targets must be trusted | AC7 sanitize at the boundary |
| 7 | med | Pending `tool_use_id` in a live/interrupted run | AC3b |
| 8 | med | Ask filtering by text denylist is fragile; `--` handling | AC2 provenance-first |
| 9 | med | `TranscriptSummary` consumers not audited before the swap | AC7b |
| 10 | med | Live reflow/jitter as counts change under the reader | below |
| 11 | low | `<button type="button">` + keyboard parity | AC5 |
| 12 | low | Facts should return evidence-qualified, sanitized values | AC3 + AC7 |

**On #10 (reflow).** Real, and not fully removable — a live story that stays
honest must change when the facts change. Mitigated structurally rather than by
a timer: the aggregate-count sentence is always LAST in its paragraph, so a
changing number reflows nothing above it, and the derivation stays memoized on
transcript content so an unchanged poll re-renders nothing. A debounce was
rejected: it would make the card lag the terminal it is meant to replace.

## Confidence Calibration

- **Boundaries touched:** the Claude JSONL io-boundary (untrusted third-party
  producer — sanitised at fact creation, not at render); `client/src/lib/`
  shared infra (`touches_shared_infra` → both full suites); the Mission
  `activeNode` selection contract shared with the left rail.

- **Empirical probes run** (all READ-ONLY over `~/.claude/projects`, scripts in
  the session scratchpad):
  1. `probe_ac_linkage.py` / `probe_ac_progression.py` — 119 iterate
     transcripts. 84% mention an AC token, but only 35% name ≥2 in prose and
     only 47% of THOSE advance in order; an AC is named in a commit message in
     1% and in a test command in 0%. **Falsified** the per-AC live progress
     design (~16% correct) before a line was written.
  2. `probe_quote_blind_markers.py` — 198 transcripts, 47 (23%) carry a command
     that fabricates a phase marker through quote-blind splitting (63 test, 11
     build, 4 merge). Drove AC8.
  3. `probe_slash_detect.py` — 202 transcripts, 124 kickoff events, **124
     rejected (100%)** by the shipped detector, 123 on the length cap. Drove
     AC2b, and proved a documented "load-bearing" branch had never executed.
  4. `prototype_prose.py` then `scratch-render.ts` — the design rendered on real
     sessions BEFORE and AFTER the TypeScript port. The port caught two defects
     the unit tests missed: a missing verb ("The tests, and three of them
     failed") and the ask being lost to the worktree-anchored window. Both are
     now pinned by whole-sentence assertions.
  5. Real-browser E2E on an isolated stack (temp `USERPROFILE`, 127.0.0.1:3849,
     built client): 3/3 new + 7/8 pre-existing mission specs. The single failure
     (`A12` embedded terminal) is `pty_spawn_failed code 5` — the documented
     environmental ACCESS_DENIED of an isolated stack, unrelated to this diff.

- **Test Completeness Ledger:** 17 behaviours, all `tested`, 0
  testable-but-untested. Enumeration basis = the 12 acceptance criteria
  (AC1–AC10 plus AC3b/AC7b), each split where it carries more than one
  observable behaviour.

| # | Behaviour | Disposition | Evidence |
|---|---|---|---|
| 1 | Middle card renders prose paragraphs, not an activity list | tested | `OperationLive.test.tsx` "renders paragraphs of prose" |
| 2 | The retired six-line window leaves no `.mc-hero-line` behind | tested | same test, negative assertion |
| 3 | Ask sourced from `<command-args>` | tested | `narrator-facts.test.ts` "takes the operator's request" |
| 4 | Leading CLI flags stripped, value-flags consumed, `--` respected | tested | `narrator-facts.test.ts` ×2 |
| 5 | Harness injections never narrated as user speech | tested | `narrator-facts.test.ts` "never narrates harness injections" |
| 6 | Failure COUNT read only from recognised output | tested | `narrator-facts.test.ts` + `narrator-prose.test.ts` |
| 7 | `is_error` alone never becomes a count | tested | `narrator-facts.test.ts` "does not invent one" |
| 8 | Counted vs uncounted pass narrate differently | tested | `narrator-prose.test.ts` "may claim the whole suite" |
| 9 | Pending result → in progress, never success | tested | `narrator-facts.test.ts` + `narrator-prose.test.ts` + E2E |
| 10 | Noise aggregated into counts, never listed | tested | `narrator-prose.test.ts` + E2E (no filenames) |
| 11 | Inline link resolves, or renders as plain text | tested | `narrator-prose.test.ts` + `OperationLive.test.tsx` |
| 12 | Link is `<button type="button">`, keyboard-reachable | tested | `OperationLive.test.tsx` ×2 |
| 13 | No duration ever appears | tested | `narrator-prose.test.ts` unit-regex + E2E |
| 14 | Empty transcript keeps the honest waiting line | tested | `OperationLive.test.tsx` + `MissionBody.test.tsx` + E2E |
| 15 | Quote-aware command heads (incl. escapes, unclosed quote) | tested | `stage-markers.test.ts` ×3 |
| 16 | Slash command with arguments is a slash command | tested | `session-parser.slash-args.test.ts` ×6 |
| 17 | Narrative window: 4 rules + ask recovery + completed-run stack | tested | `narrator-facts.test.ts` ×7, `MissionBody.test.tsx` |

- **Confidence-pattern check:**
  - *Asymptote (depth)* — the full mission suite (23 files, 182 tests) plus both
    workspace suites (2961 client, 2890 server) are the behaviour oracle and are
    green. The two defect fixes each began RED against the shipped code, per
    this suite's standing revert-and-rerun rule.
  - *Breadth* — the honesty guarantees are tested as NEGATIVES (what the card may
    not say), which is where this feature can actually fail. Whole-sentence
    assertions were added after fragment-level `toContain` let two grammar
    defects through to a real render.
  - *Integration composition* — `cross_component` is NOT set: no merge/churn
    resolver, hook fan-out, phase validator or campaign-drain machinery is
    touched. The composition that DOES matter here (parser → markers → facts →
    prose → DOM → click) is covered end-to-end by the real-browser spec rather
    than by mocks.
