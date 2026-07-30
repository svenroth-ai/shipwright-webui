# Mini-plan — iterate-2026-07-18-mission-s1-resolver-core-artifacts

Campaign `2026-07-18-mission-artifacts`, sub-iterate **S1** (serial #1 of 3).
change_type=feature · spec_impact=modify · affected_frs=[FR-01.66] · complexity=medium.

## Problem

The Mission tab shows a standing **"No run data yet"** for a standalone iterate session.
Root cause: every Mission data path joins on the generic `task.runId` (shape `run-xxxxxxxx`,
pipeline semantics), which a standalone iterate never has. The bridge that *does* carry the
iterate identity — `.shipwright/iterate_active/<sessionUuid>.json`, written by the shared
`worktree_isolation.py::write_run_pointer` — has **zero readers** in webui today.

Consequences visible to the user: no Spec, no Requirement, no Commit artifact; the top-right
**Tests** and **Serves** chips render `—` on every iterate because `useRunDetail(task.runId)`
is called with `null`.

## Approach

A server-side **mission-context resolver** that detects the session scenario, joins by the
pointer's own `run_id` (never overloading `task.runId`), and returns a versioned
`MissionContext`. The client renders from the returned discriminator.

### Server (`server/src/core/mission-context/*`)

| Module | Responsibility |
|---|---|
| `types.ts` | `MissionContext`, `ArtifactDescriptor` (discriminated), 5-state `ArtifactState`, `MissionContextAssociation` |
| `pointer.ts` | Read + **validate** `iterate_active/<uuid>.json` as untrusted input (§5.1 a/b/e) + strict run_id/slug grammar |
| `worktree-roots.ts` | `git worktree list --porcelain` (arg-array, `shell:false`) → allowed read-roots; `resolveDoc` = pathGuard + realPathGuard against the **chosen** root |
| `fold-map.ts` | Parse `spec.md` `## FR-Fold-Map` + the FR table → folded id → surviving parent (+ name/area) |
| `merge-check.ts` | Bounded-int PR# → `git log origin/main --grep "(#NNN)"` (arg-array, `shell:false`), asymmetric cache |
| `scenario.ts` | The §4 ordered precedence table |
| `artifacts.ts` | Spec · Requirement · Commit descriptors from the `run_id` join |
| `resolver.ts` | Orchestration + `{projectRoot, sessionUuid, sourceRev}` cache + the ONE guarded association write |
| `doc-ids.ts` | Opaque artifact/document ids (HMAC, per-process secret) — the client never builds `/file?path=` |

### Route (`server/src/external/mission-context/routes.ts`)

- `GET /api/external/tasks/:taskId/mission-context` — metadata only.
- `GET /api/external/tasks/:taskId/mission-context/documents/:documentId` — opaque-id doc body;
  re-validates project/session/run ownership + `sourceRev` at read time (`stale` when moved).

### Client

`useMissionContext` (lower cadence than the 1 s transcript poll) → `missionArtifacts.ts` view
mapping (5-state; hide only `not_applicable`/`not_yet_created`) → `ArtifactPanel` two-region
(summary over `DocumentMarkdown`) + `Instruments` Tests/Serves rewired to the resolver.

## Guardrail compliance

- **No `task.runId` overload** — the association is a typed `task.missionContext`.
- **One write only** — idempotent compare-and-set under `proper-lockfile`, on the first valid
  **live** resolve. Never a per-GET side-effect (closes the pruned-pointer data-loss).
- **Merge check never reaches a shell** — `execFile` arg-array, PR# gated on `/^\d+$/`,
  `origin/main` (squash-aware `--grep`, never `--is-ancestor`).
- **Read-roots = project root ∪ `git worktree list` members** — a relocated worktree lives
  outside the project root (verified case); membership, never filesystem containment.
- Terminal zero-diff; `TaskDetailPage.tsx` not grown; every new file ≤300 LOC.

## Empirical findings that shaped the design (verified on this repo, 2026-07-18)

1. **`iterates/<run_id>.json` carries `affected_frs` in only 1 of 59 files.** The CONTRACT
   calls this source "verified"; it is correct but nearly always absent. → the `work_completed`
   fallback (130 of 210 iterate-keyed rows) is the *primary* path in practice, not the backup.
2. **`work_completed.commit` is non-empty in only 49 of 210 iterate rows** (most are `""`).
   → Commit resolves to `not_yet_created` far more often than the CONTRACT implies; the 5-state
   model carries this honestly rather than fabricating.
3. **`affected_frs` is often JSON `null`, not absent** — the reader's `asStringArray` already
   normalizes to `[]`.

## Risks

- Scenario misdetection resurrecting Mission on a custom-actions project → precedence unit table.
- A stale/hostile pointer reading outside the repo → membership + realPathGuard, both tested.
- Cache staleness after Finalize → `sourceRev` from source mtimes; pending-merge TTL re-check.
