# Mini-Plan: lead-inventory-page

- **Run ID:** iterate-2026-09-08-lead-inventory-page

> **Revised after Internal Plan Review** (opus-plan-reviewer, HIGH severity —
> see the iterate spec's `## Internal Plan Review` section for the full
> findings + triage). Four HIGH findings all got a **fix** disposition, which
> changed this plan materially:
> 1. The "authority ladder" is no longer a declared/missing binary framed as
>    "which bands it may act on alone" — `validateCharterBands`'s own header
>    disclaims that reading, and (because `checkBeatStart` denies a beat
>    outright when any band is missing) any lead with beats to show
>    necessarily has all 4 declared, making the binary vacuous exactly where
>    it would be seen. It now renders each band's own charter *prose*
>    (§4.4 section text) next to a `4/4 declared` completeness line — real
>    information, not a fabricated authorization signal.
> 2. Read failures now have a distinct `unknown`/`unreadable` state, never
>    collapsed into "clear"/"no steps reported" (this repo already fixed the
>    identical collapse once, in `org-leads-composite.ts`'s `registerFieldFor`).
> 3. The endpoint is roster-wide (`GET /api/org/inventory`, matching
>    `/api/org/threads`'s existing composite shape) instead of one
>    per-lead route re-parsing `org-chart.json` N times; `audit.jsonl` is
>    read ONCE per lead (via the existing paginated `auditLogCore`, capped at
>    its own `MAX_LIMIT=200`) instead of once per beat; beats are bounded to
>    a 48h window server-side instead of the whole register history.
> 4. `FR-04.43` is dropped — that number is leadwright's OWN spec's heartbeat-
>    daemon FR, not a free id in this repo's island. New ACs anchor under
>    `FR-01.71(G)` instead.
>
> **Further revised after External Plan Review** (glm + openai, both
> `revise`): the audit-read's `limit:200` single call can still produce a
> false `clear` (paged to the window start now, capped, degrades to
> `unknown` on cap); `totalBeatsInRegister` added so the client can tell
> "empty window" from "no history"; both new readers re-validate `leadId`
> too, not just `beatId`; an all-malformed `steps.jsonl` now renders "steps
> unavailable" instead of "no steps reported"; a refused `beatId` degrades
> only its own beat; the window filter is `startedAt`-only including open
> beats; the reserved empty W15 slot is omitted entirely;
> `charter-bands-mirror.ts` gets the same provenance header as the vendored
> schema; a missing/invalid `startedAt` is included, not dropped. Full
> findings + disposition: iterate spec `## External Plan Review`.

## 1. Files to create/modify

**Vendored contract + mirror (new)**
- `server/src/vendor/leadwright/beat-step.schema.json` — byte copy, pinned
  at leadwright `origin/main` commit `db2938b308899b8cbca017b291c18696a54844b5`
  (verified on `origin/main`, not a local-only commit)
- `server/src/types/leadwright-beat-step.ts` — hand mirror + `isValidBeatStep`
  (validates only the fields this viewer consumes — `at`/`band`/`summary`/
  `effect` — and TOLERATES unknown properties, deliberately looser than the
  vendored schema's own `additionalProperties: false`, so a future
  leadwright field addition degrades to "ignored", not "every line rejected")
- `server/src/types/leadwright-beat-step.test.ts` — reads the vendored JSON
  fresh off disk and pins its `required`/`band.enum`/`effect.oneOf` shape
  against hardcoded expectations (the real precedent `leadwright-preflight.test.ts`
  sets — NOT a byte-diff, which is unprovable with no leadwright dependency);
  plus fixture accept/reject cases for `isValidBeatStep`

**Charter authority reading (new)**
- `server/src/external/org/charter-authority-read.ts` — reads charter.md
  (via `orgFileReadCore`, same as `existing-charters-read.ts`/`role-extract.ts`).
  Owns the §4.4 band-heading detection LOCALLY (Architecture Review, GLM,
  accepted: a separate pinned mirror of `charter-validate.ts` wasn't earned
  by the payoff, since the 4 band names are already hardcoded in this repo's
  vendored schema enum) — same slash-spacing-normalized heading match
  `validateCharterBands` does, attributed by comment, not a separately
  vendored/pinned file. For each of the 4 bands, extracts the heading
  section's own prose (next heading of any level, or EOF, bounds the
  section) — mirrors `role-extract.ts`'s line-shape-skip technique, not a
  markdown AST parse. Compares `org-chart.json`'s `charter_path` against the
  literal default and degrades honestly ("custom path not yet supported")
  when it differs, rather than silently reading the wrong file.
- `server/src/external/org/charter-authority-read.test.ts` — all-4-declared,
  2-of-4, slash-spacing boundary, empty section, non-default `charter_path`.

**Per-figure readers (new) — mirror `audit-log.ts`'s open-first/O_NOFOLLOW/
fstat/realPathGuard pattern exactly; a genuine read failure (ELOOP, EACCES,
corrupt JSON at the file level) is NEVER collapsed into "empty"/"clear"**
- `server/src/external/org/beat-steps-read.ts` — reads one beat's
  `steps.jsonl`; validates `beatId` against a new `BEAT_ID_RE` (leadwright
  generates beat ids via `randomUUID()` — `lib/beat-round.ts`/`daemon/tick.ts`
  confirmed) BEFORE the path join, closing the unvalidated-path-segment gap.
  Returns `{status:"ok", steps: BeatStepView[], unreadableLines: number}`
  (ENOENT — no file at all, matching the optional-steps protocol — is `ok`
  with an empty array) or `{status:"unreadable"}` for a genuine file-level
  failure (symlink refusal, non-file, read error) — the UI must render these
  two differently (see AC-2b below).
- `server/src/external/org/beat-steps-read.test.ts`
- `server/src/external/org/beat-effect-audit-read.ts` — wraps the EXISTING
  `auditLogCore`, one call chain per LEAD (not per beat): pages via `before`
  until either every entry back to the 48h window start is covered, or a
  10-page (2000-entry) cap is hit — hitting the cap degrades to
  `{status:"unknown"}` rather than risking a false `clear` (External Plan
  Review, both reviewers). Returns `{status:"ok", unclaimedBeatIds:
  Set<string>}` when fully covered (incl. the 404-no-file case, which
  legitimately means "clear"), `{status:"unknown"}` otherwise — never
  conflating a coverage gap or a real failure with "clear".
- `server/src/external/org/beat-effect-audit-read.test.ts`

**Composite core + route (new) — ROSTER-WIDE, matching `/api/org/threads`**
- `server/src/types/org-inventory.ts` — new types file (keeps
  `types/org.ts` at 237 lines untouched; new types would push it near/over
  the 300-line convention)
- `server/src/routes/org-inventory-composite.ts` — pure core
  `buildOrgInventory(deps, leadIds)`: for each lead, reads beat-register
  (`readRegisterFileTolerant`/`registerPathFor`, reused as-is), filters
  entries to `startedAt >= now - 48h` (bounded read — the client narrows
  further to the exact "last night" window; 48h is a generous buffer, not
  the display window), calls `beat-effect-audit-read` ONCE, maps each
  bounded beat through `beat-steps-read` + the audit Set lookup, and calls
  `charter-authority-read` once per lead.
- `server/src/routes/org-inventory-composite.test.ts` — including a test
  that ONE bad beat's read failure degrades only that beat (never the whole
  lead or the whole response), matching the composite-degrade convention.
- `server/src/routes/org-inventory.ts` — `registerLeadInventoryRoutes(app,
  deps)`, mounts `GET /api/org/inventory` (one call for every chart lead,
  same shape/placement as `/api/org/threads` in `routes/org.ts`)
- `server/src/routes/org-inventory.test.ts`

**Wiring (edit)**
- `server/src/routes/org.ts` — add the `registerLeadInventoryRoutes` call
  (247 → ~255 lines, stays under the 300-line convention)

**Client data layer (new — NOT editing `orgApi.ts`, already at 309 lines)**
- `client/src/lib/leadInventoryApi.ts` — `fetchOrgInventory()` + mirror types
- `client/src/hooks/useLeadInventory.ts` — same `useQuery` shape as
  `useOrgThreads`

**Client components (new)**
- `client/src/components/leadInventory/BandChip.tsx` — the ONE component
  both step rows and the authority panel use, so "same bands, same words" is
  structural
- `client/src/components/leadInventory/BeatList.tsx` — beats within the
  window, steps in file order, unclaimed-effect warning banner
  (`data-testid="unclaimed-effect-warning"`), a distinct
  "steps unavailable" state (`unreadable`) vs. "no steps reported"
  (`ok`, empty array) vs. an ordered step list
- `client/src/components/leadInventory/AuthorityPanel.tsx` — per-band prose
  (or "not declared") via `BandChip`, plus a `4/4 declared` completeness line;
  explicitly NOT framed as "may act alone"
- `client/src/components/leadInventory/NeedsYou.tsx` — cards whose LATEST
  round is unanswered, question + one `data-testid="needs-you-answer-field"`
  (read-only — this page never writes an answer), a "View full conversation
  on Org" link to the EXISTING `/org` thread view (FR-01.71(D)) rather than
  a synthesized answer affordance. No reserved slot for W15's terminal
  button — External Plan Review (GLM): an empty box reads as broken chrome;
  omitting it costs nothing and W15 inserts its own affordance when it lands.
- `client/src/pages/LeadInventoryPage.tsx` — PageHead + per-lead sections,
  ONE bounded scroller (`flex-1 overflow-y-auto`, the Diagnostics pattern) —
  required by `shell-scroll-invariant.test.ts`
- `client/src/styles/leadInventory.css` — scoped `.lead-inventory-page` prefix
- Component tests alongside each

**Router + nav (edit)**
- `client/src/router.tsx` — `/org/inventory` route + nav handle
- `client/src/pages/OrgPage.tsx` — a plain text link (same visual weight as
  the existing `org-new-lead-button` Link, not a `.btn-primary`, so DO-NOT
  #26's CTA-standard guard does not apply) in the header actions cluster
- `client/src/test/shell-scroll-invariant.test.ts` — add
  `/org/inventory`/`LeadInventoryPage` to `TITLE_BAR_ROUTES`

**E2E (new)**
- `client/e2e/flows/lead-inventory-page.spec.ts` — uses the canonical
  `isolated-stack.mjs` harness (isolated `leadsRoot` via env override to
  `OrgApiRouterDeps.leadsRoot`), explicitly NOT the `rmSync(homedir())`
  pattern older org specs use — that pattern now wipes a real operator's
  live leads data, which this iterate's own existence proves now exists.

## 2. Work breakdown (sequential)

1. Vendor `beat-step.schema.json` (verify pinned commit is on leadwright
   `origin/main` first) + `leadwright-beat-step.ts` + fidelity test.
2. `charter-authority-read.ts`: local §4.4 heading match (all-4, 2-of-4,
   slash-spacing boundary case) + per-band prose extraction + `charter_path`
   default comparison + test (band with prose, band missing entirely, band
   heading present but empty section, non-default `charter_path`).
4. `beat-steps-read.ts`: `BEAT_ID_RE` guard, open-first/O_NOFOLLOW read,
   tolerant per-line JSONL parse; re-validates `leadId` (`LEAD_ID_RE`) too,
   not just `beatId`. Tests: missing file → `ok`/empty; malformed beatId or
   leadId → `unreadable`, refused before any fs call; symlinked/corrupt file
   → `unreadable`; 2 valid + 1 malformed line → `ok`, 2 steps,
   `unreadableLines:1`; ALL lines malformed → `ok`, 0 steps,
   `unreadableLines:N` (client renders this as "steps unavailable", never
   "no steps reported" — AC-10); truncated final line (mid-append race) →
   counted as one unreadable line, not a whole-file failure.
5. `beat-effect-audit-read.ts`: wraps `auditLogCore`, paging via `before`
   until the 48h window start is covered or a 10-page cap is hit (cap hit →
   `unknown`, never a guessed `clear` — AC-9). Tests: matching entry within
   the first page → found; matching entry past page 1 but before the window
   start → found (proves the paging, not just the single-call case); no
   audit file (404) → `ok`, empty Set; cap hit before reaching the window
   start → `unknown`; a genuine read failure → `unknown`.
6. `org-inventory-composite.ts`: `buildOrgInventory`. Also computes
   `totalBeatsInRegister` (full `entries.length`, no extra I/O — AC-8) and
   orders beats `startedAt` ascending, open beats included (no `closedAt`
   filter). A register entry with a missing/invalid `startedAt` is included,
   never dropped. Tests: full fixture tree → correct composite shape; 48h
   window bound excludes an old beat but a missing-`startedAt` entry
   survives it; one bad beat (incl. a `BEAT_ID_RE`-refused one) degrades
   only that beat; a lead with a charter missing 2/4 bands → correct
   per-band prose/declared state; a non-default `charter_path` → the honest
   "custom path not yet supported" degrade, not a silent wrong-file read.
7. `org-inventory.ts` route + wire into `org.ts`. Test: 200 composite body
   keyed by every chart leadId, one call.
8. **Boundary Probe** (`touches_io_boundary`): a real `steps.jsonl` line
   round-tripped through `beat-steps-read.ts` → `isValidBeatStep`.
9. Client: `leadInventoryApi.ts` + `useLeadInventory.ts`.
10. `BandChip.tsx`.
11. `BeatList.tsx` — three-state step rendering (ok+steps / ok+empty /
    unreadable), warning banner test asserting literal text.
12. `AuthorityPanel.tsx` — per-band prose + `4/4 declared` line, NOT an
    "act alone" claim anywhere in copy or testids.
13. `NeedsYou.tsx` — latest-unanswered-round filter, single field, Org link,
    empty W15 slot. Test: exactly one `needs-you-answer-field` per card, zero
    round-chrome testids.
14. `LeadInventoryPage.tsx` — bounded scroller, per-lead composition, "last
    night" client-side filter (predicate: `startedAt` within the window —
    matches "started overnight"), explicit empty state naming the window's
    actual times when the filtered list is empty but the raw list isn't.
15. Router + nav entry; `OrgPage.tsx` header link; `shell-scroll-invariant.test.ts`
    registry update.
16. Component tests for every agent AC.
17. E2E spec authored (Step 11a) against the isolated-stack harness, then
    executed (Step 11b / F0.5).

## 3. Component hierarchy

```
LeadInventoryPage (PageHead, one flex-1 overflow-y-auto scroller)
└─ per lead (from useOrgChart roster)
   ├─ AuthorityPanel (BandChip ×4, per-band prose, 4/4 declared line)
   ├─ BeatList (window-filtered client-side)
   │  └─ BeatCard × N
   │     ├─ unclaimed-effect warning (status: found)
   │     └─ steps: ordered StepRow × N | "no steps reported" | "steps unavailable"
   └─ NeedsYou
      └─ open-question row × N (question + single read-only answer field +
         "View full conversation" Org link + empty W15 slot)
```

## 4. Data model changes
None — no migrations, no new persisted webui state.

## 5. Test strategy
- Unit/integration (vitest, both workspaces): one `.test.ts`/`.test.tsx` per
  new module, pure-core style. Security tests for path-traversal/symlink/
  invalid-beatId refusal on the two new readers (mirrors `file-read.test.ts`'s
  own coverage shape). Degrade tests proving `unknown`/`unreadable` never
  collapse into a positive claim.
- Boundary Probe: real steps.jsonl line round-tripped through the reader.
- E2E: authored + executed against the dev stack via `isolated-stack.mjs`
  (mandatory at medium+), covering the full page for a lead with
  beats+steps+authority panel+an open question+an unclaimed-effect warning.
- No DB/RLS — no pgTAP.

## 6. Alternative approach (considered, rejected)

**Alternative: extend `/org`'s existing `LeadCard` in place instead of a new
page/route.** Rejected — confirmed sound by Internal Plan Review (no
objection raised): FR-01.71(A) already fixes `/org`'s render order (chart →
shared docs → one fixed-shape card per lead); folding ordered beats/steps/an
authority panel into that would both break the adopted fixed order and push
`OrgPage.tsx` well past the 300-line convention, mixing two different
reading modes (at-a-glance roster vs. overnight drill-down) in one tree. A
linked, separate page — reached the same way `/org/new-lead` is reached from
`/org` — keeps `/org` fast and unchanged for operators who only want the
roster view.
