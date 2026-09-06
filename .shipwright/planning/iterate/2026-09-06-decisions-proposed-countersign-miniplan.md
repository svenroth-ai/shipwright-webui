# Mini-Plan: decisions-proposed.md browser view + Countersign

run_id: iterate-2026-09-06-decisions-proposed-countersign
complexity: small (FEATURE)

## Scope

Make waiting decision proposals (`decisions-proposed.md`) visible in the
Org page's shared-documents block, and let the PO countersign one from the
browser — without handing the browser the `/api/external/org/*` shared
secret.

## Approach (chosen)

Mirror the `beat-register/release` precedent exactly (the "second browser
write" — `beat-register-release-request.ts`):

1. **Server** — split `external/org/countersign.ts`'s inline logic into:
   - `countersign-core.ts`: the pure lock/mutate action (`performCountersign`),
     unchanged behavior, moved verbatim.
   - `countersign-request.ts`: `handleCountersignRequest(deps, rawBody)` —
     validation (ISO timestamp, lead-id shape) + outcome→HTTP status mapping,
     shared by both mounts.
   - `countersign.ts`: gated-route shell only (`registerCountersignRoute`),
     re-exports core+request (same shape as `beat-register-release.ts`).
   - `routes/org.ts`: new `POST /api/org/decisions/countersign` mount, same
     core, host-allowlisted only (no secret, no leadId path param — this
     action is not lead-scoped the way beat-register release is).
2. **Client**
   - `client/src/lib/orgDecisionsApi.ts` — parses `decisions-proposed.md`'s
     raw text (fetched via the existing `fetchOrgFileText`) into entries,
     mirroring `decisions-lock.ts`'s header regex (`## [<ts>] <leadId>`)
     client-side (no cross-package import — CLAUDE.md rule 7). Also the
     `countersignDecision()` POST fetcher.
   - `OrgDecisionsProposedModal.tsx` — new, write-capable modal (the
     generic `OrgDocViewerModal` stays read-only-only, per its own doc
     comment). Lists parsed entries, a Countersign button per entry, honest
     404/409/already-countersigned states.
   - `OrgSharedDocs.tsx` — 5th tile wired to the new modal instead of the
     generic viewer.
3. **Tests**: `countersign-request.test.ts` driving both mounts from one
   core (task requirement (b)); a direct pin of the charter-PUT 403 on
   `decision_log.md`/`decisions-proposed.md` kinds (task requirement (c));
   client parser + component tests; `org-schema-sync.test.ts` gets the new
   mirrored types.

## Alternative considered (rejected)

Add a typed `GET /api/org/decisions/proposed` route that returns
already-parsed JSON entries (server does the parsing). **Rejected**: the
task brief is explicit that `GET /api/org/file?path=decisions-proposed.md`
already serves the raw file and "reading needs no new route" — adding one
would duplicate `decisions-lock.ts`'s parser behind a second, redundant
surface for no behavioral gain, and would still require a client-side
mirror type either way (CLAUDE.md rule 7 forbids importing the server
parser directly). Client-side parsing of the same opaque header format the
route already exposes is the smaller, more consistent change.

## Known risk (out of scope, flagged not fixed)

`leadwright/lib/decisions-proposed.ts`'s actual writer renders
`## Proposed <ts> — <decisionKey>` (+ a hidden `<!-- decisionKey -->`
marker and `- **Evidence:** <pointer>` body line), which does not match
`decisions-lock.ts`'s `## [<ts>] <leadId>` header contract the *already
shipped* countersign route parses against. This is a pre-existing
cross-repo mismatch, not introduced here — this iterate builds strictly
against the existing, tested webui-side contract (no lead-side write path
is in scope). Flagged in the run summary for a follow-up iterate to
reconcile.
