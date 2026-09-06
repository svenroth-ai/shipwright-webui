# Architecture brief: cross-lead audit timeline

Should this be built at all, in this shape?

**Problem:** PO cannot see "what did one or more AI leads do overnight"
without opening a raw-JSON modal per lead and merging timelines by eye.

**Proposed shape:** a new server-side GET endpoint that reads each relevant
lead's existing per-lead `audit.jsonl` (via the existing bounded/paginated
`auditLogCore`, never a new raw reader), performs a k-way merge across those
per-lead newest-first streams sorted by entry timestamp, and returns one
merged page plus one opaque composite cursor (a JSON blob of per-lead
consumed-counts, base64-encoded) so the client can page backward in time
correctly. A new client modal renders each row as time + lead + a
plain-language event word (mapped from leadwright's own closed `AuditKind`
vocabulary) + one-line summary, with filters (lead, event type, time window
incl. a "last night" preset) and click-to-expand raw JSON. Purely additive,
read-only, no new write path, no change to what leadwright writes.

**Alternative rejected:** doing the merge in the browser by calling the
existing per-lead endpoint N times and merging client-side. Rejected because
the pagination trap (`before` is a physical position count, not a
timestamp) applies identically in the client, so this would just relocate
the same non-trivial k-way-merge-with-per-stream-cursor logic into the
browser with no benefit, and duplicate it if a second caller ever needs the
same merged view.

**Scale:** these are per-run daemon logs for a small number of AI leads
(today: single digits), each JSONL line one beat/tool/decision event — not
a high-volume telemetry stream. A page-sized (≤200 per lead) fetch per
request is proportionate.

Question for review: is a new server endpoint + opaque composite cursor the
right level of complexity for this, or is there a simpler shape that still
avoids the pagination trap?
