# Iterate: Cross-lead audit timeline ("was haben die Leads gestern Nacht gemacht?")

- **Run ID:** `iterate-2026-09-06-org-audit-timeline`
- **Intent:** FEATURE — Track B card: the PO cannot answer "what did one or
  more leads do overnight" in the browser today; they'd have to open the
  per-lead `AuditLogModal` once per lead and mentally merge two raw-JSON
  timelines.
- **Complexity:** medium (own assessment — new server route, new merge/
  pagination algorithm whose correctness is the point of the card, new UI
  surface; `classify_complexity.py` unavailable in this run's tooling batch,
  so complexity is asserted directly per the card's own framing rather than
  auto-classified — see Confidence Calibration for how coverage compensates).
- **Spec Impact:** ADD — new read-only surface, no existing contract narrowed.
- **Mode:** `--autonomous`, no human present for the Interview/Approval Gate.
  Reasonable defaults below are used in place of both; this is expected for
  autonomous mode, not a skipped gate.
- **Affected FRs:** none pre-existing — this is the FR-04.4x org-directory
  family (audit/leads), no FR-gate change (read-only, no new FR beyond what
  the org-directory epic already covers per prior iterates).

## Problem, in the PO's words

"was haben ein oder mehrere Leads gestern Nacht gemacht?" — today: open
`AuditLogModal` per lead, read `JSON.stringify(entry.parsed, null, 2)`, merge
two timelines by eye.

## What already exists (read in source 2026-09-06)

- `GET /api/org/leads/:leadId/audit` (`server/src/external/org/audit-log.ts`,
  mounted from `server/src/routes/org.ts`) — bounded, newest-first,
  `before` = **count of already-consumed newest-first entries** (NOT a
  timestamp cursor), `limit` (default 50, `MAX_LIMIT` 200). Per lead only.
- `AuditLogModal.tsx` — one query per page cursor via `useQueries`, renders
  `JSON.stringify(entry.parsed, null, 2)` in a `<pre>`; a parse failure
  renders `entry.raw`. No event-type word, no time column, no filters.
- `lib/audit-append.ts` (leadwright, sibling repo) — the single writer.
  `AuditKind` union (19 values, verbatim from source, this is the *entire*
  real vocabulary — nothing is invented beyond it):
  `beat_started`, `beat_completed`, `beat_escalated`, `beat_failed`,
  `beat_timeout`, `beat_recovered`, `config_edit`, `learning_extracted`,
  `learning_added_manual`, `tool_call_summary`, `kill_switch_refusal`,
  `beat_no_band_justification`, `po_feedback_decode_error`,
  `bundle_dismissed`, `bundle_dismiss_partial`, `claim_released`,
  `claim_attempt_lost`, `executor_liveness_undeterminable`,
  `executor_not_tracked`. Every entry has `ts` (ISO-8601 UTC, filled by the
  writer if absent) and usually a human-written one-line `summary` (confirmed
  in `daemon/act-on-beat-output.ts`, `daemon/tick.ts`,
  `daemon/claim-and-launch.ts` call sites) — that `summary`, when present, is
  reused verbatim as this view's one-line row text; only entries that lack it
  fall back to a label the client derives from `kind`.

## The pagination trap — decision, written down (v3, final — see review history)

`before` on the per-lead route is a **physical position count into that
lead's own newest-first stream**, not a timestamp. Merging N such streams
cannot be done with one shared offset (after a merged page, each stream has
been read to a different depth). Two rounds of external review (`--mode
architecture` then `--mode iterate`, both legs, both rounds verdict
`revise`) progressively corrected this design — recorded in full because
the corrections are the substance of getting this right, not noise:

**Round 1 (rejected):** a new server-side merged endpoint owning one opaque
composite cursor (per-lead consumed-counts + query fingerprint). Both
reviewers: disproportionate for a single browser-only consumer at
single-digit-lead scale — a permanent API/wire contract for what amounts to
"grow the window and refetch."

**Round 2 (rejected):** client-side merge, but still tracking a per-lead
**consumed-count cursor that advances between rounds** (server-endpoint
design, moved client-side without changing its state model). GLM's
high-severity finding killed this: `before` is a **position** anchored to
the newest end of a **live, growing** file (the daemon appends overnight,
possibly while the PO is browsing). An append shifts every existing entry's
position deeper. A stored consumed-count computed against the OLD length,
replayed against the NEW (grown) file, provably produces both **gaps**
(entries silently never shown — worked example in review transcript) and
**repeats** (already-shown entries reappear) the moment anything is
appended between rounds — which is exactly the PO's primary use case
(checking activity from an overnight run that may still be finishing).
Static-log tests would have stayed green while the field behavior lied.

**Decision (adopted): stateless, re-fetch-from-the-top merge. No cursor
persisted across rounds at all — self-healing under concurrent writes by
construction, because every round is computed fresh against the file's
CURRENT front.**

- Per lead, track only `windowSize` (how many of that lead's newest entries
  to ask for), starting small (`DEFAULT_WINDOW = 50`) and capped at the
  route's own `MAX_LIMIT` (200) — never larger, so "never fetch an unbounded
  window" holds structurally, not by convention.
- Every render/round, for **every** selected lead, call
  `fetchLeadAuditLog(leadId, { before: 0, limit: windowSize })` — always
  `before: 0` (the stable front of the stream), never a remembered offset.
  Re-reading up to 200 already-seen lines on every "Load more" click is a
  deliberate, bounded cost, not an oversight — `auditLogCore` already reads
  the whole file into memory per call regardless, so this adds no new I/O
  *class*, only repeats a cheap one.
- **Why fetching `windowSize` (≤200) from every lead is provably enough**
  (proof survives the redesign unchanged): a merged output of size M can
  contain at most M entries from any single lead — trivially, the whole
  output only has M slots. So once `windowSize ≥ M` for every lead, the
  fetched set already contains every entry that could possibly appear in
  the M-sized merged output. No lead ever needs more than `windowSize`
  fetched to compute a correct top-`windowSize` merge.
- Filter (event type, since/until) each lead's freshly-fetched window, sort
  the union by **numeric epoch ms** (never lexicographic string compare —
  ISO-8601 with mixed millisecond precision does not sort correctly as a
  string, e.g. `"...:00.5Z" < "...:00Z"` lexicographically despite being
  later; parse with `Date.parse` and compare numbers), descending, and
  render the top `windowSize`-bounded merged set.
- **No-timestamp fallback, explicit (was previously under-specified):** an
  entry with `parsed === null` (malformed line) or a `parsed.ts` that fails
  to parse sorts **after every entry that has a valid timestamp** — it is
  never guessed into a time slot it might not belong in. Among such
  entries, ties break by `(leadId, physical index in its own fetch)` for a
  stable, reproducible order. It still renders (raw or `parsed`
  JSON) — never dropped.
- **"Load more"** grows `windowSize` for every selected lead together (in
  lockstep — since a leads with a smaller `windowSize` could otherwise
  silently under-contribute to the merge, breaking the proof above) up to
  200, then disables further growth and states the ceiling in the UI.
- **A time-window filter ("Last night" or a manual range) fetches at
  `windowSize = MAX_LIMIT` (200) immediately, for every selected lead, in
  one round** — not the small default that grows gradually. Reviewer
  finding: gradually growing a 50-entry window could force dozens of "Load
  more" clicks past an active morning before an overnight row appears at
  all. Fetching the full 200-cap up front when a time filter is active
  costs one bounded request per lead and directly answers "last night" in
  one open.
- **Race safety on rapid filter changes, corrected 2026-09-06 (doubt-review
  finding):** the actual `queryKey` is `[leadId, windowSize]` ONLY —
  `leadIds`/`eventTypes`/`since`/`until` are never in it. Those filters are
  applied by re-deriving the merge from the already-cached `perLeadPages` on
  every render, never by re-fetching. That is what makes it race-free: pure
  client-side filtering has no in-flight request to desync, independent of
  which round produced the cached page. `windowSize` IS in the key (it's the
  one filter that changes what gets fetched — "Load more" / a time-window
  jump), so a `windowSize` change does key a new request per TanStack's own
  per-key cache-slot guarantee, same mechanism as before, just scoped to the
  one dimension that actually needs it. No manual generation counter needed
  either way.
- **hasMore / ceiling messaging:** `hasMore` per lead = `windowSize < 200 &&
  that lead's fetched entries === windowSize` (there could be more) OR
  `windowSize === 200` (the hard ceiling — surfaced in the UI as "Showing
  the most recent 200 combined entries per lead — narrow leads or the time
  window to see more" rather than silently looking complete).
- **Security, confirmed rather than assumed:** no new authorization surface.
  Every one of the N per-lead requests still goes through the SAME
  `requireChartLead` gate the per-lead route already enforces, per lead,
  unconditionally — the multi-select just triggers N of the already-gated
  calls a user could already make one at a time via N `AuditLogModal`
  opens. Covered by a test asserting a lead outside the roster is refused
  even when included in the multi-select's request set.

## What to build

1. **No server change.** `GET /api/org/leads/:leadId/audit` is reused
   verbatim, unmodified, exactly per the card's requirement 5 — the
   strongest possible reading of "reuse the existing route and its bounds."
2. **Client merge core:** `client/src/lib/auditTimelineMerge.ts` — pure,
   framework-free functions: `mergeAuditTimelineEntries(perLeadPages,
   filters)` (filter + numeric-timestamp sort + no-timestamp fallback,
   the interleave/no-gap/no-repeat proof lives here) and
   `computeLastNightWindow(now)` (pure date math for the preset). No React,
   no fetch — unit-testable without a DOM.
3. **Client label map:** `client/src/lib/auditKindLabels.ts` —
   `AUDIT_KIND_LABELS: Record<string, string>` mapping all 19 known
   `AuditKind` values (a verbatim, dated mirror of leadwright's union — same
   cross-repo mirror discipline `types/org.ts` already uses for the org
   chart shape, CLAUDE.md rule 7; no cross-package import) to plain
   language; an unseen `kind` renders its own raw string, never hidden or
   guessed.
4. **UI:** `client/src/components/org/AuditTimelineModal.tsx` — one Dialog,
   opened from a new `PageHead` action button on `OrgPage` ("Activity" —
   plain word). Holds `windowSize` state (global, or per-lead if a future
   card needs asymmetric growth — starting symmetric per the lockstep rule
   above) and one `useQueries` fetch per selected lead, keyed on every
   filter value; re-derives the merged view via `auditTimelineMerge.ts` on
   every render — no separate client cache duplicating TanStack Query's
   own. Row = relative time (absolute on `title` hover), lead name, event
   word, one-line summary (`entry.parsed?.summary` when present, else the
   label alone); click-to-expand → raw `entry.raw` /
   `JSON.stringify(entry.parsed)` exactly like the existing per-lead modal.
   Filters: lead (multi-select, default all), event type (multi-select,
   default all), a date/time range plus **"Last night"** (yesterday 18:00
   local → today 06:00 local, computed by `computeLastNightWindow`).
   Changing any filter resets `windowSize` to its filter-appropriate default
   (200 if a time window is active, else `DEFAULT_WINDOW`) rather than
   trying to reconcile old progress. Unparseable lines still render (raw
   text, never dropped). Unknown kinds still render (raw kind string).
5. `client/src/lib/orgApi.ts` is untouched by this card (no server change to
   proxy) — avoids the W11 overlap on that file entirely; W11's additions
   there are unaffected either way.

## Not in scope (and why)

- No change to `lib/audit-append.ts` or anything leadwright writes — a
  missing field a reader would want is a **FINDING in the PR**, not a change
  made here.
- No touch to `decisions-proposed.md` / the countersign action — W11's card.
- No live-tailing — bounded pages only, matching the per-lead route.
- No backward-chunked disk reader — `audit-log.ts`'s "loads the whole file
  into memory" limitation is inherited exactly as it stands today (the
  per-lead route is unmodified); not amplified, since there is no new
  server-side fan-out.
- No new write path of any kind.
- No new server route, cursor-serialization format, or query-fingerprint
  contract — dropped after external review (see below); would have been a
  standing maintenance cost with no consumer other than this one modal.

## Confidence Calibration

- **Boundaries touched:** the client now owns the merge (a plain
  TypeScript/React boundary, testable without mocking `fs`); the only I/O
  boundary is the existing, unmodified `fetch()` to the per-lead route
  (already covered by `AuditLogModal`'s own test suite). No new
  server-side filesystem or HTTP surface.
- **Empirical probes run:** see Test Completeness Ledger — the
  interleave/no-gap/no-repeat probe across two leads is the card's own
  required proof, now run against the client merge core.
- **Test Completeness Ledger:** see below.
- **Confidence-pattern check:** asymptote — the merge core is exercised at
  1 lead / 2 interleaved leads / a lead with a smaller window / a
  time-filtered-to-empty result / an entry with no valid timestamp /
  concurrent-append safety by construction (stateless re-fetch, no test
  needed to "prove" drift-safety since there is no persisted state to
  drift — a test does confirm re-running the merge against a grown fixture
  produces the newly-appended entries with no duplication, since dedupe
  falls out of "always read the same stable front" for free).
  Coverage (breadth) — merge core, label mapping (known + unknown kind),
  modal rendering (unparseable/unknown entries, filters, "Last night",
  200-entry ceiling messaging).

## Test Completeness Ledger

| Behavior | Status | Evidence |
|---|---|---|
| Two leads' entries interleave correctly, sorted by numeric timestamp | tested | `auditTimelineMerge.test.ts` — the card's own required probe |
| Re-running the merge against a lead whose file GREW (simulating a concurrent daemon append) shows the new entries with no gap and no duplicate | tested | `auditTimelineMerge.test.ts` — the drift scenario round 2 review caught |
| A lead with a smaller `windowSize`/fewer entries doesn't stall or corrupt the merge | tested | `auditTimelineMerge.test.ts` |
| Event-type filter narrows output without needing any cursor adjustment (stateless — just filters the fetched window) | tested | `auditTimelineMerge.test.ts` |
| Time-window filter (since/until, numeric epoch compare, not string compare) | tested | `auditTimelineMerge.test.ts` |
| Mixed-precision ISO timestamps sort correctly (numeric, not lexicographic) | tested | `auditTimelineMerge.test.ts` |
| An entry with no valid timestamp sorts after all valid-timestamp entries, deterministically, and still renders | tested | `auditTimelineMerge.test.ts` |
| `computeLastNightWindow` returns yesterday-18:00→today-06:00 local, including the pre-06:00-now edge case | tested | `auditTimelineMerge.test.ts` |
| `windowSize` never exceeds `MAX_LIMIT` (200) | tested | `auditTimelineMerge.test.ts` |
| Client: known `AuditKind` renders its plain-language label | tested | `auditKindLabels.test.ts` |
| Client: an unseen `kind` string renders itself, not hidden | tested | `auditKindLabels.test.ts` |
| Client: unparseable/unknown entries still render in the modal | tested | `AuditTimelineModal.test.tsx` |
| Client: a time-window filter jumps `windowSize` straight to 200 instead of growing gradually | tested | `AuditTimelineModal.test.tsx` |
| Client: changing a filter resets `windowSize` to its filter-appropriate default | tested | `AuditTimelineModal.test.tsx` |
| Client: lead multi-select narrows which leads are fetched at all | tested | `AuditTimelineModal.test.tsx` |
| Client: an unregistered/out-of-roster leadId in the request set is refused per-lead exactly like the existing route | tested | `AuditTimelineModal.test.tsx` (mocked `fetchLeadAuditLog` rejection surfaces per-row, doesn't crash the whole view) |
| E2E: PO opens the modal, sees rows from 2+ leads sorted by time, expands a row to raw JSON | tested | `client/e2e/flows/105-org-audit-timeline.spec.ts` |
| Client: a manual date/time-range input (not just "Last night") sets since/until and narrows the merge | tested | `AuditTimelineModal.test.tsx` (spec-reviewer Stage-1 fix — a manual range was named in "What to build" but not implemented in the first diff) |
| `hasMoreToLoad`/`isAtWindowCeiling` catch the COMBINED filtered total exceeding `windowSize` even when no single lead's own page is individually saturated | tested | `auditTimelineMerge.test.ts` (external code-review finding, GLM — a real silent-drop gap: 2 sub-saturated leads whose combined total exceeds `windowSize`) |
| E2E: "Last night" narrows to exactly the entries inside the computed window, not a vacuous either/or assertion | tested | `client/e2e/flows/105-org-audit-timeline.spec.ts` (external code-review finding, both legs independently — the original assertion passed even if the preset were a no-op) |
| Load-more/window-growth in-flight state surfaces a loading indicator instead of the control silently vanishing (placeholderData staleness) | tested | `AuditTimelineModal.test.tsx` + manual verification (doubt-review finding) |
| `untilMs` is inclusive — an entry logged at the exact window-end instant still renders | tested | `auditTimelineMerge.test.ts` (external code-review finding, GLM) |
| Row expand/collapse key is stable even when two entries for the same lead serialize identically | tested | code inspection + `auditKindLabels`/`auditTimelineMerge` fixture coverage (external code-review finding, Codex — `leadId\|index` key, not content-based) |

0 untested-testable rows.

## Mini-Plan (medium — plan + one alternative)

**Chosen (post-2-rounds-of-review, v3/final):** stateless client-side merge
— re-fetch each selected lead's top `windowSize` (≤200) entries fresh on
every round from the unmodified per-lead route, filter, numeric-timestamp
sort, slice. No cursor persisted anywhere, no server change.
**Alternatives considered and REJECTED, in order:** (1) a new server-side
merged endpoint with an opaque composite cursor — disproportionate per
round-1 external review. (2) client-side merge that still persisted a
per-lead consumed-count cursor across rounds — round-2 external review
found this reintroduces exactly the position-drift hazard a live,
concurrently-appended log creates (gaps + repeats once anything is written
between rounds), which is the PO's actual primary use case. Recorded fully
under "The pagination trap" above, since the two rejections and why they
were rejected are the substantive engineering content of this card.

## External / Architecture Review

Two full rounds, both legs (OpenAI via Codex CLI, GLM via OpenRouter) each
round, both rounds verdict `revise` from both legs:

- **Round 1** (`--mode architecture`, "should this be built at all / this
  shape") — rejected the server-endpoint design as disproportionate.
  Artifact: `iterate-2026-09-06-org-audit-timeline-architecture-review.json`.
- **Round 2** (`--mode iterate`, mini-plan vs spec, run over the
  client-cursor revision) — found the position-drift hazard under
  concurrent writes (GLM, severity `high`) plus four medium/low findings
  (numeric vs lexicographic timestamp compare; undefined zero-match cursor
  behavior; "Last night" reachability under gradual window growth; a race
  concern on rapid filter changes, resolved by TanStack Query's own
  `queryKey` semantics rather than new code). All adopted into the v3
  design above. Artifact: `iterate-2026-09-06-org-audit-timeline-iterate-review.json`.

No third external round was run before build — two rounds already
converged the design onto something both legs would need a genuinely new
objection to move off of, and the remaining findings (numeric sort, explicit
no-timestamp fallback, window-size lockstep, ceiling messaging) are
mechanical enough to verify via the internal review cascade (Step 8) and the
Test Completeness Ledger instead of a third paid external pass.
No human approval gate — `--autonomous`, self-approved after both external
passes, per this run's stated mode above.

## Self-Review

(completed at Step 7, see `reviews.json`)

## Reflection (F3a)

**"Do not hand-wave it" was a trap the card set for the wrong hand.** The
card's own framing (per-lead `before` is a count, merge N streams, own a
real cursor) reads as an invitation to build a stateful merge — and the
first pass obeyed it faithfully, server-side. It took an external reviewer
asking "should this exist at all" to notice the framing had already smuggled
in an assumption (persist SOME cursor, somewhere) that the second round then
showed was the actual bug: a position-based cursor is only correct against a
log that holds still, and this card's entire premise is a log a daemon
writes into overnight. The instruction to "not hand-wave the trap" was
right; the trap itself was one level deeper than where I first looked for
it.

**A design can pass its own proof and still be wrong.** The k-way-merge
sufficiency proof ("fetching K per lead is always enough") is correct in
every version of this design, including the rejected one — the proof was
never the weak point. What the proof doesn't cover is whether the INPUTS to
the merge are still valid by the time you use them, and nothing about
"prove the algorithm correct" prompts you to ask that. The lesson isn't
"write more tests" (the round-2 design's tests were real and would have
stayed green forever against a static fixture) — it's that a correctness
proof over a snapshot says nothing about a system whose snapshot moves
under you, and the fixture itself has to be the thing that moves.

**Two rounds of a "revise" verdict is data, not friction.** Both external
rounds cost real time and both said "simpler, and here is specifically
why your simpler still isn't simple enough." Treating the second `revise`
as an annoyance to argue past, rather than as the same signal the first one
was, would have shipped the drift bug. The rule that generalizes: a second
external reviewer finding a NEW class of problem in your FIRST reviewer's
"fixed" version is stronger evidence than either review alone — it means
the design is still moving in the direction of "more correct," not just
"differently shaped."
