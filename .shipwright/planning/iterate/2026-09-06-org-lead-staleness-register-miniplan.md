# Mini-Plan: Surface lead staleness + open beat-register findings

**Run ID:** iterate-2026-09-06-org-lead-staleness-register

## Files to create/modify

| File | Change |
|---|---|
| `server/src/types/org.ts` | Widen `LeadNowState.resting.lastRun` (measured:true) with `staleness`/`cadenceUnresolvedReason`; add `LeadRosterEntry.register` |
| `server/src/routes/org-leads-composite.ts` | Compute register health once; thread staleness through `buildNow`; populate `register` |
| `server/src/routes/org.ts` | Add `POST /api/org/leads/:leadId/beat-register/release` (mirrors `beat-register-release.ts`) |
| `server/src/routes/__tests__/org.test.ts` | New assertions: staleness/cadence-unresolved/register fields on the composite read |
| `server/src/routes/__tests__/org-charter-write.test.ts` (or new sibling) | New POST route tests: success, 404 not-found, 409 fault, unregistered leadId, invalid body |
| `client/src/lib/orgApi.ts` | Mirror the two type widenings; add `releaseBeatRegisterEntry` fetcher |
| `client/src/components/org/LeadCard.tsx` | `NowLine` 3-way resting split + badge split; new register-finding block + release button |
| `client/src/styles/org.css` | Small additions: finding block, release button (reuse `.nowline.attn`/`.thread-open` tokens) |
| `client/src/components/org/LeadCard.test.tsx` | Update the one `measured:true` fixture (+`staleness`); add overdue/cadence-unresolved/register-finding/release cases |
| `client/src/pages/OrgPage.test.tsx`, `OrgPage.thread.test.tsx`, `LeadCard.usage-consumed.test.tsx` | Add the new required `register: {status:"clear"}` field to the shared base fixture |
| `client/e2e/flows/org-page.spec.ts` | New `describe` block: real `last-run.json` + cron + `beat-register.json` fixtures, overdue card text, release round-trip |

## Work breakdown

1. Server types (`types/org.ts`) — widen `LeadNowState`, add `register` field. No behavior yet, just the wire contract.
2. `org-leads-composite.ts` — single register-health read, threaded into `buildNow` + new `register` field. Unit-test via the existing composite-read tests in `org.test.ts` (extend fixtures with `last-run.json` + `beat-register.json`).
3. `routes/org.ts` — new POST proxy route, reusing `performRelease`. Unit tests: success (recovered), already-closed no-op, not-found, fault (duplicate), unregistered leadId, invalid sessionId/reason shape.
4. Client mirror (`orgApi.ts`) — same two type widenings + `releaseBeatRegisterEntry`. `org-schema-sync.test.ts` must stay green.
5. `LeadCard.tsx` — `NowLine`/`statusBadge` 3-way split; register-finding block + release button + confirm + query invalidation. Update/extend `LeadCard.test.tsx` + the 3 sibling fixture files.
6. `client/src/styles/org.css` — minimal additive styling.
7. E2E (`org-page.spec.ts`) — real-fixture round trip: seed `last-run.json` (stale, via a cron 3x past due) + `beat-register.json` (one open entry), assert card text + release button, click it, assert the register file's `closedAt` is set and the finding disappears.

## Component hierarchy

`OrgPage` → `<lead-list>` → `LeadCard` → `NowLine` (existing, extracted
into `leadNowDisplay.tsx`) + new `LeadRegisterFinding` (its own file,
`LeadRegisterFinding.tsx` — split out rather than kept inline, once the
register-finding UI plus its release-button state/error handling made
`LeadCard.tsx` itself the thing at risk of crossing 300 lines; this
supersedes the "kept inline" note in the pre-review draft of this plan).

## Data model changes

None — no new on-disk schema. `beat-register.json` / `last-run.json` /
`org-chart.json` shapes are all pre-existing and untouched.

## Test strategy

- Server: extend existing Vitest suites (`org.test.ts` composite-read
  group, a new POST-route describe block) — no new test files needed given
  the file-size headroom.
- Client: extend `LeadCard.test.tsx` (component-level, asserts rendered
  text per the CLAUDE.md testing convention) + fixture updates in 3 sibling
  files + `orgMarkdownFileApi`-style fetcher is NOT reused (different verb
  shape) — a small dedicated test for `releaseBeatRegisterEntry` in
  `orgApi.ts`'s existing fetcher-test file if one exists, else inline in
  `LeadCard.test.tsx` via a stubbed `fetch`.
- E2E: real-fixture round trip (not mocked) through the isolated stack, as
  a new sibling `org-page.register.spec.ts` (not an extension of
  `org-page.spec.ts` — kept separate per finding #6). The release action's
  reason is collected via `window.prompt` (Design Notes point 7); the E2E
  handles this explicitly with Playwright's native dialog API
  (`page.once("dialog", (d) => d.accept("..."))`) registered BEFORE the
  click that triggers it — an unhandled `prompt()` would otherwise hang
  the test.

## Alternative approach (rejected)

**Fold `register` into `LeadNowState` as a fifth arm** (e.g.
`{state: "blocked", entry: ...}`) instead of a sibling field on
`LeadRosterEntry`. Rejected because an open register entry and the
existing `now.state` are orthogonal: a genuinely running lead (health
`open`) already renders "Running" today, and that must keep working
unchanged — folding the finding into the same union would force every
existing `now.state` consumer (the badge, the OrgChart tree's binary
`running`/`not-measured` check) to learn a new arm it doesn't care about,
and would make "running + hung" inexpressible without inventing a second
vocabulary on top of `evaluateRegisterHealth`'s own three-way
`clear`/`open`/`fault` classification — exactly what the task brief says
not to do. A sibling field keeps `now` describing activity phase and
`register` describing the register file's own health, independently,
matching how the server already keeps `usage`/`cadence`/`role` as
independent per-figure fields on the same entry. There's also a
circularity that folding would introduce: `buildNow`'s own branching
already READS the register health first (`open`/`fault` short-circuit to
`running`/`needs-attention` before `now` ever looks at `last-run.json` at
all) — `now` is *derived from* register health, not a peer of it. Folding
`register` as a `now` arm would mean the thing `now` is derived from
also has to live inside `now`, which is backwards from how every other
build* function on this entry works (each reads its own upstream source
once and reports its own figure).

## Post-review file-table additions (not in the pre-review table above)

The Internal Plan Review's fixes required splitting several files to stay
under the 300-line convention — the pre-review table above undercounted
this by design (a plan can't predict exactly where a line-count guideline
gets crossed):

| File | Reason |
|---|---|
| `server/src/external/org/beat-register-release-request.ts` (new) | `handleReleaseRequest` — shared validation + status-mapping, extracted so `beat-register-release.ts` and `routes/org.ts`'s new POST route can't drift (finding #5) |
| `server/src/routes/__tests__/org-leads-staleness-register.test.ts` (new) | Staleness + register-health composite-read tests, split out of `org.test.ts` |
| `server/src/routes/__tests__/org-leads-beat-register-release.test.ts` (new) | The new plain-surface POST route's own tests (thin — the release action itself is covered by the existing `external/org/__tests__/beat-register-release*.test.ts`) |
| `client/src/components/org/LeadRegisterFinding.tsx` (new) | The register-finding UI + release button, split out of `LeadCard.tsx` |
| `client/src/components/org/LeadRegisterFinding.test.tsx` (new) | Component tests: clear/open/fault/unknown rendering, release happy path, cancel, refused release |
| `client/e2e/flows/org-page.register.spec.ts` (new) | Sibling of `org-page.spec.ts`, kept separate rather than extended in place (finding #6) |
