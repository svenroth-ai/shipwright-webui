# Lead Inventory page: per-lead authority ladder + unclaimed-effect warning

**Run-ID:** iterate-2026-09-08-lead-inventory-page
**Spec:** `.shipwright/planning/iterate/2026-09-08-lead-inventory-page.md`
**FR:** FR-01.71(G)

## Context

The Org page (FR-01.71) gives the PO a chart, shared docs, and one card
per lead — but nothing shows the PO *what an AI lead actually did last
night*, ordered by the authority band each step was taken under, next to
the lead's own declared authority ladder, or whether any of those beats
left an effect nobody claimed responsibility for. Roadmap item 2.10.

## Decision

Add a new viewer-only `/org/inventory` route (`LeadInventoryPage`),
served by a new roster-wide composite endpoint `GET /api/org/inventory`
(one `org-chart.json` parse for every lead, mirroring the existing
`org-threads-composite.ts` pattern — never N+1). Per lead it renders:
last night's beats (48h server-side window, ordered by `startedAt`) with
their authority-band step log as `BandChip`s in file order; the lead's
declared authority ladder as per-band prose read from its own
`charter.md` (never a "may act alone" binary — see Rejected below); open
"needs you" questions with exactly one non-interactive answer field and
no thread/round affordance; and a visible, DOM-assertable warning on any
beat whose effect a single-pass `audit.jsonl` scan found unclaimed. No
org-chart editing, no new leadwright API, no budget work, no terminal
button (that slot belongs to card W15 and is omitted, not stubbed).

## Consequences

A genuine read failure for a lead's beat register, its steps, or its
audit log degrades that one figure alone (tri-state
`ok`/`unreadable`/`unknown`) rather than a false-positive empty/clear
state or a whole-lead/whole-roster failure. The audit-log scan is a
synchronous, unbounded full-file read once per lead per request — an
accepted tradeoff at this iterate's scale (a single operator's roster,
polled every 5 minutes), documented as a known limitation with a
size-ceiling degrade named as the natural follow-up if it ever grows
large. The charter read still hardcodes the default `charter.md` path,
matching an existing, disclosed limitation in `buildRole` — not a new
gap this iterate introduces.

## Rationale

Mirrors the existing composite-endpoint and open-first-file-read
patterns already established in this codebase (`org-threads-composite.ts`,
`audit-log.ts`) rather than inventing new ones, so the new readers inherit
their TOCTOU-safety and degrade discipline by construction.

## Rejected

- **Declared/missing authority binary** (Internal Plan Review HIGH):
  `validateCharterBands` already disclaims the "may act alone" reading and
  `beat-start` denies any beat missing a band, so declared/missing would
  always read 4/4 for any lead with beats — rejected in favor of per-band
  charter prose plus an "N/4 declared" completeness line.
- **A second, server-merged "needs you" endpoint**: rejected as a
  duplicate of FR-01.71(D)'s existing thread view; this page reuses the
  same round-store read and its `isAnswered` predicate inverted, cross-
  linking rather than re-implementing.
- **Bounded pagination for the audit scan** (superseded mid-build by
  Stage-2 code review): replaced with one full-file scan, removing the
  truncation-avoidance axis entirely rather than tuning its page cap.
- **Either/or E2E isolation guard** (env flag OR path containment):
  rejected after doubt review found it a real bypass for a developer
  shell already exporting the override var; the sibling guard's AND
  semantics were matched exactly instead.

## Review disposition

Internal Plan Review: 10 fixed, 1 disclosed, 0 declined. External Plan
Review (glm+openai): all findings fixed. Stage-2 code review, doubt
review, and external code review (glm+openai): all findings fixed or
explicitly disclosed — one external-review suggestion (rescoping the
`unclaimed-effect-warning` testid) was evaluated and NOT applied because
the literal id is pinned verbatim by this iterate's own AC-2a acceptance
criterion and asserted by two existing tests; recorded as an accepted,
disclosed limitation rather than silently dropped or blindly applied
against the spec.
