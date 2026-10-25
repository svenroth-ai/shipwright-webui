# Mini-plan: custom-stack-profiles-ui (written retroactively; reviewed against the built design)

## Approach (chosen)
1. Server bridge `core/stack-profiles.ts`: `uv run --no-project --python >=3.11 resolve_profile.py list|validate --json`, shell:false, fixed argv, contract_version pinned (refuse unknown major), shape-checked entries, honest engine-unavailable. Verbatim mirror types (no cross-package import).
2. Routes `/api/stack-profiles` (GET list, POST validate, POST create-from-bundled) mounted through the existing `createProfilesRoutes` so `index.ts` (over the bloat limit) does not grow.
3. Write surface (only one): copy a bundled profile under a NEW name into `~/.shipwright/profiles` or `<project>/.shipwright/profiles`; name must match the resolver's NAME_RE, be reserved-free and unused in EVERY source; `wx` open; resolver-validated; removed only on a definite invalid verdict; realpath containment for the project dir.
4. Settings card: list by source, validity, warnings, per-profile Check, create form.
5. Wizard: one explained question after the idea, only when the user has own profiles; choosing one skips remember/where; reducer step math via `activeQuestions`/`planStep`; list fetched when the wizard opens; a vanished/invalid chosen profile is dropped.
6. Adopt snapshot 1.1: tolerant reader for profile.source/warnings.

## Alternative rejected
Reading `~/.shipwright/profiles` directly from Node: duplicates the resolver's lookup order, shadowing and schema rules, and drifts silently from what the phases later read.

## Risks
Resolver latency (uv spawn ~1s) vs. wizard flow; cross-repo contract drift; file creation in a user's project tree.
