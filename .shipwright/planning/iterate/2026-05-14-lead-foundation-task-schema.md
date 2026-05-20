# Iterate Spec: lead-foundation-task-schema

- **Run ID:** iterate-20260514-lead-foundation-task-schema
- **Type:** feature
- **Complexity:** small (safety-floor pulled in by `touches_io_boundary`)
- **Status:** draft
- **Branch:** `iterate/lead-foundation-task-schema` (worktree `.worktrees/lead-foundation-task-schema`)
- **Source-of-truth spec:** `C:/Users/you/projects/leadwright/docs/specs/phase-1-external-task-extension.md`
- **Cross-repo handoff:** `C:/Users/you/projects/shipwright/.shipwright/agent_docs/triage-remaining-iterates-handoff.md`

## Goal

Extend the persisted `ExternalTask` record in `sdk-sessions.json` with 13 optional fields so the leadwright daemon (separate repo) can route, prioritize, claim, and audit tasks the webui already owns. **Additive only** — `schemaVersion` stays at 3; legacy v1/v2/v3 rows continue loading; new fields flush on next mutation per the existing write-on-touch contract (ADR-038/044).

## Acceptance Criteria

- [ ] **AC-1** — `server/src/core/sdk-sessions-store.ts` `ExternalTask` interface gains 13 optional fields with EXACT names and shapes (locked in handoff):
  - `domain?: string`
  - `priority?: "P0" | "P1" | "P2" | "P3"`
  - `complexityHint?: "small" | "medium" | "large"`
  - `tags?: string[]`
  - `blockedBy?: string[]`
  - `leadParentTaskId?: string`
  - `poFeedback?: string`
  - `claimToken?: string`
  - `claimedBy?: string`
  - `claimedAt?: string`
  - `claimPid?: number`
  - `leadHandoff?: { leadId: string; status: "completed" | "escalated" | "failed"; beatsUsed: number; subIterateIds?: string[]; summary: string; escalationReason?: string; learningsExtracted?: boolean }`
  - `promotedFromTriageId?: string`

  `schemaVersion` stays at 3. The `validateExternalTask` schema validator preserves every field through a write→read round-trip. Bad shapes (non-string `priority`, non-array `tags`, malformed `leadHandoff` sub-object) are **soft-dropped on the individual field**, not the whole row (mirrors the existing forward-compat tolerance for `phaseTaskId` / `runId` / `parentRunMaster`).

- [ ] **AC-2** — `server/src/config/default-actions.json` `new-task` and `new-iterate` actions add `domain`, `priority`, `complexityHint`, `tags`, `blockedBy` to their `modal_fields` arrays. `server/src/core/actions-schema-validator.ts` `SUPPORTED_MODAL_FIELDS` allowlist gains the same 5 names. `poFeedback` is **NOT** in the create-modal allowlist (TaskDetail-only — out of scope for the modal portion of this iterate).

- [ ] **AC-3** — `server/src/external/routes.ts` POST `/api/external/tasks/:id/launch` rejects with HTTP 409 `{ error: "task_claimed", claimedBy, claimedAt }` when `task.claimToken != null`. ~5 LOC inserted between the `task.state === "done"` guard and the action-resolution branch. User-level launches don't fight a leadwright daemon claim. (Resume / phase-task launches obey the same guard — the claim is task-wide, not action-specific.)

- [ ] **AC-4** — `client/src/components/external/MasterTaskCard.tsx` renders:
  - Priority badge (`P0..P3`) with color coding: P0=red, P1=orange, P2=yellow, P3=slate. Renders only when `task.priority` is set. Color comes from existing token aliases where possible; no new design tokens.
  - Domain chip: text-only (`task.domain`), neutral background, no resolver. Renders only when `task.domain` is non-empty.
  - `blockedBy` indicator (one row, leftward of priority badge): ✓ all done / ⏳ N pending / ❌ failed blocker. Resolves blocker ids via the existing task list lookup the card already has (`allTasks` prop or sibling). When no `blockedBy` → indicator absent.
  - All three additions are **read-only display** — no actions on the card change.

- [ ] **AC-5** — `client/src/components/external/CreateMenuSplitButton.tsx` + `NewIssueModal.tsx` add form inputs for the 5 new modal-field names (AC-2 list). Inputs render conditionally on `action.modal_fields?.includes("<name>")` — actions without the field in their `modal_fields` array hide the input (so `new-pipeline` / `new-plain` / custom actions get the original UI). Existing UI primitives (Radix DropdownMenu for enums, native `<input>` for free-text) — no new dependencies. Values flow through `createTask({ ... })` → server POST `/api/external/tasks` → `store.create()` → persist. The launch route accepts the same fields and `Object.assign`s them onto the task in `taskUpdate`.

- [ ] **AC-6** — Tests:
  - **Server, schema round-trip** (`sdk-sessions-store.test.ts`): persist a task with all 13 new fields → reload from disk → every field present and identical. Plus a corruption test: bad `priority` value → field dropped, rest of row preserved.
  - **Server, launch claim filter** (`routes.test.ts` or new spec): task with `claimToken` set returns 409 `task_claimed` on POST /launch; task without `claimToken` still launches normally.
  - **Server, modal_fields allowlist** (`action-schema-validation.test.ts`): the 5 new field names are accepted; an unrelated stray name (`"complexity:radio:..."`) still fails as before.
  - **Client, modal render** (`NewIssueModal.test.tsx`): `new-task` and `new-iterate` modes render the 5 new field inputs; `new-pipeline` and `new-plain` modes do not.
  - **Client, MasterTaskCard render** (`MasterTaskCard.test.tsx`): priority badge present when `priority` set, absent when undefined; domain chip likewise; blockedBy indicator shows ✓ / ⏳N / ❌ based on the resolved-blocker state.

## Affected FRs

- **FR-01.08** Task list / create — body shape extended to accept the 5 modal fields + (test-only) `priority`/`domain`/`complexityHint`/`tags`/`blockedBy`. Additive; legacy POST bodies still succeed.
- **FR-01.10** Launch copy-command — new 409 `task_claimed` error code when `claimToken` is set on the task. Additive failure mode; happy-path is unchanged.
- **FR-01.16** Resolved action catalog — `new-task` and `new-iterate` `modal_fields` array now includes the 5 leadwright fields. No behavior change for projects that don't override these actions; projects with custom actions get the union (preserved by existing override semantics).
- **FR-01.01** Task board — MasterTaskCard rendering adds 3 display elements; no API or state change.

## Out of Scope

- The leadwright daemon itself (lives in `leadwright/` Sub-Iterate 2.3)
- `leadwright/lib/lead-task-claim.ts` compare-and-swap helper (separate leadwright-repo iterate)
- Lead-Inventory page in webui (Phase 3 of leadwright plan)
- Goal-cascading resolver via `leadParentTaskId` (v2)
- `promotedFromTriageId` producer / promote endpoint (Iterate 3 in shipwright planning)
- `poFeedback` editor UI on TaskDetail (deferred — the field is declared in the schema for daemon use; user-facing editor is a separate iterate)
- Any `schemaVersion` bump
- Batch-rewrite of disk rows on boot (explicitly rejected by ADR-038)

## Design Notes

No mockup change — the modal already has a "stack two-column grid" layout below the title field. New inputs occupy that grid:
- `domain` — native `<input type="text">` placeholder "shipwright"
- `priority` — Radix DropdownMenu with 4 entries P0..P3 (no default; empty = unset)
- `complexityHint` — Radix DropdownMenu with 3 entries small/medium/large (no default)
- `tags` — native `<input type="text">` placeholder "auth, billing", comma-split on submit (`s.split(",").map(s=>s.trim()).filter(Boolean)`)
- `blockedBy` — native `<input type="text">` placeholder "task-id, task-id", same split

MasterTaskCard tokens reuse existing palette (no new tokens):
- Priority badges: `bg-red-100 text-red-700` / `bg-orange-100 text-orange-700` / `bg-yellow-100 text-yellow-800` / `bg-slate-100 text-slate-600`
- Domain chip: `bg-stone-100 text-stone-700`
- blockedBy indicator: ✓ green-700 / ⏳ amber-700 / ❌ red-700, inline icons from `lucide-react` (CheckCircle2 / Clock / XCircle — all already imported elsewhere in the component tree)

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/core/sdk-sessions-store.ts` `SdkSessionsStore.persist()` | `server/src/core/sdk-sessions-store.ts` `validateExternalTask` (load path) | `<registryDir>/sdk-sessions.json` (JSON, schemaVersion 3, write-on-touch) |
| `server/src/external/routes.ts` POST `/api/external/tasks` (calls `store.create()`) | `server/src/core/sdk-sessions-store.ts` `create()` → in-memory record → next `persist()` | Same file as above; in-memory shape must round-trip through disk |
| `server/src/external/routes.ts` POST `/api/external/tasks/:id/launch` (calls `store.patch()`) | Same | Same — `taskUpdate` Object.assign'd then persisted |

Single producer / single consumer (the store itself is the only writer + reader); duplicated-parser drift-protection is not applicable.

## Confidence Calibration

- **Boundaries touched:** `sdk-sessions.json` ExternalTask producer (`SdkSessionsStore.persist()`) ↔ consumer (`validateExternalTask`).

- **Empirical probes run** (vitest, all GREEN):
  1. **Round-trip with all 13 new fields** — `sdk-sessions-store.test.ts` "persists ALL 13 leadwright fields and loads them back identically" — every field preserved equal-by-deep-equal incl. nested `leadHandoff`.
  2. **Omitted-key persistence** — "omits absent optional leadwright fields from the persisted JSON" asserts NO `"domain"`/`"priority"`/`"leadHandoff"`/etc. keys appear in the on-disk JSON when the create caller didn't pass them. Avoids `"x": null` noise (external review LOW-9).
  3. **Empty array survives** — "preserves an empty tags array" — `tags: []` round-trips as `[]`, NOT `undefined`.
  4. **leadHandoff partial** — "preserves a leadHandoff with no optional sub-fields" — partial sub-object survives; absent optional keys stay absent.
  5. **JSON edge characters** — "round-trips JSON-edge characters in free-text fields" — commas/newlines/quotes/emoji/escaped HTML inside `domain` / `tags` / `poFeedback` / `leadHandoff.summary` / `leadHandoff.escalationReason` all preserved.
  6. **Soft-drop priority enum** — "drops priority when value is not in the P0..P3 set" + "drops priority when value is not a string" — bad value drops, rest of row survives.
  7. **Soft-drop complexityHint enum** — same shape.
  8. **Soft-drop tags/blockedBy shape** — "drops tags / blockedBy when value is not an array of strings" — `tags: "string"` drops; mixed-type array filters to strings only.
  9. **Soft-drop leadHandoff** — "drops the whole leadHandoff when status is not in the enum" + "drops the whole leadHandoff when required leadId is missing" — atomic field-level drop.
  10. **Soft-drop claimPid type** — "drops claimPid when not a number".
  11. **v1 forward-compat** — "tolerates leadwright fields on a v1 row" — v1 row carrying new fields still loads with them preserved (rollback safety).
  12. **HTTP-level round-trip** — `routes.test.ts` "POST /tasks accepts the 5 lead-foundation modal fields and round-trips them via GET" + "soft-drops malformed tags / blockedBy / priority shapes" — proves the route layer surfaces what `store.create()` persists.
  13. **HTTP-level write-surface narrowing** — "POST /tasks ignores daemon-only fields" — POSTing `claimToken: "tok-injected"` is silently dropped (external review MED-4).
  14. **Claim-guard happy + sad paths** — "POST /launch returns 409 task_claimed when claimToken is set" + "ignores claimedBy / claimedAt without claimToken" — only `claimToken` triggers.
  15. **Launch allowlist** — "POST /launch with an unrelated body key does not mutate task fields beyond the allowlist" — `claimToken: "injected"` in launch body cannot promote the task to claimed.
  16. **Modal opt-in rendering** — `NewIssueModal.test.tsx` "renders all 5 leadwright inputs on new-task when modal_fields opts in" + "hides every leadwright input on new-pipeline" + "hides individual inputs whose name is not in modal_fields".
  17. **Modal submission payload** — "Save-to-Backlog: leadwright values land in POST /tasks body (normalized)" — `tags` is `["auth", "billing", "empty-trims"]` after comma-split + trim + filter-empty.
  18. **Modal empty omission** — "omits empty leadwright fields from the POST body" — keys absent from the POST body, not `domain: ""`.
  19. **MasterTaskCard XSS-safety** — "renders the domain chip as plain text (no HTML injection)" — `<script>alert('xss')</script>` renders as text, not a DOM element (external review MED-5).
  20. **MasterTaskCard blockedBy semantics** — 4 separate tests cover ✓-all-done / ⏳N-pending / ❌-failed / unknown-counts-as-pending / duplicates-deduped (external review MED-6).
  21. **MasterTaskCard master-shadow source** — "ignores non-master shadows for the badge data source" — only ExternalTasks with `parentRunMaster===true && runId===config.runId` source the header badges.

- **Edge cases NOT probed + why acceptable:**
  - POSIX-`export` syntax / inline `# comments`: file is machine-only JSON, not user-edited. Categories 5-8 of `boundary-probes.md` (operator input) do not apply.
  - Concurrent multi-writer: store already uses `proper-lockfile` (ADR-035 guard #6); orthogonal to schema shape.
  - Massive `tags` / `blockedBy` arrays: no caller-side cap added in this iterate (the daemon claim helper is the natural choke point, and lives in leadwright). Will add a soft cap if the external review flags it.

- **Confidence-pattern check:** none of the 8 probes are predicate questions ("are you sure?"); they're empirical round-trips. The asymptote heuristic does not apply until a probe finds a bug.

## Verification (F0.5)

- **Surface:** `cli`
- **Runner command:** `npx --prefix client vitest run client/src/components/external/MasterTaskCard.test.tsx client/src/components/external/NewIssueModal.test.tsx && npx --prefix server vitest run server/src/core/sdk-sessions-store.test.ts server/src/external/actions-schema-validation.test.ts server/src/external/routes.test.ts`
  - Windows note: invoked via `surface_verification.py`, which routes through `npm.cmd` (per conventions.md learning, 2026-05-09).
- **Evidence path:** vitest text logs aggregated into `.shipwright/runs/<run_id>/surface_verification.json`.
- **Justification (if surface=none):** n/a — every AC is verifiable via the existing vitest suites in both workspaces.

## DO-NOT regression-guards review (pre-build)

Walking the live `conventions.md` checklist:

1. **Webui never spawns Claude** — n/a (no launcher change beyond a 409 guard).
2. **Auto-scroll CSS-first** — n/a (no transcript change).
3. **No chat composer** — n/a.
4. **No `@assistant-ui/*`** — n/a.
5. **No `claude --resume` as side effect** — n/a.
6. **`proper-lockfile` for multi-writer state** — preserved (additive fields flow through existing `persist()` call which already locks).
7. **No cross-package imports** — preserved (server keeps types under `server/src/types/`; this iterate adds inline duplicated fields in `sdk-sessions-store.ts`, NOT imports of leadwright types per the handoff "duplicate inline" decision).
8. **Schema v2/v3 write-on-touch** — preserved (no schemaVersion bump; new fields are optional).
9. **Preview spawn `shell: false`** — n/a.
10. **Path-guard `realpath`** — n/a.
11. **No hardcoded `shipwright-*` / phase literals in components** — preserved (new modal inputs render off `action.modal_fields?.includes(...)`, not a literal action-id check).
12. **No writes to `shipwright_run_config.json`** — preserved.
13. **Phase-task launches use pre-bound sessionUuid** — preserved (claim guard is checked before either branch).
14. **`useContinuePipeline()` is single pipeline-continuation entry** — n/a.
15. **Schema v3 additive + write-on-touch** — directly extended in the same pattern.
16. **Stale `in_progress` detection from run-config timestamps** — n/a.
17. **pty-manager whitelist** — n/a.

## Open questions

None — every shape is locked in the handoff. The one judgment call (whether `priority` deserves a comment update on `NewIssueModal.tsx` line 14: "NO priority field anywhere (FR-03.21 regression)") is settled by adding a one-line "lead-foundation overrides this for daemon-routed tasks" amendment to that header comment.
