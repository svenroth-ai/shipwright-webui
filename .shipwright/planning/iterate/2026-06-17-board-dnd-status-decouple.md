# Iterate Spec — Task-Board Drag-and-Drop + decouple board column from session state

- **Run ID:** `iterate-2026-06-17-board-dnd-status-decouple`
- **Intent:** FEATURE (new DnD capability) + behavior CHANGE (board column is decoupled from the derived session `state`)
- **Complexity:** medium (locked)
- **Spec Impact:** ADD (new `boardColumn` field + `/column` endpoint + DnD UI) — also MODIFY (board grouping semantics)
- **Risk flags:** `touches_public_api`, `touches_build`, `touches_shared_infra`

## Problem

The Task-Board has three columns (Backlog / In Progress / Done) but the column is
**derived from the session `state`** (`TaskBoardPage.groupByState`). `state` is a
mix of user-owned sticky values (`draft`, `done`) and **machine-derived ephemeral
values** (`active` / `idle` / `jsonl_missing`), continuously recomputed from
JSONL-mtime + pty-liveness by the transcript poll state-machine
(`server/src/external/transcript/routes.ts`).

Consequences:
1. There is **no assignable "In Progress" status** — it reflects "a live/recent
   Claude session exists". So a card cannot be dragged *into* In Progress; the only
   two transitions the user asked for that have no clean target are exactly
   Backlog→In Progress and Done→In Progress.
2. The board column being coupled to session liveness is the root cause. The code
   already fights this with sticky-guards so the poll machine can't yank a Backlog
   card back out (`transcript/routes.ts:67,112`, FR-01.32).

The user's framing (verbatim): *Resume stems from the copy-command era; sessions
live longer now; **Status and Resume can be separated**.* This iterate implements
exactly that separation.

## Goal

Decouple the **board column** (a sticky, user-owned organizational status) from the
**session `state`** (machine-owned liveness, which keeps driving the Launch/Resume
CTA and the state badge). Then wire HTML5-accessible drag-and-drop between all three
columns, making all five requested transitions possible — including the two that are
impossible today.

## Design (chosen)

**`boardColumn` as an override that wins at grouping time; the liveness state-machine
is left untouched.** This keeps the change bounded to *medium* and avoids touching the
delicate active/idle decay logic (which has a long regression history).

- New optional, sticky field `boardColumn ∈ {"backlog","in_progress","done"}` on
  `ExternalTask` (client `externalApi.ts` + server `sdk-sessions-store.ts`).
- Board grouping: `task.boardColumn ?? deriveBoardColumn(task.state)`.
  `deriveBoardColumn` reproduces today's mapping (`draft`→backlog, `done`→done,
  else→in_progress). **With no DnD ever performed, behaviour is byte-for-byte
  identical to today** (pure fallback), and a freshly-launched never-dragged task
  auto-derives to In Progress — so "auto in_progress on first launch" is free, with
  **no edits to the 5 launch branch files**.
- `state` continues to be maintained by the poll machine and continues to drive the
  StatePill (the liveness badge), the icon, and the Launch-vs-Resume CTA in
  `TaskCard`. **Status (column) and Resume (liveness) are now orthogonal.**
- DnD sets **only** `boardColumn` (pure registry flip; JSONL + session untouched). A
  live (`state=active`) task parked in Done keeps its live badge and Resume button —
  which is the explicit intent.
- Menu actions stay coherent by also syncing `boardColumn`:
  `/close`→`done`, `/backlog`→`backlog`, `/reopen`→`backlog` (else a manual override
  could strand a card in the wrong column).
- Persistence: **write-on-touch** — `boardColumn` is only written when explicitly set
  (DnD or a menu action). No batch rewrite on boot. Schema bumps `3 → 4`; loader
  accepts v1–v4 (DO-NOT guards #8/#15, extended).

### Bloat-ceiling constraint (shapes the file layout)

`externalApi.ts` (863), `TaskBoardPage.tsx` (650), `TaskCard.tsx` (552),
`sdk-sessions-store.ts` (791) are **grandfathered** in `shipwright_bloat_baseline.json`
— the pre-commit anti-ratchet hook hard-blocks net growth. Therefore:

- **New files** carry the new logic:
  - `client/src/lib/boardColumnApi.ts` — `setBoardColumn(taskId, column)` wrapper +
    the canonical `BoardColumn` type + `deriveBoardColumn(state)` (referenced in
    architecture.md for doc-sync).
  - `client/src/components/external/TaskBoardColumns.tsx` — the 3-column grid + DnD
    (`@dnd-kit`) extracted out of `TaskBoardPage.tsx` (which **net-shrinks**).
  - Server: new endpoint lives in existing `external/tasks/lifecycle.ts` (has headroom).
- `TaskCard.tsx` is left **unmodified** — the draggable wrapper is applied by
  `TaskBoardColumns`, not inside the card.
- Unavoidable interface-field additions to the two grandfathered store/api files are
  **offset by trimming verbose comments in the same file** (net LOC ≤ baseline);
  verified against the hook before commit.

## Acceptance Criteria

- **AC-1** A new optional `boardColumn` field exists on `ExternalTask` (client+server),
  validated to the 3 literals; any other value loads as absent. Schema `v4`; v1–v3
  files still load (back-compat). Persist writes v4.
- **AC-2** `POST /api/external/tasks/:id/column {column}` sets `boardColumn` only
  (state/JSONL untouched): 200 + updated task on success; 400 `invalid_column` on a
  bad value; 404 unknown task; 409 on ELOCKED; idempotent for an unchanged value.
- **AC-3** Board groups by `boardColumn ?? deriveBoardColumn(state)`. A task with no
  `boardColumn` lands in exactly the same column as today (fallback parity test).
- **AC-4** Dragging a card to another column persists `boardColumn` and the card stays
  there across a page reload and across the 1 s transcript poll (no snap-back) — incl.
  the two previously-impossible moves Backlog→In Progress and Done→In Progress.
- **AC-5** Status ↔ Resume decoupled: a `state=active|idle` task dragged into **Done**
  keeps its liveness badge + Resume CTA; a `draft` task dragged into **In Progress**
  shows the never-launched green Launch CTA. (CTA keys off `state`, not column.)
- **AC-6** Menu actions stay coherent: `/close` lands the card in Done, `/backlog` and
  `/reopen` land it in Backlog, even after a prior manual drag.
- **AC-7** Keyboard-accessible DnD (dnd-kit KeyboardSensor) — a card can be moved
  between columns without a pointer; the card click-to-detail + ⋯-menu still work
  (drag handle does not swallow the navigate/keyboard affordances).

## Affected Boundaries

- **IO / persisted schema:** `sdk-sessions.json` (v3→v4, additive) — `touches_io_boundary`
  → Boundary Probe + round-trip (load v3 → persist v4 → reload) test.
- **Public API:** `ExternalTask` response shape + new `/column` route — client/server
  mirror (DO-NOT #7). New `BoardColumn` literal union kept in sync both sides.
- **Build:** new dependency `@dnd-kit/core` in `client/package.json` —
  `touches_build` (Lighthouse/bundle gate via /shipwright-test 3.8).
- **Shared infra:** Task-Board (central UI) + `sdk-sessions-store`.
- **Docs:** CLAUDE.md DO-NOT #8/#15 text (schema v4) + new modules in
  architecture.md / component_inventory.md (doc-sync.test.ts).

## Alternatives considered

- **A — DnD only for the 3 existing endpoints** (no decouple): smaller, but leaves
  Backlog→In Progress / Done→In Progress impossible and the root-cause coupling
  intact. Rejected by the user in favour of the clean separation.
- **B — Make drop-on-In-Progress trigger Launch/Resume:** couples DnD to the launch
  coordinator; a drag would silently spawn a Claude session. Surprising UX. Rejected.
- **C — Rip out `state`'s column role entirely / replace with `boardColumn`
  everywhere:** large (escape-hatch); touches the delicate poll machine + every
  `state` consumer (CTA, header, filters, boot-sweep). Rejected in favour of the
  bounded override-at-grouping design above.

## Test Plan (TDD)

- Server unit: `routes.column.test.ts` (AC-2, incl. state/JSONL untouched);
  store v4 load/persist + `boardColumn` validation + v1–v3 back-compat (new test file,
  not growing the grandfathered `sdk-sessions-store.test.ts`); extend close/backlog/
  reopen assertions for AC-6 (new file or net-zero).
- Client unit: `deriveBoardColumn` + grouping parity (AC-3); `setBoardColumn` wrapper;
  `useSetBoardColumn` optimistic update + invalidate; TaskBoardColumns drop → API call.
- E2E (Playwright, mandatory at medium): drag across columns, assert persistence
  across reload (AC-4) + decoupled CTA (AC-5) + keyboard move (AC-7).
- Boundary Probe: v3-on-disk → load → persist → assert v4 + boardColumn round-trips.

## External Plan Review — resolutions (folded 2026-06-17, openrouter: gpt-5.4 + gemini-3.1-pro)

- **[HIGH] Optimistic update races the ~1–2 s task-list poll → visible snap-back**
  (both reviewers; matches PR #150 history). `useSetBoardColumn.onMutate` →
  `cancelQueries(["external-tasks"])` + snapshot + optimistic set; `onError`
  rollback; `onSettled` invalidate. Add an integration test simulating a poll
  landing between drop and mutation response. **(AC-4 hardened.)**
- **[HIGH] Keyboard-accessible DnD** (OpenAI). `@dnd-kit/core` ships `KeyboardSensor`
  + accessibility announcer; but bucket-to-bucket keyboard moves are added as a
  **menu-based fallback** in the (non-grandfathered) ⋯-menu — a keyboard-reachable
  "move to column" affordance (covers the missing →In Progress path). Stay on
  `@dnd-kit/core` only (buckets auto-sort by createdAt; no in-column ordering in
  scope → no `@dnd-kit/sortable`). **(AC-7 method.)**
- **[MED] Whole-card draggable would break click-to-open / ⋯-menu / touch** (OpenAI):
  use `PointerSensor` `activationConstraint:{distance:8}` so a click is not a drag;
  `TaskCard.tsx` stays unmodified; explicit tests for click-opens-detail, menu-opens,
  drag(>8px)-moves, and touch. Fallback to a minimal in-card handle (net-zero trim)
  only if the wrapper approach proves insufficient on touch.
- **[MED] "Auto-completion stranding" premise corrected** (Gemini): **nothing
  auto-sets `state=done`** — only `POST /close` does; a finished Claude session decays
  `active→idle` (still In Progress). So a card is never stranded by background
  completion. Manual-drag-then-menu coherence is covered by the `/close|/backlog|
  /reopen → boardColumn` sync (AC-6) + an explicit "dragged to X then close" test.
- **[MED] Audit other `state`-as-status consumers** before claiming the board is the
  only grouping site: `TaskList.tsx`, `statusCounts` + `BoardStatusFilter`
  (these filter by *liveness* `state` by design — orthogonal to column, kept),
  `MasterTaskCard`, `CampaignsLane`. Regression note + focused checks.
- **[MED] `/column` response** returns `withLiveSession(task)` for sibling parity;
  tests assert **only** persisted `boardColumn` changed on disk and `state`/JSONL are
  untouched (liveness in the response may be refreshed — acknowledged).
- **[MED] Malformed body** (`column` missing / non-string) → `400 invalid_column`;
  multi-tab = last-write-wins + post-mutation refetch convergence (server stateless,
  `persist()` uses proper-lockfile → 409 ELOCKED).
- **[MED→note] No external v3-pinned reader of `sdk-sessions.json`** (webui-owned
  write surface; orchestrator reads run-config, not this file). Confirm via grep in
  Step 0; persist-writes-v4 is safe.
- **[LOW] Same-column drop guard** (Gemini): `onDragEnd` aborts with zero API calls
  when the target column equals the card's current effective column.
- **[LOW] Clearing `boardColumn` is out of scope** — a manual override persists until
  the next explicit move; an invalid persisted value loads as absent + emits a trace
  (not silently swallowed).
- **[LOW] Bloat discipline** (Gemini): do **not** delete load-bearing docs to beat the
  anti-ratchet hook. Minimize additions; trim only genuinely redundant comments. If a
  clean net-zero on a grandfathered file is impossible without harming documentation,
  bump that file's `shipwright_bloat_baseline.json` limit **with an ADR rationale**
  (the sanctioned path) instead of gutting comments.
- **[note] authz/CSRF:** `/column` inherits the same Hono app + middleware as
  `/close|/backlog|/reopen` (loopback-only local tool; no per-route auth by design).
- **[LOW] `boardColumnApi.ts` is the single home** for board-column behavior
  (`BoardColumn` type + `deriveBoardColumn` + `setBoardColumn`); the inline union in
  `externalApi.ts` carries a comment pointing here as canonical (mirror forced by the
  bloat ceiling, DO-NOT #7 parity test still applies).

## External Code Review — resolutions (folded 2026-06-17, openrouter: gpt-5.4 + gemini)

Ran `external_review.py --mode code` over the full diff. gpt-5.4 returned 2 HIGH +
2 MED (all about AC-7 keyboard a11y being asserted but not *functional*/tested, plus
E2E completeness). Resolutions:

- **[HIGH] keyboard DnD not functional/tested** → added a deterministic, accessible
  **"Move to…" ⋯-menu** (Radix submenu, gated on current *column*) as the keyboard /
  touch / screen-reader path; `TaskCardMenu.test.tsx` proves keyboard-Enter selection
  fires the right column.
- **[HIGH] E2E incomplete** → added an E2E that drives the menu **entirely by
  keyboard** + a component test proving a live (`active`) task parked in Done keeps
  its Resume CTA (AC-5) and a `draft` pulled into In Progress keeps green Launch.
- **[MED] `/column` test** → strengthened to deep-equal the whole task before/after
  (only `boardColumn` may differ — proves no state/JSONL churn).
- **🐛 Real bug the keyboard E2E surfaced:** Enter on a portaled ⋯-menu item bubbled
  (React propagates through the component tree, not the DOM tree) to the card's
  `onKeyDown` → navigated to the detail page. Fixed with an
  `ev.target === ev.currentTarget` guard; regression-tested in
  `TaskCard.keydown.test.tsx`.

## Confidence Calibration
- **Boundaries touched:** persisted schema (`sdk-sessions.json` v3→v4, additive
  `boardColumn`), public API (`ExternalTask` shape + new `POST /tasks/:id/column`;
  client/server union mirror), build (`@dnd-kit/core` dep), shared board infra
  (`TaskBoardPage`/new `TaskBoardColumns`), grandfathered files (net-LOC ≤ baseline).
- **Empirical probes run:** (1) schema round-trip — v3 file → load → patch → persist →
  reload asserts v4 + `boardColumn` survives, invalid value soft-drops
  (`sdk-sessions-store.boardcolumn.test.ts`, 7✓). (2) poll-no-snapback — `cancelQueries`
  on mutate proven by spy + optimistic-survives-in-flight test
  (`useExternalTasks.boardcolumn.test.ts`, 4✓). (3) `/column` mutates **only**
  `boardColumn` — deep-equal before/after (`routes.column.test.ts`, 11✓). (4) Real
  isolated-stack E2E — drag Backlog→In Progress persists across reload + keyboard menu
  move (2✓). (5) bloat hook — all grandfathered files ≤ baseline (sdk-sessions-store
  791/791, externalApi 862/863, TaskBoardPage 441/650, TaskCard 539/552).
- **Test Completeness Ledger:**
  | Behavior (AC) | Disposition | Evidence |
  |---|---|---|
  | AC-1 schema v4 + `boardColumn` validation + v1–v4 back-compat | tested | `sdk-sessions-store.boardcolumn.test.ts` (7), `schema-migration.test.ts` |
  | AC-2 `POST /column` (valid/invalid/404/409/idempotent/state-untouched) | tested | `routes.column.test.ts` (11) |
  | AC-3 grouping `boardColumn ?? deriveBoardColumn(state)` parity | tested | `boardColumnApi.test.ts`, `TaskBoardColumns.test.tsx` |
  | AC-4 drag persists across reload + poll (no snap-back) | tested | E2E drag scenario + `useExternalTasks.boardcolumn.test.ts` |
  | AC-5 Status↔Resume decoupled (live-in-Done keeps Resume; draft-in-IP keeps Launch) | tested | `TaskBoardColumns.test.tsx` + E2E |
  | AC-6 menu actions sync `boardColumn` (close/backlog/reopen) | tested | `routes.column.test.ts`, `routes.backlog/reopen.test.ts` |
  | AC-7 keyboard/touch/SR column move (accessible menu) | tested | `TaskCardMenu.test.tsx` + keyboard-driven E2E + `TaskBoardColumns.test.tsx` (a11y attrs) |
  | keydown-guard regression (menu Enter ≠ navigate) | tested | `TaskCard.keydown.test.tsx` |
  | touch-drag (press-hold) | untestable | `requires-physical-device` (TouchSensor delay; mouse+keyboard paths cover the logic) |

  0 testable-but-untested behaviors.
- **Confidence-pattern check:** Depth (asymptote) — server 135 files/1657✓, client
  170 files/1726✓, E2E 2✓, all green on fresh runs. Breadth (coverage) — schema,
  route, grouping, optimistic-race, decoupled-CTA, menu a11y, keydown-guard, back-compat
  all exercised. No `cross_component` machinery touched → no integration-coverage flag.
