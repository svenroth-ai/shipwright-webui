# Decisions-proposed.md countersign — browser surface

## Context

`decisions-proposed.md` (AI leads' pending decision proposals) was only
readable/writable via the secret-gated `/api/external/org/*` API and the
terminal — the PO had no way to see or countersign a waiting proposal from
the browser Command Center.

## Decision

Add a fifth `OrgSharedDocs` tile for `decisions-proposed.md`, parsed
client-side into its header-delimited entries (never dumped raw), each with
a Countersign button. The button calls a **new plain route**,
`POST /api/org/decisions/countersign`, which shares the exact same
`performCountersign` / `handleCountersignRequest` core the existing
secret-gated `/api/external/org/decisions/countersign` route uses — "one
core, two mounts", the same pattern already established by
`beat-register-release-core.ts` / `-request.ts`. The secret itself is never
sent to the browser.

## Consequences

The PO can see every waiting proposal and countersign one without a
terminal or the shared secret. The countersign action has exactly one
implementation, proven shared by a cross-mount test
(`org-decisions-countersign.test.ts`) that countersigns via the plain route
and observes the result as `alreadyCountersigned: true` via the gated route.
The existing charter `PUT`'s 403 refusal of `decision_log.md` /
`decisions-proposed.md` is pinned by a new regression test and is otherwise
unchanged — countersign remains the only write this iterate adds for either
file.

## Rationale

Mirroring the beat-register/release precedent exactly (rather than
inventing a parallel validation/status-mapping path) is what makes the
shared-core proof meaningful — a forked implementation could drift silently.
Client-side parsing (vs. a new typed JSON GET endpoint) was chosen to avoid
a second server-side format definition for the same opaque, header-delimited
transfer contract `decisions-lock.ts` already owns; the client's parser is a
documented mirror, not a reinterpretation (CLAUDE.md rule 7 forbids a direct
cross-package import).

## Rejected alternatives

A dedicated typed JSON `GET /api/org/decisions-proposed` endpoint returning
pre-parsed entries was rejected: it would duplicate `decisions-lock.ts`'s
parsing logic server-side for no behavioral gain, since the existing generic
`/api/org/file` route already serves the raw text the client needs to parse
exactly as `decisions-lock.ts` does.

## Review-cascade findings addressed

- **Doubt-review, HIGH:** the idempotent-retry path's single-still-proposed
  match was deleted as assumed residual cleanup without comparing bodies
  against the already-logged entry — a genuinely distinct proposal reusing
  the same `(timestamp, leadId)` identity would have been silently deleted
  and reported as "already countersigned" under the wrong ADR number. Fixed:
  a body mismatch now returns `duplicate_identity` instead of deleting.
- **F0.5 (real-browser E2E), functional bug the unit-test mocks could not
  see:** the immediate post-success `refetch()` removed the just-
  countersigned entry from the list faster than its own "Countersigned as
  ADR-NNNN" banner could ever be observed — the row unmounted mid-render.
  Fixed: the modal now pins a just-countersigned entry in view (`settled`
  state) until the modal closes, so the success banner is genuinely
  reachable, not dead code that only a mocked-and-frozen fetch made pass.
- **Code-review, medium/low:** the proposal body now renders through
  `DocumentMarkdown` (matching `decision_log.md`'s own rendering of the
  identical byte-preserved text) instead of a bare `<pre>`; the header line
  is no longer duplicated between the row summary and the body; and every
  `data-testid` (not just the React key) is index-qualified so two entries
  sharing an identity (`409 duplicate_proposal_identity`) render as
  independently addressable rows.

## Known, out-of-scope risk (flagged, not fixed)

`leadwright`'s actual current proposal writer
(`leadwright/lib/decisions-proposed.ts`) emits a header format
(`## Proposed <ts> — <decisionKey>` + a `<!-- decisionKey -->` marker) that
does **not** match `decisions-lock.ts`'s own `PROPOSED_HEADER_RE`
(`## [<ts>] <leadId>`) already shipped and tested. This iterate builds
strictly against webui's existing, already-tested contract — reconciling
the two formats is a leadwright-side fix, out of scope here (no lead-side
write path was added by this iterate).
