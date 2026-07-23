# Iterate Spec — Incremental transcript parse + memoized markdown leaf

- **Run ID:** `iterate-2026-07-23-transcript-incremental-render`
- **Date:** 2026-07-23
- **Intent:** CHANGE (performance) · **Spec Impact: NONE** (behavior-preserving)
- **Complexity:** medium (history-calibrated)
- **Charter:** deferred by `iterate-2026-07-22-transcript-cursor-single-walk`
  (now merged to `origin/main`), which fixed the *fetch* and measured what it
  did not fix: the *re-parse*.

## Problem

`useTaskTranscript` now delivers `transcript.content` as an **accumulated,
append-only whole-line prefix that always ends on `\n`** (cursor-single-walk).
The transport carries only the delta, but two consumers still re-parse the
entire accumulated string on every poll that grows it:

1. `BubbleTranscript.tsx:54` — `useMemo(() => parseSessionJsonl(content), [content])`.
2. `TaskDetailPage.tsx` `transcriptStats` — a second full `parseSessionJsonl`.

Measured on this project's real corpus (charter): **5.6 ms at the median
(2.49 MB / 1127 events), 11.3 ms at p90 (5.66 MB / 3015 events), per poll.**
That is why the cursor delivered ~40× on an idle tab but only ~2.5× on an
actively streaming one: transport fell 15.5 ms → 1.4 ms while the re-parse
stayed. Idle polls already avoid it (string value-equality keeps the `useMemo`
cached); the cost is paid only on growth polls — exactly the streaming case.

Secondarily, because a full re-parse mints **new event objects** every growth
poll, every mounted bubble's `entry` prop changes identity, so `MarkdownChunk`
(react-markdown + rehype-highlight, unmemoized) re-runs for every visible bubble
each poll even though its text is unchanged.

## Approach

A **renderer-level incremental parse**, transport-independent (it recomputes its
own delta from the append-only `content` string, so it composes with both `main`
and any future transport change as long as `content` stays accumulated):

1. **New module** `client/src/external/incremental-session-parse.ts` — a pure
   `advanceIncrementalParse(prevState, content)` that:
   - fast-returns the cached result when `content === prev.content`;
   - detects append via `content.startsWith(prev.committedPrefix)` (a
     **sufficient correctness check**, not a heuristic: identical leading bytes
     ⇒ identical committed events); resets to a full parse otherwise
     (rotation / truncation / task-switch);
   - parses **only the newly-completed lines** `[committedLen, lastNewline+1)`
     by delegating to the existing, tested `parseSessionJsonl` on that
     sub-region, then re-parses the trailing partial line (always `""` in
     production) — yielding a result **byte-identical** to
     `parseSessionJsonl(content)` for any final `content`;
   - uses `concat` so **already-parsed event objects keep their references**.
   - Does NOT touch `session-parser.ts` (frozen at its bloat baseline, 816).
2. **New hook** `client/src/hooks/useParsedTranscript.ts` — a ref-memo wrapper
   (the standard "previous-value" pattern) that holds the incremental state
   across renders. Idempotent under StrictMode double-render.
3. Wire it into **`BubbleTranscript.tsx`** (replace the full-string `useMemo`)
   and **`TaskDetailPage.tsx`** (feed `transcriptStats` from it; net −1 line so
   the frozen 673-LOC baseline is not ratcheted).
4. **Memoize `MarkdownChunk`** (`React.memo`, pure over `content: string`) so an
   unchanged bubble skips the expensive markdown render once its `entry`/text is
   referentially stable. This is the safe half of "reconcile only new bubbles";
   the whole `TranscriptRow` is deliberately NOT memoized (its collection props
   — `toolResultsById` / `visibleToolUseIds` — legitimately change when a tool
   result lands, so a memoized row could render stale).

### Alternative considered (mini-plan)

**Parse once in `TaskDetailPage` and pass `ParsedEvent[]` down to
`BubbleTranscript`.** Rejected: it breaks `BubbleTranscript`'s `content: string`
prop contract and its 1229-LOC test suite for a negligible saving — two
*incremental* parses are each O(delta) and cost ~0 on growth polls. Keeping two
hook instances is simpler and preserves the test contract. (Karpathy #2/#3:
simplicity + surgical scope.)

## Affected Boundaries

- **Producer→consumer:** Claude JSONL (third-party io-boundary) → `parseSessionJsonl`
  → incremental layer → `BubbleTranscript` / `transcriptStats`. The incremental
  layer is the new seam; its contract is *byte-identical to the batch parser for
  any final content*. N=2 consumers of the parse.

## Acceptance Criteria

- **AC1** — For any sequence of growing `content` snapshots, feeding them through
  the incremental parser one-by-one yields, at each step, a result **deep-equal**
  to `parseSessionJsonl(content)` (events + `malformedLines`).
- **AC2** — Already-**committed** (newline-terminated) event objects keep
  referential identity across an append; only newly-appended events are new
  objects. (A trailing partial line has no `\n`, so it is re-parsed each step and
  is given a fresh identity when it later commits — but production `content`
  always ends on `\n`, so no partial tail is ever exposed to a consumer. Byte
  identity of the events still holds regardless, per AC1.)
- **AC3** — A non-append content (shorter, or a differing prefix: rotation /
  truncation / replacement) triggers a full re-parse and a correct result.
- **AC4** — An idle poll (identical `content`) returns the **same** result object
  reference (no downstream memo churn).
- **AC5** — `BubbleTranscript` and `TaskDetailPage` render identically to before
  (existing suites green, unchanged).
- **AC6** — `MarkdownChunk` skips re-render when its `content` prop is unchanged.

## Confidence Calibration

- **Boundaries touched:** Claude JSONL (third-party io-boundary) →
  `parseSessionJsonl` → **new incremental seam** → 2 consumers
  (`BubbleTranscript`, `TaskDetailPage.transcriptStats`). The seam's contract:
  *byte-identical to the batch parser for any final `content`*.
- **Empirical probes run** (each found nothing → area exhausted):
  1. **Round-trip** (producer→file→consumer), line-by-line growth of an 8-line
     mixed corpus → `advance` result deep-equals `parseSessionJsonl(content)` at
     every step. → no drift.
  2. **Boundary probe — char-by-char growth** (exercises the trailing partial
     line production never emits — mid-JSON and mid-surrogate tails — but the
     batch parser must still agree with) → deep-equal at every step. → no drift.
  3. **Reset probe** — truncation (shorter), replacement (differing prefix),
     rotation→empty→regrow → full re-parse, result deep-equals batch. → no drift.
  4. **Malformed-line probe** — bad middle line: `unknown` stub preserved,
     `malformedLines` equals batch. → no drift.
  5. **Reference-preservation probe** — old event objects `toBe`-identical
     across an append (this is ALSO the deterministic proof the old lines were
     not re-parsed). → preserved.
  6. **Mechanism probe** — `parseSessionJsonl` spied through: an append hands it
     only the appended region (< 1/10 of the accumulated string); an idle poll
     calls it zero times. → confirmed.
  7. **StrictMode probe** (hook) — double-render does not double-append; result
     correct. → no drift.
- **Test Completeness Ledger** (testable ⇒ tested; 0 untested-testable):

  | # | Behavior | Disposition | Evidence |
  |---|---|---|---|
  | 1 | Byte-identity, line-by-line growth | tested | `incremental-session-parse.test.ts` AC1 |
  | 2 | Byte-identity, char-by-char (tail path) | tested | same, AC1 char-by-char |
  | 3 | No-trailing-newline + empty string | tested | same, AC1 |
  | 4 | Reference preservation across append | tested | same, AC2 |
  | 5 | No mutation of prior state | tested | same, AC2 |
  | 6 | Reset on truncation | tested | same, AC3 |
  | 7 | Reset on prefix-diff (rotation/replacement) | tested | same, AC3 |
  | 8 | rotation→empty→regrow | tested | same, AC3 |
  | 9 | Idle poll → same result reference | tested | same, AC4 |
  | 10 | Malformed-line accounting | tested | same, malformed |
  | 11 | Delta-only parse (append) + zero-parse (idle) | tested | `incremental-session-parse.mechanism.test.ts` |
  | 12 | Hook: growth returns batch result | tested | `useParsedTranscript.test.ts` |
  | 13 | Hook: idle → same reference | tested | same |
  | 14 | Hook: StrictMode double-render safe | tested | same |
  | 15 | `MarkdownChunk` skips re-render on unchanged content | tested | `MarkdownChunk.memo.test.tsx` AC6 |
  | 16 | `MarkdownChunk` re-renders on content change | tested | same |
  | 17 | `BubbleTranscript` renders unchanged | tested | `covered-by-existing-test` — `BubbleTranscript.test.tsx` (unchanged, green) |
  | 18 | `TaskDetailPage` stats render unchanged | tested | `covered-by-existing-test` — `TaskDetailPage.test.tsx` (unchanged, green) |
  | 19 | Empty transcript forces `pending` to 0 (guard) | tested | `TaskDetailPage.transcriptStats.test.tsx` (external-review Finding 1) |

## External review (medium, auto)

`external_review.py --mode code` via OpenRouter (gemini + openai), 2/2 succeeded,
non-degraded. Findings + dispositions:

- **F1 — regression (medium), `TaskDetailPage`:** the empty-content guard was
  dropped, so an empty transcript could show a nonzero inbox `pending`. **FIXED**
  — guard restored verbatim + pinned by
  `TaskDetailPage.transcriptStats.test.tsx`.
- **F2 — AC2 scope (medium), incremental parser:** a trailing partial line
  (no `\n`) changes event identity when it later commits. **CLARIFIED, not a
  bug** — production `content` always ends on `\n`, so no tail is ever exposed;
  byte identity still holds (AC1). AC2 wording narrowed to committed events; code
  comment added. Forcing tail identity would add production-dead complexity
  (YAGNI).

A second internal adversarial code-review subagent ran in parallel (fresh
context, biased to disprove byte-identity / staleness / reset).

- **Confidence-pattern check:** **depth** — byte-by-byte growth probes the parse
  boundary to exhaustion; **breadth** — all 6 ACs + 18 behaviors enumerated and
  tested, 0 untested-testable; **composition** — N/A: this is a webui renderer,
  not FRAMEWORK cross-component machinery, so `cross_component` does not fire (no
  integration-coverage mandate). Behavior-snapshot: 202 transcript-path tests
  green before, 218 green after (only additions; no coverage removed).

## Spec Impact justification (NONE)

Behavior-preserving performance refactor: the parsed event stream and every
rendered bubble are byte-identical; only per-poll CPU and re-render count change.
No FR is added or modified. FR-gate branch: `change_type = infra` (non-FR
renderer/perf code). The F-simplify reducibility catalog is N/A (this is
additive perf work, not line reduction); the behavior-snapshot → verify
green→green contract is the governing guard and is honored.
