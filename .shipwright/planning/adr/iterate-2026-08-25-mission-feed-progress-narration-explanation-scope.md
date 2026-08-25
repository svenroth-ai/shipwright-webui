# Mission feed: restore a turn's own words, drop the narration toggle

## Context

The Mission Activity Feed already reduces each Claude turn to a one-line
headline (`deriveActivityFeed()`, `missionActivityFeed.ts`) and silently
discards everything the turn wrote beyond that first line. The original
request for this iterate was a **narration** feature: have Claude narrate
its own progress into Mission via an appended system prompt, gated behind a
global Settings toggle (default OFF, token-cost concern).

Mid-planning the operator raised a much bigger concern: Mission was meant
to *replace* the Terminal as the operator's day-to-day view, but currently
shows almost none of what Claude actually wrote — "the ideas was ja, dass
wir das transcript ersetzen" (the idea was that we'd replace the
transcript). A narration toggle, opt-in and off by default, would not fix
that; the content operators are missing is already sitting unused in every
session's JSONL.

## Decision

Two rounds of external Architecture Review (`--mode architecture`, openai +
deepseek) converged on dropping the narration-toggle mechanism entirely and
building content restoration only: an `investigate`/`spec`/`implement`/
`review` card built from exactly one assistant turn gets a new
`card.explanation` field — a bounded, sanitized excerpt of that turn's own
words beyond its headline, rendered as plain text directly under the
existing headline. No Settings field, no launch-command change, no CLI
flag, no server-side change, and no new session data: this is a pure,
client-side re-derivation of text that was already being parsed and
discarded.

The operator confirmed this scope explicitly, with one hard constraint:
"stell sicher, dass wir dann auch keine settings und so bauen" (make sure
we don't build any settings machinery for this) and "ist das look and feel
noch gleich?" (is the look and feel still the same?). AC-5 makes that
second question a testable requirement, not a promise: a component test
asserts the full card markup is byte-identical to today when `explanation`
is unset, and that adding it changes nothing except the one new sibling
node.

## Why not the narration toggle (rejected alternative)

Round 1 of Architecture Review split (openai=reject, deepseek=revise) on
the original marker-based narration design. Round 2, re-run against an
options brief (A: both mechanisms, B: explanation only, C: toggle only, D:
do nothing), converged: both reviewers rated content-restoration higher
value at lower risk than a second LLM-narrated system-prompt mechanism, and
flagged the toggle as solving a problem restoration would likely make moot.
Building both was rejected as scope inflation for one iterate. The toggle
remains available as a future, separately-scoped iterate if restoration
alone turns out not to be enough once shipped — an existing escape hatch
(a custom action's `--append-system-prompt`, FR-01.37) already covers the
"Claude narrates its own progress" idea without any new webui machinery, so
that path is not even blocked on a future iterate.

## Correctness design (why this needed two Internal Plan Review passes)

The first-draft design counted "how many tool-use events built this card"
(`cardEventCounts === 1`) as the misattribution guard. Internal Plan Review
found this wrong: the correct invariant is "how many assistant TURNS
contributed to this card" — one turn issuing several tool calls that
coalesce into a single card is the common, valuable case and must KEEP its
explanation; only a card built by two or more DIFFERENT turns must have it
cleared. A second, independent `cardTurnCounts` map was added; the clearing
pass runs as its own unconditional loop (folding it into the existing
GENERIC_TEXT sweep would make it a permanent no-op, since a card with
`explanation` always has real prose and that sweep skips exactly those
cards). A card mutated to `kind: "blocker"` clears `explanation` explicitly
at the mutation site, since the recovery path's second command-label push
does not touch either counter.

External code review (`--mode code`, openai) later found a residual gap in
this same design: `cardTurnCounts` was incremented only for the first,
explanation-receiving card of a turn — a turn's *second* card was never
counted at all, so a later turn coalescing only into that second card could
under-count it back down to 1 and let its explanation wrongly survive.
Fixed by separating "which card gets counted" (every distinct card the
turn touches, via a per-turn `Set`) from "which card gets the explanation
text" (still at most one, the first) — two independent guards instead of
one shared gate. A regression test reproduces the exact scenario and is
confirmed to fail against the pre-fix code.

## Consequences

Mission now shows a turn's real reasoning wherever a card was built from
exactly one turn's words — the common case for `investigate`/`implement`
work — without any settings surface, launch-path change, or new session
data to maintain. The operator still has to open the Terminal for the
turns whose explanation was cleared (multi-turn coalesced cards) or for a
tool-only turn that wrote no prose at all; full narration parity with the
Terminal remains open, deliberately, as the toggle idea this iterate did
not build.

One pre-existing, unrelated bug was found by adversarial doubt-review
during this iterate and filed as its own follow-up rather than fixed here:
a stale `unresolvedBlockers` commandKey (no expiry, no scoping to the
originating card) can, on a since-generalized command-string collision,
splice a legitimately-coalesced later card out of the feed entirely — see
triage card `trg-27f83477` (FR-01.66, severity high). This predates
`card.explanation` and is not introduced by it; fixing it is a separately-
scoped change to the recovery mechanism's own matching logic.
