# Mini-Plan: v1-lead-fields-tag-filter

- **Run ID:** iterate-2026-08-16-v1-lead-fields-tag-filter

## Internal Plan Review — Findings Triage

`opus-plan-reviewer` ran over the first draft of this plan. Verified findings
and disposition (fix/disclose/decline), most severe first:

1. **[fix, high]** `client/src/lib/externalApi.ts` (862/862) and
   `server/src/core/sdk-sessions-store.ts` (543/543) are bloat-baseline-
   pinned at **zero** headroom — both verified via `wc -l` against the
   baseline JSON. Any net-positive edit blocks the commit. Plan: pay for
   every added code line by tightening a comment block being touched in the
   same diff anyway (see "Bloat-neutral edit budget" below). Do NOT raise
   the baseline (self-approval on a CI/sensitive-path file — DO-NOT #25/#30
   territory) and do not game the count with line-merging.
2. **[fix, high]** `server/src/external/tasks/__tests__/routes.test.ts` is
   298/300 (verified) — effectively zero headroom for the ~10 new test
   cases (AC1-AC10). Moved to a **new sibling file**,
   `server/src/external/routes.lead-fields-tag-filter.test.ts`, matching
   the project's actual convention for this kind of change: ~12 existing
   `routes.<topic>.test.ts` files already live beside `routes.test.ts`
   (`routes.edit-fields.test.ts`, `routes.description-length-cap.test.ts`,
   `routes.backlog.test.ts`, …) — several from exactly this kind of prior
   iterate. This new file uses `createExternalRoutes` (full app), not
   `createTasksRouter`, matching `routes.edit-fields.test.ts`'s precedent
   (the closest prior art: "PATCH /tasks widens to accept new fields").
3. **[fix, high]** Spec Impact must cite `FR-01.01` (the survivor — both
   `FR-01.08`/`FR-01.09` are `(folded → FR-01.01)`), never the folded
   numbers, per this project's fold-not-tooling-aware convention. Fixed in
   the iterate spec.
4. **[fix, high]** `spec.md:257`'s existing AC over-claims persistence for
   13 fields when only 5 were true; splitting into two accurate ACs (6
   user-creatable persist, 7 daemon-owned silently drop) plus fixing the
   stale `schemaVersion stays at 3` (actual: 4). Fixed in the iterate spec's
   Spec Impact section; applied to `spec.md` itself during Step 6 build.
5. **[fix, medium]** Verification surface contradiction (spec said `api`,
   mini-plan planned a Playwright spec) — resolved to `web` per the
   unconditional Backend-affects-Frontend rule; the authored spec uses
   Playwright's `request` fixture only (legitimate API-testing mode, still
   the `web` runner command). Fixed in the iterate spec.
6. **[fix, medium]** Three more stale "five"/"5" comments the assignment
   and first mini-plan draft missed: `sdk-sessions-store.ts:362-368`
   (create() args doc), `tasks/create.ts:147-148`. (The client SDK's
   `createTask()` options comment at `externalApi.ts:276-283` is DECLINED —
   see item 12 below, it stays accurate without editing.) Both added to the
   file-edit list below.
7. **[fix, medium]** AC8b (`?tag=a&tag=b` → first value wins,
   `c.req.query("tag")` not `c.req.queries()`) added to the iterate spec
   + test list; no implementation ambiguity since Hono's `c.req.query(key)`
   already returns a single (first) value, matching `?projectId=`'s
   existing behavior.
8. **[fix, medium]** AC4 pinned to a dedicated `invalid_po_feedback` error
   code (not a reused `"description exceeds..."` message) + `null`/non-
   string handling. `api-contract-baseline.json`'s `tasks.patch.errors`
   array gets the new code alongside `tasks.list.query`'s `tag?`.
9. **[fix, medium]** Affected Boundaries: added the leadwright-daemon
   co-writer note (webui PATCH now wins a same-field race with a concurrent
   daemon write inside the merge window) to the iterate spec.
10. **[fix, low]** AC3's reload test needs a second `SdkSessionsStore` over
    the SAME `deps` object — the new test file's harness returns
    `{app, store, deps}` (not just `{app, store}`) so this works; noted in
    the test file that the lock-less in-memory double skips the
    `mergeSessions` path (proves the `undefined`-key-drops-from-JSON
    mechanism, not multi-writer merge behavior).
11. **[fix, low]** `helpers.ts` is 259/300 — do NOT extract a shared
    `normalizeCappedText` (unnecessary abstraction the assignment doesn't
    ask for, and risks the extra lines tipping the file over 300). Ship one
    self-contained `normalizePoFeedback`, structurally mirroring
    `normalizeDescription` but NOT sharing code with it (that function's
    exact error string is pinned by `routes.description-length-cap.test.ts`
    + `spec.md:260` — do not touch it).
12. **[fix, low]** Client mirror asymmetry: `TaskUpdatePatch`'s doc comment
    gets `poFeedback` added to the "may be patched in any state" list
    (same-line edit, proves AC2). `ExternalTask`'s comment moves
    `leadParentTaskId` into "User-creatable". **Declined**: adding
    `leadParentTaskId` to `createTask()`'s inline options type
    (`externalApi.ts:276-289`) — that function is a webui-only convenience
    wrapper the leadwright daemon never calls (it hits the HTTP API
    directly, per the triage file's own framing); the existing "five
    user-creatable leadwright fields" comment stays literally true because
    this specific helper still only forwards five. Not touching this block
    at all — neither the comment nor the type — is the honest, minimal
    choice, and it removes an item from an already-tight bloat budget.
13. **[decline, low]** Tag index rejection re-confirmed sound (verified
    against the assignment's own "was 1c nicht leistet" section) — no
    change, just noted explicitly that AC9's spy needs no production
    injection seam (`vi.spyOn` on a real `SessionWatcher` instance works
    as-is).
14. **[disclose, low]** POST `tags` aren't trimmed (PATCH's are, via
    `normalizeStringArray`) — pre-existing asymmetry, not introduced here.
    Recorded as an Out of Scope addendum in the iterate spec rather than
    fixed as a drive-by.
15. **[disclose, low]** `routes.test.ts` goes 843→840 after the surgical
    edit (Falle 1); `shipwright_bloat_baseline.json`'s `current: 843` entry
    becomes stale-high. The hook only blocks `measured > current`, so this
    is safe and produces an expected stale-entries advisory. Confirmed:
    `shipwright_bloat_baseline.json` is NOT touched in either direction
    (writing `current` down would drag this PR into a DO-NOT #25/#30
    sensitive-path Tier-3a review for zero gain).

## External LLM Review — Findings Triage

Branch A ran (`external_review.py --mode iterate`, provider openrouter).
`deepseek=approve`, `openai=revise` — no contradiction (agree within one
step). Dispositions:

1. **[decline]** openai: type `TaskUpdatePatch.poFeedback` as
   `string | null` (server also accepts `null` to clear). Declined —
   EVERY other clearable `TaskUpdatePatch` field (`title`, `description`,
   `phase`, `priority`, `complexityHint`, `domain`) is typed `?: string`
   only; the doc-comment's established SDK convention is "send `\"\"` to
   clear", not `null`. Typing only `poFeedback` as `| null` would be an
   inconsistent one-off against five siblings. The server still accepts
   `null` on the wire (AC4) — this is a TS client-ergonomics question, not
   a wire-contract gap.
2. **[fix]** openai: `normalizePoFeedback`'s trim behavior vs. AC1's
   "response equals the value sent" needs disambiguation. Resolved: it
   DOES trim, exactly like `normalizeDescription` (the assignment's own
   "Vorbild ist der description-Block" instruction) — AC1's test uses an
   already-trimmed sample so "equals the value sent" holds unambiguously,
   and a separate test proves the trim (leading/trailing whitespace →
   trimmed value persisted), matching `description`'s established
   behavior rather than deviating into verbatim-preservation.
3. **[fix]** openai: assert the exact `detail` string in AC4's test, not
   just the status + error code. Added to the test plan.
4. **[already true, no fix]** deepseek: verify `findManyByUuid` doesn't
   do wasted I/O on an empty tag-filtered set. Verified —
   `session-watcher.ts`'s own doc comment: "An empty input set
   short-circuits with no walk" (`wanted.size === 0` → early return). No
   code change needed; AC9's zero-task case is already covered by
   existing behavior.
5. **[decline, documented]** deepseek: consider extracting a shared
   length-validation helper if `normalizePoFeedback` /
   `normalizeDescription` diverge further. Declined for THIS iterate per
   finding 11 of the internal review (unneeded abstraction, `helpers.ts`
   headroom) — noted as a real future consideration if the two functions
   ever need to diverge more, not actioned now.
6. **[fix]** deepseek: confirm the `null`-clears-like-`""` path is
   exercised by a dedicated test, not just asserted in prose. Added
   explicitly to the AC3 test list.
7. **[verified, no fix]** deepseek: does `readLeadCreateFields`'s
   `domain` check trim before the length-drop? Verified against the live
   source: `typeof body.domain === "string" && body.domain.length > 0` —
   **no trim**. `leadParentTaskId` mirrors this exactly (no trim), per
   the assignment's explicit "Muster: exakt wie domain" instruction.
8. **[fix, minor]** deepseek: note the `findManyByUuid` spy's coupling to
   the `SessionWatcher` internal API in a test comment, for future
   maintainers. One-line comment added.
9. **[verified, no fix]** deepseek: confirm
   `sdk-sessions-validate.ts`'s load-time `poFeedback` tolerance
   (`length > 0 → keep`) imposes no upper-bound constraint. Verified
   against the live source (lines 173-176) — no length cap on load, fully
   permissive. Consistent with the write-side 6000-char cap (load-time
   tolerance is deliberately looser than write-time validation elsewhere
   in this file, e.g. `tags`/`blockedBy`).
10. **[acknowledged]** deepseek: have a second developer review the
    bloat-neutral comment tightening for lost context. No second reviewer
    available in this run; the `code-reviewer` / `doubt-reviewer` cascade
    at Step 8 will read the tightened comments as fresh eyes — flagged so
    that pass looks at them with extra scrutiny.

## Bloat-neutral edit budget

Verified current line counts (`wc -l`, matches baseline `current` exactly —
zero headroom on the first two):

| File | Current | Budget |
|---|---|---|
| `client/src/lib/externalApi.ts` | 862 | ≤862 (net 0) |
| `server/src/core/sdk-sessions-store.ts` | 543 | ≤543 (net 0) |
| `server/src/external/routes.test.ts` | 843 | any (net **negative** expected — Falle 1 removes 3 lines) |

**Plan per file** (verify with `wc -l` after editing, BEFORE committing —
adjust comment wrapping if a rewrite lands a line short of budget):

- `sdk-sessions-store.ts`: +2 code lines (`leadParentTaskId?: string;` in
  the `create()` args type; the assignment line in the body). Pay for it by
  tightening the two comment blocks being touched anyway — the
  `ExternalTask` doc-comment (~159-162) rewritten to mention
  `leadParentTaskId` as creatable without growing past its current 4 lines,
  and the `create()` args doc-comment (~362-368, currently 7 lines)
  shortened to ~5 while still explaining the daemon-owned exclusion.
- `externalApi.ts`: +1 code line (`poFeedback?: string;` in
  `TaskUpdatePatch`). Pay for it by tightening the `ExternalTask` doc-
  comment (~80-92) by 1 line while adding the `leadParentTaskId` move — the
  `TaskUpdatePatch` doc-comment edit (adding `poFeedback` to the
  never-frozen list) is a same-line edit, not a new line.
- `routes.test.ts`: net negative (3 lines removed: `leadParentTaskId` from
  the injection body, response type, and assertion — no lines added).

## Files to create/modify

- `server/src/external/_shared/helpers.ts` — edit: add `normalizePoFeedback`
  (exported, self-contained, structurally mirrors `normalizeDescription` but
  does NOT share code with it — that function's error string is pinned
  elsewhere); `readLeadCreateFields` gains `leadParentTaskId` (soft-drop,
  non-empty-string gate, mirrors `domain`); update the "5 user-creatable"
  comment → 6.
- `server/src/external/tasks/patch.ts` — edit: `poFeedback` joins `PATCHABLE`;
  new write block (`if ("poFeedback" in body) { ... }`) using
  `normalizePoFeedback`, returning `invalid_po_feedback` on error (own
  error code, not `invalid_description`).
- `server/src/external/tasks/create.ts` — edit: fix the stale "five
  user-creatable routing fields" comment (~147-148) → six. No signature
  change — `leadFields` already spreads onto `store.create({...})`.
- `server/src/core/sdk-sessions-store.ts` — edit, **bloat-neutral** (see
  budget above): `create()`'s args type gains `leadParentTaskId?: string`
  (next to `blockedBy`); the constructor body gains
  `if (typeof args.leadParentTaskId === "string") task.leadParentTaskId =
  args.leadParentTaskId;`; tighten the `ExternalTask` doc-comment (~159-162)
  to move `leadParentTaskId` into the creatable list + note `poFeedback` is
  PATCH-only, without exceeding its current 4 lines; tighten the `create()`
  args doc-comment (~362-368, 7 lines) to ~5 lines while updating "5"→"6".
- `server/src/external/tasks/list-get.ts` — edit: read `?tag=` via
  `c.req.query("tag")` (first-value-wins, matching `?projectId=` — AC8b)
  alongside `?projectId=`, filter `filtered` further BEFORE the
  `findManyByUuid` call (currently at line ~39).
- `client/src/lib/externalApi.ts` — edit, **bloat-neutral** (see budget
  above): tighten the `ExternalTask` doc-comment (~80-92) by 1 line while
  moving `leadParentTaskId` into "User-creatable" and noting `poFeedback`
  is PATCH-only; add `poFeedback` to `TaskUpdatePatch`'s "may be patched in
  any state" doc-comment list (same-line edit) and add
  `poFeedback?: string;` to the `TaskUpdatePatch` interface (~421-435).
  **Declined**: `createTask()`'s inline options type (~276-289) — stays
  untouched, see triage item 12.
- `server/src/core/sdk-sessions-store.test.ts` — edit: fix the "5
  user-creatable fields" comment at lines ~242-244 → 6. Lines 246-247,
  273-274, 306-307 (the assertions) stay untouched per the triage file's
  explicit instruction — they test persistence, not the write surface, and
  remain true regardless.
- `server/src/external/routes.test.ts` — edit ONLY the existing "POST /tasks
  ignores daemon-only fields" test (lines ~700-746): drop `leadParentTaskId`
  from the injection body, the response type, and the assertion (it's no
  longer daemon-only); keep the `poFeedback` assertion (regression, AC7).
  Net **negative** (Falle 2) — no new lines here; positive-case tests go in
  the new sibling file below.
- **New (post-Stop-gate split):** originally authored as one combined
  `routes.lead-fields-tag-filter.test.ts`; the Stop hook's bloat gate
  flagged it at 313 lines (300-line guideline, "crossing") after the
  external-review test fixes below added a few lines — a real ratchet, not
  advisory, since the Stop gate (unlike the pre-commit hook) blocks on any
  new-file crossing too. Split into four files instead of trimming
  comments/blank lines further:
  - `server/src/external/_lead-fields-tag-filter-harness.ts` (50 lines) —
    shared `inMemoryDeps()` / `makeApp()` / `STORE_PATH`, extracted so the
    three test files below don't each duplicate it.
  - `server/src/external/routes.lead-fields-tag-filter-patch.test.ts` (133
    lines) — poFeedback PATCH (AC1-AC4).
  - `server/src/external/routes.lead-fields-tag-filter-create.test.ts` (71
    lines) — leadParentTaskId POST (AC5-AC7).
  - `server/src/external/routes.lead-fields-tag-filter-list.test.ts` (106
    lines) — `?tag=` GET filter (AC8/AC8b/AC9).
  Follows the `routes.<topic>.test.ts` sibling-file convention (~12
  precedents); each file uses `createExternalRoutes` via the shared harness
  (returns `{app, store, deps, watcher}` so the watcher can be spied and the
  reload test can share `deps`).
- `server/src/external/__tests__/api-contract-baseline.json` — edit:
  `tasks.list`'s `"query"` array gains `"tag?"`; `tasks.patch`'s `errors`
  array gains `{"code":"invalid_po_feedback","status":400}`.
- New Playwright spec: `client/e2e/flows/lead-fields-tag-filter.spec.ts` —
  API-testing mode (`request` fixture only, no `page.goto`) driving
  AC1/AC3/AC4/AC5/AC6/AC7/AC8/AC8b against a live isolated stack (F0.5
  `surface=web`, Backend-affects-Frontend rule — see Verification section).

## Work breakdown

1. `helpers.ts`: `normalizePoFeedback`; extend `readLeadCreateFields`; fix
   the stale comment. Test: none yet (covered by step 2/3's route tests
   exercising it end-to-end — this is a pure helper, TDD happens at the
   route boundary per the codebase's existing pattern where
   `normalizeDescription` itself has no standalone unit test file).
2. `patch.ts`: PATCHABLE + write block for `poFeedback`. Test (new sibling
   file): AC1 (write + response echoes value), AC2 (started task succeeds),
   AC3 (empty string clears + reload via a second store over the same
   `deps`), AC4 (over-length / non-string → 400 `invalid_po_feedback`;
   `null` clears).
3. `sdk-sessions-store.ts` `create()`: accept + assign `leadParentTaskId`,
   bloat-neutral comment tightening. Test (new sibling file): AC5 (POST
   persists + reload round-trip), AC6 (empty string soft-dropped).
4. `routes.test.ts` (843-line file): surgical edit to the existing
   "ignores daemon-only fields" test — drop `leadParentTaskId` from the
   three spots, keep `poFeedback`. Test: this IS the test (AC7 regression).
5. `list-get.ts`: `?tag=` filter before `findManyByUuid`. Test (new sibling
   file): AC8 (known tag / unknown tag / empty value / combined with
   `?projectId=`), AC8b (repeated `?tag=` — first wins), AC9 (`vi.spyOn`
   on a real `SessionWatcher` — assert call arg `.size === 1` when exactly
   one of N seeded tasks carries the tag).
6. `externalApi.ts`: bloat-neutral comment fixes + `TaskUpdatePatch.poFeedback`.
   No test (type-only + comment; `tsc --noEmit` is the check).
7. `create.ts` + `sdk-sessions-store.test.ts`: comment-only fixes.
8. `api-contract-baseline.json`: add `"tag?"` + the new error code.
9. Author + execute the Playwright spec (Step 11a/11b) against the isolated
   single-process stack (built `client/dist` + one Hono process,
   `SHIPWRIGHT_STATIC_DIR`), per project memory's proven single-process
   recipe. No client UI changed, so this spec drives the API directly via
   the `request` fixture — no `page.goto` required.
10. Full test suite (`npx vitest run` in `server/`), `npx tsc --noEmit` in
    both workspaces, `npx oxlint` in both workspaces, and `wc -l` on the
    two bloat-neutral files to confirm the budget held.

## Test strategy

Vitest (server): existing files get surgical/comment edits only; ALL new
positive-case coverage lands in three new sibling files split off a shared
`_lead-fields-tag-filter-harness.ts` (matches this codebase's actual
convention of ~12 `routes.<topic>.test.ts` files, corrected after the
internal plan review flagged the first draft's "no new file" rationale as
factually wrong; further split from one file into four after the Stop
hook's bloat gate flagged the combined file at 313 lines — see "Files to
create/modify" above). One Playwright spec (new file, per the "prefer
creating a new spec file" rule in `design-and-testing.md`) for the F0.5
`web` gate.

## Alternative approach (rejected)

**Alternative:** Add a generic `store.list({tag})` server-side filter method
(a real tag index / `Map<tag, Set<taskId>>`) instead of filtering the route's
already-materialized array before the `findManyByUuid` call.

**Rejected because:** the triage file's Item 1c "What 1c does *not* deliver"
section explicitly scopes this OUT — `store.list()` continues to materialize
+ sort the full in-memory map; only the filesystem walk (`findManyByUuid`) is
saved. A tag index is a real feature (cache invalidation on patch/delete,
memory tradeoff) that isn't part of this assignment and isn't justified by
AC9's actual cost target (the JSONL filesystem walk, not the in-memory Map
iteration). Building it now would be scope creep the acceptance criteria
don't ask for and the spec explicitly forbids.
