# Mini-Plan: lead-foundation-task-schema

- **Run ID:** iterate-20260514-lead-foundation-task-schema
- **Spec:** `.shipwright/planning/iterate/2026-05-14-lead-foundation-task-schema.md`

## Approach

Five disjoint surface areas — server schema / actions config / launch route / client modal / client task card — touched in TDD order: RED tests first per AC, then GREEN. Single feature branch, single PR. **Branched from `origin/main`** (worktree `.worktrees/lead-foundation-task-schema`); the parallel terminal-fix session on `iterate/codex-rescue-altscreen-rendering` is untouched.

## Files to change

| Area | File | Change | LOC est. |
|---|---|---|---|
| Server type | `server/src/core/sdk-sessions-store.ts` | Extend `ExternalTask` interface with 13 optional fields; extend `validateExternalTask` with soft-drop per-field tolerance; extend `create()` args to accept the 5 modal fields and the daemon-side fields | ~80 |
| Server schema | `server/src/core/actions-schema-validator.ts` | Add `domain`, `priority`, `complexityHint`, `tags`, `blockedBy` to `SUPPORTED_MODAL_FIELDS` | ~5 |
| Server config | `server/src/config/default-actions.json` | Add the five names to `new-task` + `new-iterate` `modal_fields` arrays | ~2 |
| Server route | `server/src/external/routes.ts` | (a) extend POST /tasks body parsing to read + forward the 5 modal fields; (b) extend POST /tasks/:id/launch with the `claimToken` guard | ~30 |
| Client type | `client/src/types/Task.ts` (verbatim mirror of server type per ADR-080) and `client/src/lib/externalApi.ts` if needed | Extend `Task` mirror with the same 13 fields; `createTask()` signature extended | ~30 |
| Client modal | `client/src/components/external/NewIssueModal.tsx` | (a) state hooks for the 5 fields; (b) gated rendering against `action.modal_fields?.includes(...)`; (c) forward to `createTask()`; (d) update header comment about FR-03.21 priority ban | ~70 |
| Client card | `client/src/components/external/MasterTaskCard.tsx` | Priority badge + domain chip + blockedBy indicator (display-only) | ~50 |
| Tests | `server/src/core/sdk-sessions-store.test.ts` | Round-trip + bad-shape soft-drop tests | ~80 |
| Tests | `server/src/external/routes.test.ts` | Claim-guard 409 + happy-path POST /tasks with new fields | ~50 |
| Tests | `server/src/external/actions-schema-validation.test.ts` | 5 new modal-field names accepted; stray rejected | ~10 |
| Tests | `client/src/components/external/NewIssueModal.test.tsx` | Renders 5 inputs in new-task / new-iterate; hidden in new-pipeline / new-plain | ~70 |
| Tests | `client/src/components/external/MasterTaskCard.test.tsx` | Priority badge + domain chip + blockedBy indicator render correctly | ~60 |

Total: ~537 LOC across 10 files. All additive (no deletions). Files stay well under the 300-line cap.

## Test strategy

1. **RED** — write all tests first; run `vitest` in both workspaces; expect new tests to fail (`ExternalTask.priority` etc. don't compile, `validateExternalTask` doesn't preserve fields, `routes` doesn't 409 on claim, modal doesn't render inputs, card doesn't render badges).
2. **GREEN — server-schema** — Edit `sdk-sessions-store.ts` interface + validator + create() signature. Run server tests. Expect green for AC-1.
3. **GREEN — actions** — Edit `actions-schema-validator.ts` + `default-actions.json`. Run server tests. Expect green for AC-2.
4. **GREEN — routes** — Edit `external/routes.ts` POST /tasks (read body fields → store.create) + POST /launch (claim guard). Run server tests. Expect green for AC-3 + AC-6 happy path.
5. **GREEN — client types** — Edit `client/src/types/Task.ts` mirror + `externalApi.ts`. Run `npx tsc --noEmit` in client. No new errors.
6. **GREEN — client modal** — Edit `NewIssueModal.tsx`. Run client tests. Expect green for AC-5.
7. **GREEN — client card** — Edit `MasterTaskCard.tsx`. Run client tests. Expect green for AC-4.
8. **F0 fresh gate** — full vitest in both workspaces + `tsc --noEmit` in both.
9. **F0.5 surface=cli** — run the targeted vitest selection via `surface_verification.py` so the run lands in `surface_verification.json`.

## Alternative considered

**Alt: stand up a parallel `LeadwrightTask` interface alongside `ExternalTask`** — Rejected. The spec's "Open questions" already evaluated this and chose inline duplication for v1; adding a parallel interface would create a synchronization point the handoff explicitly wanted to avoid. Inline fields keep the surface tiny and let the daemon adopt them incrementally.

**Alt: ship `poFeedback` UI editor in this iterate** — Rejected. Out of scope per handoff AC-2 ("`poFeedback` stays on the TaskDetail view, NOT in the create modal") + AC list does not include a TaskDetail UI for editing it. Field is declared so the daemon can read it; user-facing editor is a separate iterate.

**Alt: bump `schemaVersion` to 4** — Rejected. Handoff and spec both lock "schemaVersion stays 3. additive only." A bump would force batch-rewrite-on-boot (already rejected by ADR-038) or trigger the loader's "future-version → start empty" branch which would lose every task on rollback.

## Sequencing risk

The terminal-fix parallel session on `iterate/codex-rescue-altscreen-rendering` touches `client/src/components/terminal/EmbeddedTerminal.tsx` only. My touchpoints (NewIssueModal, MasterTaskCard, sdk-sessions-store, routes, default-actions) are disjoint. CHANGELOG drop files are file-per-iterate per the `CHANGELOG-unreleased.d/` pattern, so no rebase conflict there. The iterate_history file is also per-run-id. Merge conflict is unlikely.

## Stop-points

- After RED phase if any test setup fails non-trivially → re-investigate.
- After server build is green but client tests still red → don't push; finish client first.
- External LLM review surfaces HIGH → fix inline before commit (per handoff).
- F0.5 fails → STOP. Don't proceed to F1.
