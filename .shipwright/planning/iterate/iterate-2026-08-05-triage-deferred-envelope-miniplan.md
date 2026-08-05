# Mini-Plan: triage-deferred-envelope

## Primary approach

See the spec's "Technical Approach" section. Summary: port the monorepo's
revisit-expiry overlay into `readAllItems()` (new `triage-defer.ts`), add a
CLI-parity envelope builder (new `triage-contract.ts`), extract the existing
inline body validators out of `routes/triage.ts` (new `triage-validation.ts`)
to make room for `revisitAt` plumbing without ratcheting that file's bloat
baseline, and build the Deferred section client-side from the EXISTING
`GET /api/triage/:projectId` response (no live wire-shape change).

## Alternative considered: change the live route to `{contractVersion, open, deferred}`

Make `GET /api/triage/:projectId` itself return the monorepo's envelope shape,
so the WebUI's own HTTP API mirrors the CLI contract 1:1.

**Rejected because:**

1. **No cross-repo consumer to version against.** The monorepo's CLI contract
   needs a `contractVersion` because the CLI and the WebUI are independently
   deployed and can drift. The WebUI's `client/` and `server/` are built and
   shipped together (same PR, same deploy) — there is nothing on the other end
   of this specific HTTP call that could be running an older contract version.
   Versioning it buys nothing this repo doesn't already get for free.
2. **Breaking change to existing consumers for no behavioral gain.**
   `GET /api/triage/:projectId` today returns ALL statuses unfiltered
   (`{items, origin}`) and is read by more than the Triage tab: the sidebar
   badge polls it, campaign correlation reads it, the staleness banner reads
   `origin`. Reshaping the payload into `open`/`deferred` sections would force
   every one of those call sites to change, or to work around a shape that no
   longer matches what they need (the sidebar count wants ALL open items
   regardless of project grouping, not a per-project split).
3. **Contradicts the project's additive-schema convention** (CLAUDE.md
   architecture rule 15, "Schema is additive + write-on-touch"). Two new
   fields on the existing item shape is additive; restructuring the envelope
   is not.

The chosen approach gets the same user-visible outcome (a Deferred section,
correctly computed due-state) with a strictly additive wire change, and keeps
the CLI-parity artifact (`triage-contract.ts`) doing exactly the job the
triage card asked for: proving the WebUI's understanding of the monorepo
contract hasn't drifted — without forcing that shape onto a route it was
never describing.
