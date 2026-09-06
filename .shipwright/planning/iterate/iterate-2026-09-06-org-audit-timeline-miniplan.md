# Mini-plan: cross-lead audit timeline (revised, client-only)

**Chosen approach:** No server change. `AuditTimelineModal` (new component)
fetches each selected lead's audit log via the existing, unmodified
`fetchLeadAuditLog(leadId, {before, limit})`, holding one cursor-array per
lead (generalizing `AuditLogModal`'s existing single-lead pattern). A new
pure module `client/src/lib/auditTimelineMerge.ts` performs the k-way merge:

- Fetch up to `limit` (K) entries from every selected lead per "round" —
  provably sufficient because a K-sized output page can contain at most K
  entries from any one lead.
- Sort the union of all fetched-and-filter-matching entries by effective
  timestamp (parsed `ts`, ISO-8601 — lexicographic compare is valid; an
  unparseable entry inherits the nearest valid neighboring timestamp within
  its own lead's batch, documented as a stated approximation) descending;
  take the first K as this round's output.
- Per lead, advance that lead's own cursor state past every entry up to (but
  not including) the first matching-but-unemitted entry — held back for the
  next round, never dropped, never repeated.
- `hasMore` = true iff any lead has a held-back entry or its own last fetch
  still had a `nextCursor`.
- Changing any filter (lead selection, event type, time window) resets all
  per-lead cursor state and re-runs round 1 fresh — no attempt to reconcile
  old progress against a new query.

**Alternative (the original, rejected) approach:** a new server-side merged
endpoint (`GET /api/org/audit-timeline`) owning one opaque, base64-encoded
composite cursor (per-lead consumed counts + a query fingerprint), calling
`auditLogCore` server-side per candidate lead. Same merge algorithm, just
on the other side of the network boundary. Rejected per external
architecture review (`--mode architecture`, both legs verdict `revise`):
disproportionate for a single browser-only consumer at single-digit-lead
scale — a permanent API surface and wire-format contract for what is,
underneath, "grow the window and refetch." The client approach is provably
just as correct (same k-way-merge proof, independent of which process runs
it) and has zero standing API-compatibility obligation.

**Event vocabulary (client-only concern now, no server round-trip):**
`AUDIT_KIND_LABELS` in `client/src/lib/auditKindLabels.ts` maps all 19
`AuditKind` values from `leadwright/lib/audit-append.ts` to plain language;
an unseen `kind` string renders itself.

**UI:** one Dialog (`AuditTimelineModal`), opened from a new "Activity"
button in `OrgPage`'s `PageHead` actions slot. Filters: lead multi-select,
event-type multi-select, time window + "Last night" preset. Row = time +
lead + event word + one-line summary; expands to raw entry.
