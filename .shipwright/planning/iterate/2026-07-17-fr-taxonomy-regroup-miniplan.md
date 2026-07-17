# Mini-Plan: fr-taxonomy-regroup

## Approach (chosen)
Atomic, in-place restructure of the single FR table + a new Fold-Map section + a bounded live-reference remap — all in one commit so traceability never goes red mid-way.

**Order:**
1. **Probe/enumerate** — grep every LIVE reference to the 37 folded IDs across `client/`, `server/`, `plan.md`, `architecture.md` (exclude events.jsonl, CHANGELOG*, Spec/prototype/**). Produce the exact remap list (folded ID → survivor target). Snapshot `doc-sync.test.ts` + traceability baselines.
2. **Rewrite the FR table** — insert `Area` column + 14 area section-headers; reorder the 29 survivors under their area; rename each survivor to capability altitude (strip GET/POST/ADR/slug from Name → move to Origin/Description); fold each endpoint FR into an `Interfaces:` bullet in its survivor's Description; fold each delta FR into an AC line under its survivor (preserve `(iterate-…)` tags verbatim); delete the 37 folded rows.
3. **Add `## FR-Fold-Map`** — one row per folded ID → survivor + reason {endpoint|delta|dup}.
4. **Remap the 68 test-file tags** (folded ID → survivor) so traceability has 0 orphans; **leave the 104 non-test source-comment provenance refs in place** (Fold-Map-resolvable, finer-grained than the umbrella). Add the `## How to read & extend this spec` taxonomy section documenting this. (If the traceability audit also flags source comments as orphans — verified in probe 1 — remap those too.)
5. **Green the meta-tests** — `doc-sync.test.ts`, compliance traceability audit, `npm run build && npm run test` both workspaces.
6. **Finalization** F0–F11 (surface=none, justified).

## Alternative considered (rejected)
**Full renumber to `FR-AREA-nn` + alias table + rewrite all refs incl. event log.** Rejected: `FR-01.NN` is referenced ~1964× incl. 246× in the append-only `shipwright_events.jsonl` the Mission view reads; rewriting the audit trail is wrong, and not rewriting it desyncs new IDs from history. Stable IDs + Fold-Map is the safe equivalent. (Design doc §1.3.)

## Risks
- **Concurrent Mission-Control rebuild** touches the same spec.md (FRs 54–67 fold into 66). Mitigation: F11 `ensure_current` rebases; folds are conservative (content preserved as AC). If a concurrent iterate lands a new Mission FR first, resolve in F11.
- **Orphan traceability** if a folded-ID reference is missed. Mitigation: probe-1 re-grep gate (0 hits) before commit.
- **Fold-target judgment** (e.g. 37 slash_command stays a survivor; 40 folds into 37). Locked in the survivor list; targets decided in step 2 with the design-doc §3 mapping.
