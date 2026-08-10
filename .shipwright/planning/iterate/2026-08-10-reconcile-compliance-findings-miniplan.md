# Mini-Plan: reconcile-compliance-findings

Run ID: iterate-2026-08-10-reconcile-compliance-findings · Type: change · Complexity: small

## Chosen approach — reconcile only current audit evidence

Use the fresh `origin/main` worktree as the authority. Backfill only the two
commits that B7 still reports, register only the five scopes that G2 reports,
and update the bloat baseline to the exact audited line counts. Reduce the
always-loaded guide without moving or weakening any guard.

### Files and records

1. `shipwright_events.jsonl` — append two schema-valid B7 backfill events: the
   v0.24.0 release commit and the CodeQL v4 CI correction.
2. `audit_config.json` — add `gitignore`, `spawn`, `repo`, `mermaid`, and
   `first-contact` to the G2 stoplist.
3. `shipwright_bloat_baseline.json` — grandfather the four H1 files at their
   observed line counts and tighten the three existing H2 counts.
4. `CLAUDE.md` — condense the shared-vocabulary pointer below 200 lines while
   preserving its mandatory glossary link.

## Verification

- Read-only B/F/G/H audit detects B7, F6, G2, H1, and H2 as passing after the
  changes.
- JSON parsing confirms both configuration files remain valid.
- The documented focused checks and the final project verification pass.

## Alternative considered — split the four H1 files

Rejected: each exceeds the limit only slightly and this compliance-only task
does not have evidence for safe cohesive extractions. The existing policy and
ADR-232 prefer explicit grandfathering for this case.
