# Mini-Plan: mission-feed-fixes

- **Run ID:** iterate-2026-08-22-mission-feed-fixes

**Revised after Internal Plan Review (`opus-plan-reviewer`).** Two `high`
findings, both caught by tracing the plan against *existing, currently-
passing* tests rather than reading the proposed change in isolation:

- (high) §3's original "vary the fallback text per tool input" design
  would have broken the reducer's own card-coalescing invariant — a
  900-`Read`-call fixture (`missionActivityFeed.fixtures.ts`) that must
  collapse to `cards.length <= 6` would instead balloon toward 900 unique
  cards, since coalescing keys on exact `text` equality and each Read now
  computed a distinct file-derived sentence. Now fixed: the tool-derived
  fallback is applied only as a **post-hoc backfill**, after the full
  event loop, to cards that (a) still carry the plain generic sentence and
  (b) ended up representing **exactly one command** — see the rewritten
  §3 below. A coalesced multi-command card keeps the generic sentence
  unchanged, exactly as today.
- (high) §4's original design ("scope the scan to a `Run-ID:` occurrence
  inside a Bash `git commit` tool_use's own `command` field") would have
  required parsing JSON structure the current pure-regex-over-flat-text
  function does not have, contradicts how the *existing* passing test
  suite represents the footer (`footerLine()` wraps it in a bare
  `{"text":"..."}` stub, not a `command` field), and risked a false
  negative for the common real case where Claude's commit message is
  authored via a heredoc/narrated text rather than literally inside the
  `command` string — silently regressing a legitimate short session back
  to "unidentified", the opposite of this fix's goal. Now fixed with a
  narrower, purely-textual exclusion instead of a structural inclusion:
  see the rewritten §4 below — it excludes only lines that are
  structurally a `tool_result`-bearing message (`"type":"user"`), and
  keeps scanning everything else exactly as before, so no legitimate
  assistant-authored occurrence is lost.

Two `medium` findings folded into §1 below (review-bucket lost its only
binary-name signal for this project's own review CLI scripts; the npm
test-form list missed colon-suffixed script names like `test:e2e`). Two
`low` findings folded into §5 (dead `.mc-feed-label` CSS; stale
`useMemo` dependency in `useMissionLive.ts`).

**Revised after External LLM Review** (`external_review.py --mode
iterate`; openai answered with verdict `revise`, deepseek returned an
empty reply — recorded as `unavailable`, no contradiction to resolve,
only one reviewer answered). Six findings integrated, one rejected:
- (medium, fix) §1's segment split on `&&`/`||`/`;`/`|` is naive about
  quoting — `git commit -m "fix: run && npx vitest works"` would have its
  quoted `&&` treated as a real separator, producing a bogus `npx vitest`
  leading-token segment. Fixed: the split is now quote-aware (tracks
  single/double-quote state char-by-char, only treats a separator as real
  when outside any quote) — see revised §1 below.
- (medium, fix) §2's Task-purpose check is tightened: check BOTH
  `subagent_type` and `description` (either matching is sufficient — not
  "subagent_type first suppresses description"), and use a
  word-boundary-scoped review-token match (`/\breview(?:s|ing|ed|er)?\b/i`)
  rather than a bare substring, so "preview" does not false-positive
  (word-boundary rules it out structurally) while "reviews.json" in a
  description legitimately does count as review-related prose (a
  different, more permissive context than §1's command-binary matching,
  and deliberately so — see revised §2 below).
- (medium, fix) §3's `commands.length === 1` check does not actually
  guarantee exactly one *event* contributed — `add()`'s existing
  coalescing dedupes `commands` by label string
  (`if (!previous.commands.includes(command)) ...push(command)`), so two
  distinct tool_use events that happen to produce the SAME label (e.g.
  two identical `Read` calls) would leave `commands.length === 1` while
  two events actually contributed. Fixed: a separate `WeakMap<ActivityCard,
  number>` tracks the real per-card event count (incremented on every
  `add()` call, whether it creates a new card or coalesces into an
  existing one); the backfill pass checks THIS count, not
  `commands.length` — see revised §3 below.
- (medium, fix) §4's own description overclaimed precision ("excludes
  only tool-result-bearing lines") for a filter that actually excludes
  every `"type":"user"` record, which also covers genuine human-typed
  prompts, not just `tool_result` wrappers. Resolved as a documented,
  deliberate simplification rather than a mechanism change: a `Run-ID:`
  footer is, by the F6 contract, never legitimately authored by a human
  typing a prompt either — only by an assistant-driven `git commit` — so
  excluding all `"type":"user"` content is still correct for this
  specific marker, and distinguishing "tool_result" from "plain user
  text" within that wrapper would need the same deeper JSON parsing this
  design deliberately avoids. Both the mini-plan (§4 below) and the
  spec's AC wording are corrected to state the filter precisely instead
  of the narrower claim.
- (medium, disclosed) An assistant can, in principle, narrate/quote an
  OLD footer in prose (not inside a `git commit` command) later in the
  same transcript, and the revised "last surviving assistant line wins"
  heuristic would still pick it. This is a real, narrower residual risk
  than the concrete bug being fixed (unrelated tool-result quoting) and
  is accepted as a **known limitation** rather than blocking this run —
  closing it fully would require message-boundary-aware extraction
  scoped specifically to `git commit` tool_use bodies, which was already
  evaluated and rejected as disproportionate (Internal Plan Review
  revision, §4 above). Documented in a code comment at `findRunIdFooter()`
  per the reviewer's own suggested mitigation.
- (medium, rejected-with-reason) "The Spec Impact says the Mission view's
  `Updates:` line gains this run's `run_id`... no mini-plan step confirms
  that line's data path" — misreads the Spec Impact section's standard
  boilerplate (verbatim precedent from the prior sibling iterate's own
  spec): this refers to the FR-01.66 row's changelog/compliance
  `Updates:` line in `traceability-matrix.md`, populated automatically by
  the finalization tooling from `--affected_frs`, not a Mission-view UI
  element. There is no Mission-view "Updates:" line in this codebase to
  test.
- (low, fix) §3's tool-derived fallback must reuse `commandLabel()`'s
  EXACT existing sanitized/truncated value (already shipped, already
  shown in the `commands` chip today) — explicitly confirmed, not a new
  raw-text exposure path. New regression test: a command containing a
  token-like argument renders the identical redacted text in both the
  chip and the promoted sentence.
- (low, fix) §5's removal-safety grep is widened from `.mc-feed-label`
  alone to also cover `.goal`, `explicitGoal`, and `deriveActivityFeed(`
  repo-wide before deleting anything, relying on `tsc --noEmit` to catch
  any stale `ActivityFeed` object literal the grep missed.

## 1. Test/Review bucket over-matching (`missionActivityFeed.ts` lines ~166-173)

**Problem, concretely reproduced:** `/test|vitest|playwright|pytest/i.test(shell)`
and `/review|.../i.test(shell)` match the substring *anywhere*, including
inside an unrelated filename or flag: `git checkout HEAD --
shipwright_test_results.json` (real command run in the source session) →
misclassified `test`; `uv run record_review_pass.py record --from
doubt-reviewer` / any command touching `reviews.json` / `self-review.json`
→ misclassified `review`.

**Approach:** replace the bare substring test with a small
`looksLikeInvocationOf(shell, binaryNames)` helper: split `shell` into
segments on shell chain separators (`&&`, `||`, `;`, `|`), **quote-aware**
— a tiny char-by-char scan tracks single/double-quote state and only
treats a separator character as a real split point when it is outside any
quote (this is NOT a shell parser; it does not handle nested
substitutions or backslash-escaped quotes — bounded on purpose, see the
External Review revision note above). For each segment, strip leading
`VAR=value` assignments and a leading `cd ... &&`, then check whether the
segment's own **leading command word** (position 0 only, never a scan of
later positions within the segment) — or the token right after a known
runner prefix (`npx`, `npm run`/`npm test`/`npm t`, `pnpm`, `yarn`, `uv
run`, `python -m`) — matches one of the binary names. This naturally
excludes a match that only exists inside a larger identifier or path
(`shipwright_test_results.json`, `self-review.json`,
`record_review_pass.py`) or a flag (`--review-type`), because none of
those tokens is itself the command being invoked; the quote-awareness
additionally excludes a match that only exists inside a quoted argument
whose text happens to contain a chain-separator character (e.g. a commit
message body).

- `test` binaries: `vitest`, `playwright`, `pytest`, `jest`, plus the
  `npm test`/`npm t` forms and an `npm run test*` **prefix** match (covers
  `npm run test`, `npm run test:e2e`, and any other colon-suffixed test
  script this or a future project defines).
- `review` binaries (revised — the review bucket keeps a narrow
  binary/script-name signal for this project's own real review CLIs,
  rather than retiring command-based matching entirely, which would have
  silently demoted every Bash-invoked review step — `record_review_pass.py`,
  `external_review.py --mode code` — to a generic `implement` card even
  though this project's own review workflow is CLI-driven, not
  exclusively Task-subagent-driven): the leading command word (or the
  token after a runner prefix) matches `record_review_pass\.py` or
  `external_review\.py`. Combined with the Task-purpose signal (§2) and
  the existing artifact-reconciliation pass (`artifact(context,
  "review")`, unchanged), this keeps review activity visible through the
  transcript instead of only reappearing retroactively once an artifact
  is available.

**Regression tests (Build):** the four exact false-positive commands above
must resolve to `implement`, not `test`/`review`; `npx vitest run`, `npm
test`, `npm run test:e2e`, `pytest tests/`, `playwright test` must still
resolve to `test`; a quoted-separator commit message
(`git commit -m "fix: run && npx vitest works"`) must resolve to
`implement`, not `test` (External Review catch).

**Alternative considered:** a stricter `\b...\b` word-boundary regex alone.
Rejected — it still false-positives on `self-review.json` (hyphen is a
non-word boundary either side of "review") and `--review-type` (same
reason), two of the four concretely observed false positives, so it does
not actually close the bug the AC commits to closing.

## 2. Task-tool over-bucketing (line ~170, `tool.name === "Task"`)

**Approach:** a Task tool_use is bucketed `review` when EITHER declared
purpose field is review-related — `sanitizeProofText`-cleaned
`input.subagent_type` OR `input.description` (both are checked; either
matching is sufficient, not "subagent_type first suppresses
description") — matched against a **word-boundary-scoped** review token,
`/\breview(?:s|ing|ed|er)?\b/i`, not a bare substring. This deliberately
differs from §1's binary-name matching: here the input is free-form
descriptive prose (a subagent's own stated purpose), not a shell command
where "review" could appear inside an unrelated path/flag, so a
word-boundary match on the inflected word is the right level of
strictness — it structurally excludes "preview" (no boundary exists
between "p" and "review" — both word characters) while still counting a
description that mentions "reviews.json" as review-related, which is
correct in THIS context (a human/Claude-written description naming that
file is a genuine review-purpose signal). Otherwise a Task falls through
to `implement` (with its own second-tier fallback, §3, using
`input.description` as the derived text when present — a Task call
without prose almost always has a `description`, unlike a bare Bash
call).

**Regression tests:** existing fixture `tool("review", "Task", {
description: "Review the change" })` keeps resolving to `review` (already
covered — this is the existing, currently-passing case); a new fixture
`tool("...", "Task", { subagent_type: "general-purpose", description:
"Research the codebase layout" })` must resolve to `implement`, not
`review`; a fixture with `subagent_type: "general-purpose"` and
`description: "Review the change"` must resolve to `review` (proves
`description` is checked even when `subagent_type` itself is not
review-related — External Review catch); a fixture with `description:
"Update the preview panel"` must resolve to `implement`, not `review`
(word-boundary catch).

## 3. Sparse real-content fallback for investigate/implement/review/spec
   (REVISED — see Internal Plan Review note above)

**Problem with the original design:** varying `text` per tool input at
push time defeats `add()`'s coalescing (`previous.text === text`), which
the 900-`Read`-call fixture relies on to collapse into `cards.length <=
6`. Real derived text is only actually useful — and only actually safe —
on a card that ends up representing exactly **one** command; a card that
already coalesced several commands together has no single "real content"
to show, and the existing generic sentence is the correct thing to show
there (unchanged from today).

**Approach:** the initial `add(kind, prose || genericSentence(kind),
label, artifact)` call is UNCHANGED — coalescing keys on the same text as
today, so the 900-call fixture's collapse behavior is byte-identical. A
new `WeakMap<ActivityCard, number>` (`cardEventCounts`) tracks the REAL
number of tool_use events that contributed to each card — incremented by
1 on every `add()` call for that card, whether it creates a new card
(count starts at 1) or coalesces into an existing one (count increments),
independent of `commands.length` (which dedupes by label string and can
under-count when two distinct events produce the same label — External
Review catch). After the full event loop (alongside the other end-of-run
reconciliation passes already in the function, §207 onward), a new
backfill pass walks `cards` once: for any card whose `kind` is one of
`investigate`/`implement`/`review`/`spec`, whose `text` is still exactly
that kind's generic sentence (i.e. no prose ever overrode it), and whose
`cardEventCounts.get(card) === 1` (exactly one real event, never
coalesced), replace `text` with a sentence derived from that one
command's already-computed `label` — reusing `commandLabel()`'s existing
field-priority order (`command` → `file_path` → `description` →
`pattern`) rather than inventing a second one, so no new helper function
is needed at all; only a mapping from `label`'s `"Tool: detail"` chip
shape to a short standalone sentence (e.g. `Read: foo.ts` → `Read
foo.ts.`). A card with no derivable label component (rare — e.g.
`TodoWrite`) keeps the generic sentence, unchanged.

**Regression tests:** the existing 900-`Read` coalescing fixture must
still collapse to `cards.length <= 6` after this change (explicit
regression, not just "still passes" — Internal Plan Review's exact ask);
a SOLO tool-only turn (no prose) with a `Read` input shows the
label-derived sentence, not the generic "existing behaviour was examined"
sentence; a `TodoWrite`-only solo turn (no derivable label component)
still falls back to its existing generic sentence, unchanged; two
DISTINCT tool_use events that happen to produce the SAME label (e.g. two
identical `Read` calls on the same file) keep the generic sentence, not
the label-derived one, even though `commands.length` would read `1`
(External Review catch — proves the fix uses the event-count map, not
`commands.length`); a command containing a token-like argument
(`--token=abc123...`) renders the IDENTICAL redacted text in both the
`commands` chip and the promoted sentence (External Review catch — no new
raw-text exposure path).

## 4. Wrong-identity Delivered card — `run-id-recovery.ts`
   (REVISED — see Internal Plan Review note above)

**Root cause (confirmed against this session's own transcript and
`shipwright_events.jsonl`):** `findRunIdFooter()`'s "LAST marker in the
whole transcript wins" heuristic was validated (per its own docstring)
only against sessions that still carried a *live pointer* — i.e. short,
single-purpose sessions. It was never validated against a long
investigative session that runs `git log` / reads old files *after* its
own commit lands, which is exactly what surfaces an unrelated, older run's
footer later in the same transcript and lets it win.

**Problem with the original design:** scoping the match to "inside a
Bash `git commit` tool_use's own `command` field" requires parsing JSON
structure the function does not currently have (it takes a flat
`transcript: string` and regexes over it directly), and risks a false
negative for the common real case where the commit message text is
authored via a heredoc / narrated assistant text rather than literally
appearing inside the `command` argument's own string.

**Approach (revised, still purely textual — no JSON parsing added):**
Claude Code's JSONL is one complete message object per real line (message
text newlines are already escaped as `\n` *within* the JSON string, never
a literal line break — the file's own existing docstring for
`RUN_ID_FOOTER` already relies on this). A `Run-ID:` footer is only ever
*authored* by the assistant (inside its own `git commit` tool_use); it is
never something a `tool_result` message (git/file/grep OUTPUT being read
back) legitimately carries as original content, and it is likewise never
something a human-typed prompt legitimately carries. So: split the
transcript tail on real `\r?\n` boundaries, drop any line matching
`/"type"\s*:\s*"user"/` — the record type that wraps BOTH `tool_result`
content and genuine human-typed prompts; this filter is deliberately
broader than "only tool_result" (precisely matching that would need
parsing each `"type":"user"` record's own `content` array for a nested
`"type":"tool_result"` entry, the deeper JSON parsing this design commits
to avoiding — External Review catch on the original wording's precision)
— and run the EXISTING `RUN_ID_FOOTER` regex + "last wins" logic only
over the surviving (assistant-authored) lines. **Known limitation,
documented in a code comment at `findRunIdFooter()`:** an assistant CAN,
in principle, narrate/quote an older footer in prose later in the same
transcript (not inside a `git commit` command), and this heuristic would
still treat that as the winning marker if it is the last surviving line —
accepted rather than closed, since closing it fully needs
message-boundary-aware extraction scoped specifically to `git commit`
tool_use bodies (the original, discarded §4 design), which requires the
JSON-structure parsing this design avoids for the reasons stated above
(External Review, disclosed). The caller signature
(`recoverRunIdFromTranscript`) is unchanged; only `findRunIdFooter`'s
internal text preparation gains the per-line filter.

**Why this is compatible with the existing test suite:** every current
`run-id-recovery.test.ts` fixture (`footerLine()` → `{"text":"..."}`, and
the `command`-field variant) is a bare stub with no `"type":"user"`
marker at all, so none of them match the new exclusion and all keep
being scanned exactly as before — the 18/18-corpus regression needs no
rewriting.

**Regression tests (new):** a transcript containing this session's own
assistant-authored `Run-ID: iterate-A` footer followed later by a
`{"type":"user","message":{"content":[{"type":"tool_result",...}]}}`-
shaped line whose content quotes an unrelated `Run-ID: iterate-B` (the
literal shape of the source session that produced the wrong Delivered
card) resolves to `iterate-A`, not `iterate-B`. A companion test confirms
a footer inside assistant narration text (not a `command` field) is still
found — the case the original, now-discarded design would have missed.

## 5. Remove the GOAL header

**Approach:** delete the `<span className="mc-feed-label">Goal</span>` +
`<strong data-testid="mission-feed-goal">...</strong>` pair from
`MissionActivityFeed.tsx`'s `mc-feed-pinned` header, keeping the
`{feed.outcome}` span. Remove `goal` from `ActivityFeed`, the
`explicitGoal` parameter and its computation line from
`deriveActivityFeed()`, and `meaningfulRequest()` (+ its private
`iterateArgs`/`ignored`/`valueFlags` helpers) from
`missionActivityFeedText.ts` if nothing else references them (confirm at
build time — `clean()` stays, it is used elsewhere in the same file).
Update `useMissionLive.ts`'s two call sites to drop the fourth argument,
including the now-unused `task?.description` entry in that hook's
`useMemo` dependency array (Internal Plan Review catch — an easy one to
miss since it's a second, separate line from the call site itself). Also
drop the `.mc-feed-label` CSS rule once the markup that used it is gone
(Internal Plan Review catch), after confirming (grep) nothing else
references that class.

**Removal-safety check (before deleting anything):** repo-wide grep for
`.goal`, `explicitGoal`, and `deriveActivityFeed(` — not just
`.mc-feed-label` — followed by `tsc --noEmit` to catch any stale
`ActivityFeed` object literal the grep missed (External Review catch).

**Regression tests:** existing `.goal`-asserting tests in
`missionActivityFeed.test.ts` are removed/updated; a DOM test asserts
`data-testid="mission-feed-goal"` no longer renders while `feed.outcome`
still does.

## Component/file map
- `client/src/lib/missionActivityFeed.ts` — §1, §2, §3, §5 (reducer)
- `client/src/lib/missionActivityFeedText.ts` — §3 new helper, §5 removed
  helper
- `client/src/components/external/mission/MissionActivityFeed.tsx` — §5
  (header markup)
- `client/src/hooks/useMissionLive.ts` — §5 (call-site update)
- `server/src/core/mission-context/run-id-recovery.ts` — §4
- No new files expected.
