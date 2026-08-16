# Iterate Spec: v1-lead-fields-tag-filter

- **Run ID:** iterate-2026-08-16-v1-lead-fields-tag-filter
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal

Item 1 (V1) from `C:\01_Development\leadwright\spec\triage-v1-v4a.md` (rev. 2,
2026-08-16): three narrow changes to the External Task API so a future
leadwright daemon can (a) write PO feedback back onto a task, (b) link a task
to its lead-created parent at creation time, and (c) look a task up by tag
cheaply instead of scanning every session's JSONL. The triage file is the
binding assignment; this spec restates it for the iterate lifecycle's own
record-keeping. **Note (Doubt Review, Stage 3):** (c) is a cheap lookup, not
an atomic/idempotent check-and-create — see the Doubt Review section below
for why the original "idempotency search" framing (leadwright's own
triage-v1-v4a.md FR-04.09 wording) overclaimed and how it was corrected.

## Acceptance Criteria

- [ ] AC1: `PATCH /api/external/tasks/:id` with `{poFeedback: "<already-
  trimmed text>"}` returns 200 and the response `task.poFeedback` equals
  the value sent verbatim (not just a 200 with an unchanged task — the
  "silent no-op" trap named in the spec). A separate case with
  leading/trailing whitespace proves `normalizePoFeedback` trims it, same
  as `normalizeDescription` (external review, openai finding 2 — resolved
  by mirroring the description precedent explicitly rather than leaving it
  ambiguous).
- [ ] AC2: The same PATCH succeeds on a **started** task (launched /
  `firstJsonlObservedAt` set) — `poFeedback` is not in `FROZEN_WHEN_STARTED`.
- [ ] AC3: `PATCH .../:id` with `{poFeedback: ""}` **and** a separate case
  with `{poFeedback: null}` both clear the field; after a store reload it
  is absent (`undefined`) in both cases, not re-appearing and not stored as
  a literal empty string (external review, deepseek finding 6 — both
  clearing inputs get their own test, not just `""`).
- [ ] AC4: `PATCH .../:id` with `poFeedback` longer than `DESCRIPTION_MAX_LENGTH`
  (6000 chars) is rejected `400`, asserting BOTH the error code AND the
  exact detail string: `{"error":"invalid_po_feedback","detail":"poFeedback exceeds 6000 characters"}`
  — a dedicated error code, not a reused `invalid_description` string (the
  daemon must branch on the code — external review, openai finding 3: test
  the detail text, not just the status/code). A non-string `poFeedback`
  (e.g. a number) is rejected the same way.
- [ ] AC5: `POST /api/external/tasks` with `{leadParentTaskId: "<id>"}` returns
  200, the response `task.leadParentTaskId` equals the sent value, and it is
  still present after a store reload (`sdk-sessions.json` round-trip).
- [ ] AC6: `POST /api/external/tasks` with `{leadParentTaskId: ""}` does NOT
  set the field (soft-drop, same asymmetry as `domain`).
- [ ] AC7: `POST /api/external/tasks` with `{poFeedback: "..."}` does NOT
  create the field (regression — POST stays create-only for
  `leadParentTaskId`, never for `poFeedback`).
- [ ] AC8: `GET /api/external/tasks?tag=x` returns only tasks carrying that
  exact tag (case-sensitive, no normalization); an unknown tag returns
  `{"tasks":[]}` with `200` (not 400); `?tag=` with no value behaves as no
  filter (all tasks), matching the existing `?projectId=` truthiness
  contract; `?tag=x&projectId=y` intersects both conditions.
- [ ] AC8b: `?tag=a&tag=b` (repeated param) behaves as `?tag=a` — only the
  first value counts (`c.req.query("tag")`, mirroring `?projectId=`); no
  AND/OR across values.
- [ ] AC9: The tag filter is applied **before** `findManyByUuid` — when N
  tasks exist and exactly one carries the requested tag, `findManyByUuid` is
  called with a Set of size 1 (proven via an injectable spy on a real
  `SessionWatcher` instance, not a mock — the existing suite already runs a
  real watcher against a tmpdir).
- [ ] AC10: The `FROZEN_WHEN_STARTED` literal (server + its client mirror)
  is untouched; the parity test stays green.

## Spec Impact

- **Classification:** modify
- **ADD:** none
- **MODIFY:**
  - `FR-01.01` (task board — the survivor ID; `FR-01.08` and `FR-01.09` are
    both `(folded → FR-01.01)` per `spec.md:255,265` — the traceability
    tooling is not fold-aware, so `--affected-frs` / `@covers` annotations
    MUST name `FR-01.01`, never the folded numbers, even though the AC
    prose edits below still live under the `### FR-01.08` / `### FR-01.09`
    headings). Two edits to the AC prose under those headings:
    1. `spec.md:257` currently over-claims that a POST body carrying ANY of
       13 named fields (including `leadParentTaskId`, `poFeedback`,
       `claimToken`, `leadHandoff`, …) is persisted "verbatim" by
       `store.create()`. That was true only for 5 of them before this
       change. This iterate splits it into two accurate ACs: (a) the now-6
       user-creatable fields (adds `leadParentTaskId`) persist + round-trip
       via POST; (b) the 6 daemon-owned fields (`poFeedback`, `claimToken`,
       `claimedBy`, `claimedAt`, `claimPid`, `leadHandoff`,
       `promotedFromTriageId` — 7, not the stale "8") are silently DROPPED
       by POST — the ACTUAL behavior the existing `routes.test.ts:700-746`
       regression test covers and this iterate preserves (AC7). Also fixes
       the stale `schemaVersion stays at 3` mention — `CURRENT_SCHEMA_VERSION`
       is 4 (verified `sdk-sessions-store.ts:213`); the schema is unrelated
       to this iterate's fields and was already wrong before this change.
    2. Appends an AC for the `?tag=` filter on `GET /api/external/tasks`
       under the same `### FR-01.08` heading (list + create).
  - Under `### FR-01.09` (still `FR-01.01` machine-readable): appends
    `poFeedback` to the set of fields patchable via `PATCH /:id`, with the
    same clear-vs-omit contract already documented for
    `domain`/`tags`/`blockedBy`, and explicitly notes `poFeedback` is never
    frozen (not in `FROZEN_WHEN_STARTED`) — AC2.
- **REMOVE:** none

## Out of Scope

- Any UI surface for `poFeedback` (no component reads/writes it yet — it's
  API-only, same as it is today; the response type already exists).
- Item 2A/2B/3 from the same triage file (org route, org page) — separate
  cards.
- A tag index in the store (`store.list()` still materializes + iterates the
  full in-memory map; only the filesystem walk in `findManyByUuid` is saved).
- `org-chart.json`, leadwright's own `realpath: false → true` fix, or any
  leadwright-repo change — those are named in the triage file as leadwright's
  own follow-up work, not this item.

## Design Notes

n/a — no UI surface, API-only change.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/external/tasks/patch.ts` (poFeedback write block) | `server/src/core/sdk-sessions-validate.ts:173-176` (load-time tolerance, `length > 0`) | JSON (`sdk-sessions.json`) |
| `server/src/external/_shared/helpers.ts` `readLeadCreateFields` (leadParentTaskId) | `server/src/core/sdk-sessions-validate.ts:169-172` (load-time tolerance) | JSON (`sdk-sessions.json`) |

Not a NEW boundary — both producer/consumer pairs already exist (this item
plugs a gap where the producer side was silently absent for these two
fields); `touches_io_boundary` does not newly fire since the risk classifier
already saw these code paths pre-existing. No new Boundary Probe required.

**Co-writer note (internal plan review finding).** `sdk-sessions.json` is
3-way-merged in `persist()` — a leadwright daemon process is a second writer
of the same file, and today `poFeedback` is disk-authoritative in that merge
(webui never wrote it). After this change, a webui PATCH sets `poFeedback`
in this instance's baseline→memory diff, so a concurrent daemon write to the
same field within the same merge window can be overwritten by the webui
PATCH (no `updatedAt` tiebreak exists — the merge module's own header notes
a timestamp tiebreak is impossible for this store). This is the intended
semantics (a user's PO-feedback edit should win), recorded here as a
conscious call, not an oversight.

## Out of Scope (addendum — internal plan review)

- Trimming/normalizing `tags` sent via `POST /api/external/tasks`
  (`readLeadCreateFields` doesn't trim, unlike PATCH's `normalizeStringArray`)
  — a pre-existing asymmetry, not introduced by this change. A tag written
  via POST with leading/trailing whitespace won't match an exact `?tag=`
  query; daemon callers should send pre-trimmed tags. Left as-is: fixing it
  is a real behavior change to POST `tags` handling, out of this item's
  scope, and not something 1c's acceptance criteria ask for.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** Core mechanics verified correct against live source, but the
  first plan draft would not have survived the repo's own gates: two files
  needing code edits (`externalApi.ts`, `sdk-sessions-store.ts`) are
  bloat-baseline-pinned at zero headroom, the chosen test-file home was at
  298/300, Spec Impact cited folded FR ids instead of the survivor, and the
  spec/mini-plan disagreed on the F0.5 verification surface.
- **Findings:** 4 high (bloat-neutral budget for 2 pinned files; new
  positive tests need a fresh sibling file, not the near-full one; Spec
  Impact must cite FR-01.01 not the folded FR-01.08/09; spec.md's existing
  AC over-claims persistence for 8 more fields than it should) — all fixed.
  6 medium (verification-surface contradiction; 3 more stale "five"
  comments; missing AC8b repeated-`?tag=` semantics; AC4 needs a dedicated
  error code + null/non-string handling; missing daemon co-writer note on
  the merge boundary) — all fixed. 5 low (reload-test harness shape;
  `helpers.ts` headroom argues against an unneeded shared-helper
  abstraction; client-mirror asymmetry; tag-index rejection re-confirmed
  sound; stale-baseline-entry advisory) — fixed except the tag-index
  re-confirmation (nothing to change) and the POST-tags-trim asymmetry
  (disclosed as Out of Scope, not fixed as a drive-by).
- **Known limitations:** POST `/tasks`'s `tags` field is not trimmed
  (PATCH's is) — pre-existing asymmetry, disclosed in Out of Scope rather
  than fixed in this iterate.
- **Status:** 15 fixed, 1 disclosed, 1 re-confirmed with no change needed

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-16-v1-lead-fields-tag-filter/architecture_brief.md`
- **Verdicts:** deepseek=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed — add
  `poFeedback` to the PATCH allowlist, `leadParentTaskId` to the POST
  create-field reader, and an in-memory exact-tag predicate before
  `findManyByUuid`. No tag index, service, credential, or new endpoint.
- **Findings:** none from either reviewer.
- **Reconciliation:** n/a — both reviewers independently converged on the
  same scope the mini-plan already committed to (and explicitly ruled out
  the tag-index alternative the mini-plan itself had already rejected), so
  there is nothing to reconcile against a withheld rejection rationale.

## External Code Review (Branch A)
- **Provider:** openrouter — deepseek leg `degraded` ("provider returned an
  empty reply"), openai leg succeeded. Not a "did not run" case
  (`degraded: false` at the top level, `reviews_succeeded: 1`) — treated as a
  legitimate partial pass per `iteration-reviews.md`'s degraded-provider
  guidance (only a whole-cascade failure is `degraded: true`).
- **Verdict:** openai=revise.
- **Findings (3, all from openai):**
  1. *(medium)* `routes.lead-fields-tag-filter.test.ts` AC3 clear tests
     called an explicit `store.persist()` after the PATCH response, before
     reloading — since the PATCH route already persists internally
     (`patch.ts:223`), the extra call would mask a regression where the
     route stopped persisting on its own. **accepted-and-fixed** — removed
     both explicit calls; the reload now depends solely on the route's own
     persistence.
  2. *(medium)* Same masking pattern in the AC5 POST round-trip test
     (`create.ts:176` already persists internally). **accepted-and-fixed** —
     removed the explicit `store.persist()`.
  3. *(low)* The AC9 `findManyByUuid` spy test asserted only
     `calledWith.size === 1`, not that the one uuid in the set was the
     *matching* task's — an implementation that filtered to the wrong
     single task would still pass. **accepted-and-fixed** — now asserts
     `calledWith` equals `new Set([matching.sessionUuid.toLowerCase()])`.
- **Disposition:** all 3 findings accepted-and-fixed; no findings rejected.
  Re-ran `routes.lead-fields-tag-filter.test.ts` after the fixes — 17/17
  still pass.

## Doubt Review (Stage 3, advisory-must-address)
- **Trigger:** concurrency — the diff touches the multi-writer `sdk-sessions.json`
  merge boundary (co-writer note above).
- **Q1 (merge symmetry) / Q2 (create- vs patch-time race):** attacked, did
  not hold up. `mergeRow()` is field-generic (no per-field-name branch);
  `poFeedback`/`leadParentTaskId` behave exactly like `domain`. Both
  `create.ts`/`patch.ts` `await store.persist()` before responding, so
  neither write path is more exposed than the other. Stage 2's confirmation
  on these two points stands.
- **Finding A (high, disproved-and-fixed):** the `?tag=` filter's doc
  comment framed it as an "idempotency search" (echoing leadwright's own
  FR-04.09 wording in the triage assignment), which overclaims — a GET then
  a separate POST has a TOCTOU race across two daemon requests (unlike
  `findByPhaseTaskId()`'s synchronous in-request check before
  `store.create()`). **Disposition:** the triage assignment's actual scope
  for Item 1c is narrowly the read-side filter ("only saves the filesystem
  walk... must NOT build a tag index") — an atomic check-and-create was
  never asked for, and adding one now would be a scope expansion beyond
  this iterate. Fixed by correcting the comment to explicitly disclaim
  atomicity and name duplicate-prevention as the daemon's own
  responsibility, rather than by adding server-side dedup logic.
- **Finding B (medium, disposed via Finding A's fix):** flagged that
  `SdkSessionsStore`'s in-memory view is only refreshed by this process's
  own local writes, so a `?tag=` read against an idle/other instance could
  miss a daemon-written row indefinitely — not just within the co-writer
  note's short merge window. This staleness property is pre-existing and
  identical for every other GET filter (`?projectId=`, plain list) — it
  isn't new architecture, only newly *relevant* while the comment implied
  an idempotency guarantee. Once Finding A's fix removes that implication,
  Finding B's caveat applies no differently to `?tag=` than to the rest of
  the (pre-existing, unmodified) list endpoint, so no separate disclosure
  was added for it specifically.
- **Q4 (other):** no irreversible-operation risk found;
  `FROZEN_WHEN_STARTED` / AC10 re-verified directly against
  `task-editability.ts:27-32`, holds.

## Confidence Calibration

- **Boundaries touched:** `sdk-sessions.json` producer/consumer pairs
  (see Affected Boundaries) — not a NEW boundary, `touches_io_boundary`
  did not newly fire, so no dedicated round-trip probe series was
  mandated by the risk flag. The calibration below is driven by the
  review cascade (external code review + doubt review) rather than a
  fresh producer→file→consumer probe series, per the same pattern prior
  boundary-free-but-medium+ iterates in this repo have used.
- **Empirical probes run** (each a "what would this miss?" question,
  answered by a fresh-context reviewer or a targeted check, never by
  self-attestation):
  1. *"Does the AC3/AC5 reload-round-trip test actually prove the ROUTE
     persists, or just that the store's own persist() call works?"* —
     external code review (openai) traced it and found: the test called
     an explicit `store.persist()` after the PATCH/POST response, before
     reloading — masking a hypothetical regression where the route
     stopped calling `persist()` internally. **Finding — fixed**: removed
     the explicit calls in both the `""`/`null` clear tests and the
     `leadParentTaskId` create test; the reload now depends solely on
     the route's own persistence (`patch.ts:223`, `create.ts:176`).
  2. *"Does the AC9 findManyByUuid spy prove the RIGHT task survived the
     tag filter, or just that exactly one task did?"* — external code
     review (openai) found the assertion checked `calledWith.size === 1`
     only, not which uuid. **Finding — fixed**: now asserts
     `calledWith` equals `new Set([matching.sessionUuid.toLowerCase()])`.
  3. *"Is the `?tag=` filter's merge/race behavior for the two new
     fields genuinely identical to the existing `domain`/`tags`/
     `blockedBy` fields, and is the create-time write path more race-
     exposed than the patch-time path?"* — doubt-reviewer (Stage 3)
     traced `mergeRow()` directly (field-generic, no per-field-name
     branch) and both `create.ts`/`patch.ts` (`await store.persist()`
     before responding in both). **No finding** — the co-writer note's
     claim holds exactly as documented; Stage 2's confirmation stands.
  4. *"Does the `?tag=` filter's own doc comment / this spec's Goal
     actually back up the 'idempotency search' framing with an atomicity
     guarantee?"* — doubt-reviewer disproved it: unlike
     `findByPhaseTaskId()`'s synchronous in-request check before
     `store.create()`, `?tag=` is a stateless read with no check-and-
     create; a daemon's GET-then-POST across two requests has a TOCTOU
     race. **Finding (high) — fixed**: corrected the `list-get.ts`
     comment to disclaim atomicity; see Doubt Review section below.
  5. *Follow-up asymptote probe (mandatory — probe 4 found a bug)* —
     `grep -rn idempotency` across every file this iterate touches, to
     check whether the same overclaim survived anywhere else. **Finding**:
     yes — this spec's own Goal section (line 14, pre-fix) still said
     "idempotency search" with no caveat. **Fixed** — added the same
     disclaimer inline in the Goal section, cross-referencing the Doubt
     Review section.
  6. *Second follow-up probe (mandatory — probe 5 found a bug)* — re-ran
     the same `grep -rn idempotency` across every touched file after the
     Goal-section fix. **No finding** — every remaining hit is either
     this spec's own explanatory prose about the correction, or an
     unrelated pre-existing feature (`client/src/lib/externalApi.ts`'s
     phase-task-shadow-reuse comment, `spec.md`'s `.code-workspace`
     upload idempotency, `promotedFromTriageId` finder retry
     idempotency) — none of them describe `?tag=`. Asymptote reached.
- **Test Completeness Ledger** — every testable behavior this diff
  introduces or changes, `tested` (evidence) or `untestable` (closed
  reason code); 0 testable-but-untested:

  | Behavior | Status | Evidence |
  |---|---|---|
  | poFeedback PATCH writes + echoes verbatim in the response (AC1) | tested | `routes.lead-fields-tag-filter-patch.test.ts` |
  | poFeedback trims like `normalizeDescription` (AC1) | tested | `routes.lead-fields-tag-filter-patch.test.ts` |
  | poFeedback PATCH succeeds on a started task, not frozen (AC2) | tested | `routes.lead-fields-tag-filter-patch.test.ts` |
  | poFeedback `""` clears; absent after a ROUTE-persisted reload (AC3) | tested | `routes.lead-fields-tag-filter-patch.test.ts` (probe 1 fix) |
  | poFeedback `null` clears; absent after a ROUTE-persisted reload (AC3) | tested | `routes.lead-fields-tag-filter-patch.test.ts` (probe 1 fix) |
  | poFeedback over-length (6001 chars) -> 400 `invalid_po_feedback` with the exact detail string (AC4) | tested | `routes.lead-fields-tag-filter-patch.test.ts` |
  | poFeedback exactly 6000 chars accepted (AC4 boundary) | tested | `routes.lead-fields-tag-filter-patch.test.ts` |
  | poFeedback non-string -> 400 `invalid_po_feedback` (AC4) | tested | `routes.lead-fields-tag-filter-patch.test.ts` |
  | leadParentTaskId POST persists + round-trips via a ROUTE-persisted reload (AC5) | tested | `routes.lead-fields-tag-filter-create.test.ts` (probe 1 fix) |
  | leadParentTaskId empty string soft-dropped on POST (AC6) | tested | `routes.lead-fields-tag-filter-create.test.ts` |
  | poFeedback NOT accepted on POST — PATCH-only (AC7 regression) | tested | `routes.lead-fields-tag-filter-create.test.ts`, `routes.test.ts` (surgically-edited existing regression) |
  | `FROZEN_WHEN_STARTED` literal (server + client mirror) untouched (AC10) | tested | pre-existing `task-editability-mirror.test.ts` parity test; re-verified directly against `task-editability.ts:27-32` by doubt-reviewer |
  | `?tag=` exact case-sensitive match (AC8) | tested | `routes.lead-fields-tag-filter-list.test.ts` |
  | `?tag=` unknown value -> `200 {tasks:[]}`, not 400 (AC8) | tested | `routes.lead-fields-tag-filter-list.test.ts` |
  | Empty `?tag=` value behaves as no filter (AC8) | tested | `routes.lead-fields-tag-filter-list.test.ts` |
  | `?tag=x&projectId=y` intersects both filters (AC8) | tested | `routes.lead-fields-tag-filter-list.test.ts` |
  | Repeated `?tag=a&tag=b` — first value only (AC8b) | tested | `routes.lead-fields-tag-filter-list.test.ts` |
  | `?tag=` filter applied BEFORE `findManyByUuid`, walk sees only the matched set (AC9) | tested | `routes.lead-fields-tag-filter-list.test.ts` (probe 2 fix — exact-set assertion) |
  | poFeedback/leadParentTaskId merge behavior under a concurrent daemon write is field-generic, identical to `domain`/`tags`/`blockedBy` (co-writer note) | untestable (`covered-by-existing-test`) | `sdk-sessions-store-merge-edge.test.ts` Guard 3 (generic same-row/different-field survival pattern); traced against live `mergeRow()` source by doubt-reviewer (probe 3) |
  | Real-HTTP surface (not just in-process `app.request()`) for all three changes | tested | `client/e2e/flows/lead-fields-tag-filter.spec.ts` (3 tests, isolated single-process stack) |
  | `api-contract-baseline.json` stays in sync (`tag?` query param, `invalid_po_feedback` error code) | tested | `api-contract-sweep.test.ts` (34/34 passing, incl. both baseline-drift meta-tests) |
- **Confidence-pattern check:**
  - *Asymptote (depth):* satisfied — probes 4 and 5 each found a real
    overclaim (in `list-get.ts`'s comment, then in this spec's own Goal
    section); probe 6, targeting the exact same dimension after both
    fixes, found nothing. Per the "if yes-then-bug has happened even
    once, run one more probe" rule, probe 6 is the required follow-up
    and it is the marginal no-finding probe that closes the loop.
  - *Coverage (breadth):* every testable behavior in the ledger above is
    `tested` (one entry via `covered-by-existing-test`, all others via
    named new/existing tests); zero testable-but-untested.
  - *Composition:* not applicable — `cross_component` risk flag did not
    fire (this touches three existing endpoints on existing machinery,
    not framework cross-component resolver/hook/pipeline code per the
    Architecture Review's own framing), so no integration-category
    ledger row is required.

## Verification (medium+)

- **Surface:** web — **corrected** (internal plan review caught a
  contradiction: this section originally said `api`, citing "no client/UI
  surface", while the mini-plan already planned a Playwright spec per the
  Backend-affects-Frontend rule). The rule is unconditional once API routes
  are touched ("`surface = web` is mandatory even when no `client/**` file
  changed... regardless of file paths" — `references/F0.5.md`), so `web` is
  the only defensible reading, not `api`. The authored spec is a legitimate
  Playwright **API-testing** spec (the `request` fixture only, no
  `page.goto`) — it still runs via the exact `web` runner command
  (`npx playwright test {spec}` against the dev stack per
  `references/design-and-testing.md`), it is simply testing a surface with
  no browser-rendered UI yet.
- **Runner command:** `npx playwright test client/e2e/flows/lead-fields-tag-filter.spec.ts`
  against an isolated single-process stack (built `client/dist` served by
  one worktree Hono via `SHIPWRIGHT_STATIC_DIR`, per the proven single-
  process F0.5 recipe already used by this project's other iterates).
- **Evidence path:** `shipwright_test_results.json.iterate_latest.surface_verification`
  (raw output at `.shipwright/runs/{run_id}/surface_verification.json`,
  `playwright-report/index.html` as the evidence file).
- **Justification:** n/a (surface is not `none`)
