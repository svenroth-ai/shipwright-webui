# Surface server-computed staleness + beat-register findings on the org card

**Run-ID:** iterate-2026-09-06-org-lead-staleness-register
**Spec:** `.shipwright/planning/iterate/2026-09-06-org-lead-staleness-register.md`

## Context

FR-04.06 (lead staleness) and FR-04.41 (open beat-register entry) had been
filed for months as "the org page does not show it." Both values were
already computed server-side (`last-run.ts`'s `lastRunCore`,
`beat-register.ts`'s `evaluateRegisterHealth`) and the release action
already existed (`beat-register-release-core.ts`) — the client discarded
all of it, and the release action was reachable only through a
secret-gated route, not the browser.

## Decision

Widen the wire types (`LeadLastRunView`, `LeadRegisterView`, both named so
`org-schema-sync.test.ts` can bind them per-arm) to carry the server's own
`staleness` verdict and register-health classification verbatim, render
them client-side with no second vocabulary, and proxy the existing release
action to the plain `/api/org/*` surface via a new `POST
/api/org/leads/:leadId/beat-register/release` route. Both the secret-gated
and plain routes now share one `handleReleaseRequest` function (request
validation + deps-defaulting + `performRelease` call + error-to-status
mapping) so their contracts cannot drift independently.

## Architecture Review — should the plain-surface write exist at all?

External review split on this at the architecture-brief stage (before any
code): GLM approved wiring the release button into the plain browser
surface (Option A — this iterate's approach); OpenAI's `revise` verdict
argued for keeping the release action behind the existing secret-gated
route only (Option B), reachable from the UI via a proxy through server
-side auth rather than a second unauthenticated write path.

Resolved in favor of Option A on the operator's own pre-existing
instruction in the task brief: *"wiring the existing release button is in
scope, inventing a new endpoint is not."* The task brief already
presupposes the release button is reachable from the browser card, which
Option B does not deliver without inventing exactly the kind of new
endpoint the brief says is out of scope. The unauthenticated-write concern
is mitigated structurally rather than dismissed: the register path is
derived solely from the route's own chart-validated `leadId` (never from
the request body), the `sessionId` must match a real UUID format AND an
actual open entry in the target lead's own register, and a mismatched
lead/session pair is regression-tested to prove no cross-lead mutation is
possible (`org-leads-beat-register-release.test.ts`).

## Consequences

- The browser can now release a stuck beat directly from the org card,
  closing FR-04.41 for real (not just displaying the finding).
- The plain `/api/org/*` surface gains its first browser-reachable mutating
  route — future org-page write actions should default to the same
  `requireChartLead`-gate-before-parse + shared-validation-function pattern
  established here (`handleReleaseRequest`), not reinvent per-route deps
  defaulting.
- `staleness: "unknown"` is now a genuine third UI state (never a synonym
  for fresh or stale) with its own worded reason
  (`cadenceUnresolvedReasonText`), tested explicitly including the
  reachable-but-previously-unproven "unknown with no named reason" case.

## Rejected alternatives

- **Option B** (release stays secret-gated-only, UI proxies through
  server-side auth): rejected per the Architecture Review above — would
  require inventing a new endpoint shape the task brief explicitly ruled
  out, for a security benefit already achieved structurally by
  leadId-derived path resolution + sessionId/entry matching.
- **Folding `register` into `LeadNowState`** as a fifth arm instead of a
  sibling field on `LeadRosterEntry`: rejected as circular — register
  health is already derived FROM (part of) the same `beatRegisterHealthCore`
  read that also feeds `now`, so nesting one inside the other's union would
  make the "resting vs needs-attention" arm depend on data it doesn't need
  to render, for no simplification.
