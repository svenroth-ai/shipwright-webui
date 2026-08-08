# Architecture Brief: triage-filters-sort-parked

## The problem
The Triage tab is a single flat list of open items, sub-grouped by the
producing run/tool ("source"), with a separate read-only "Deferred"
section for parked items. At roughly 28 open items in one deployment and
8 in another, the operator can no longer scan it to find what to act on
next, and has no way to set aside items they've decided not to do right
now without permanently dismissing them or losing track of them.

## What already exists here
- A single GET endpoint (`/api/triage/:projectId`) that returns all
  items (open + parked) unfiltered, polled client-side every 30s.
- A client-side "Deferred" section (added in a prior iterate) that
  already separates parked items from open ones and already computes a
  due / not-due / dateless distinction server-side.
- No existing client-side filter, sort, or view-preference mechanism
  anywhere in this app (no other list view has one) to reuse.

## What would newly, permanently exist
Client-side (React) filter and sort controls over the existing triage
list: three filter dimensions (priority, domain, an as-yet-unpopulated
complexity field), a two-level sort, and a fourth independent filter for
parked/deferred items with two exceptions (a returned park bypasses
attribute filters; a dateless park bypasses the parked-default-hidden
state). No new server endpoint, no new persisted state, no new
credential, and no new scheduled job — the mechanism is in-memory view
state recomputed from data the app already fetches.

## Options on the table
- **A:** Build the full filter/sort/parked-filter surface as specified
  (priority + domain + complexity filters, two-level sort, standalone
  parked filter with due/dateless exceptions).
- **B:** Build only priority + domain filters and a single-key sort now;
  defer the complexity filter and the parked-filter redesign to a later,
  separate change.
- **C:** Do nothing client-side; instead reduce the item count at the
  source (e.g. auto-archive old dismissed items, or split Triage into
  per-domain pages/routes) rather than adding filter UI.

## Constraints that are not negotiable
No change to what `.shipwright/triage.jsonl` or the outbox buffer
records, and no change to the server-side `TriageItem` contract or the
Python producer side. The parked/deferred due/dateless computation is
already owned server-side and must not be recomputed client-side.
