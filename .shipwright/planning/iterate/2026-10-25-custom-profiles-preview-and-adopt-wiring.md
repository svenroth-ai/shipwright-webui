# Iterate Spec: custom-profiles-preview-and-adopt-wiring

- **Run ID:** iterate-2026-10-25-custom-profiles-preview-and-adopt-wiring
- **Type:** feature
- **Complexity:** medium
- **Status:** in-progress

## Goal
Follow-up to PR #534 (FR-01.75). Two gaps it left open: (1) a project that uses a custom stack profile gets no Preview button because the Preview gate and spawn read only the bundled snapshot; (2) the Adopt result screen is pure sample data, so the adopt snapshot's `profile.source` / `profile.warnings` (schema 1.1) are never shown.

## Acceptance Criteria
- [ ] AC1 A project whose profile is a project/user custom profile that declares `stack.frontend` and `dev_server.command` gets `preview.enabled` and can spawn Preview; the profile file is located by the shipwright resolver (`validate --json` reports its path), never by a re-implemented lookup.
- [ ] AC2 A custom profile the resolver reports invalid, a missing resolver, or an unreadable file yields no Preview (button hidden, spawn refused with `preview_profile_invalid`); bundled profiles behave exactly as before (including when the resolver is absent).
- [ ] AC3 A custom profile is untrusted input (a cloned repo can ship one). Only `command`, `port`, `ready_path`, `ready_timeout_seconds` are copied (no env/cwd). The file must lie inside the project's `.shipwright/profiles` or `~/.shipwright/profiles` after realpath (path.relative, symlink escape refused). For a PROJECT-source profile the executable must be a bare name from a runner allowlist (npm, npx, pnpm, yarn, bun, node, vite, next, python, python3, uv, deno) with no path separator and, for node/python, no inline-eval flag; user-source profiles may use any bare name or absolute path. The existing tokenizer + `shell:false` + `preview-session-manager` stay the only spawn path. Spawn re-resolves fresh (bypasses the cache).
- [ ] AC4 Resolver lookups are cached per project + profile name — successes AND failures (short TTL; success also re-validated by file mtime/existence) with in-flight dedupe and a global spawn concurrency cap — so the actions GET does not spawn a process per request. The GET never throws: any failure → `preview.enabled=false`. If the resolver is unavailable, bundled profiles fall back to the existing sync loader (unchanged behaviour).
- [ ] AC5 The Adopt result screen runs a real read-only scan (private mkdtemp output removed in `finally`, hard timeout with process-tree kill, size caps, one scan at a time, stale responses ignored when the repo changes, local-only/Origin guard confirmed, directory + realpath required, roots/home refused; analyzer discovered by newest installed version; warnings capped and stripped of control characters) of the chosen local repo (`analyze_codebase.py`, output redirected OUTSIDE the repo so "nothing has been written" stays true) and shows the detected profile with its source and any discovery warnings; while it loads, or if it is unavailable, the sample rows stay and the screen says so; a snapshot of an unknown major is refused.
- [ ] AC6 Real-browser proof: a custom profile declaring a dev_server shows the Preview button and starts a dev server.
- [ ] AC7 (pass = the run's recorded profile equals the wizard brief's name; if NO, record it and file a follow-up, do not block) Verified once for real: whether `/shipwright-run` honors the profile name the wizard puts in the brief (result reported, not assumed).

## Spec Impact
- **Classification:** modify
- **MODIFY:** FR-01.75 (two new bullets: Preview for custom profiles; live adopt profile row)
- **ADD / REMOVE:** none

## Out of Scope
- Making the rest of the Adopt rows (Routes, Tests, CI, Features...) live; they stay labelled sample.
- Writing/migrating profiles; any change to `project.profile` assignment.
- `ProjectManager.hasPreviewCapability` (sync hot path; the client reads `preview.enabled` from the actions endpoint, not `hasPreview`).

## Design Notes
New `core/custom-profile-loader.ts`: async `loadPreviewProfile(name, projectPath)` = resolver `validate` (path+source+valid) → containment check → read+parse → cached. Bundled source falls through to the existing sync loader unchanged. Adopt scan: new route `POST /api/adopt/scan` (body `{path}`) → `uv run --no-project analyze_codebase.py --project-root <path> --output <os tmp>`; shell:false, fixed argv, realpath on the path, timeout; returns the tolerant `readSnapshotProfile` shape only.

## Affected Boundaries
| Producer | Consumer | Format |
|---|---|---|
| resolver `validate --json` (path, source, valid) | `custom-profile-loader.ts` | JSON |
| custom profile file (untrusted) | `preview-session-manager` tokenizer | `dev_server.command` string |
| `analyze_codebase.py` snapshot 1.1 | `/api/adopt/scan` → `readSnapshotProfile` | JSON schema_version 1.x |

## Confidence Calibration
- **Boundaries touched:** the three rows above.
- **Empirical probes run:** real `validate --json` against a project profile with dev_server; real `analyze_codebase.py --output` run on a temp repo to confirm nothing is written inside it.
- **Test Completeness Ledger:** see F5 block.
- **Confidence-pattern check:** unit (loader cache/containment/fallbacks, route, reader) + real-browser Preview E2E.

## Verification (medium+)
- **Surface:** web
- **Runner command:** to be fixed at E2E authoring (isolated-stack harness)
- **Evidence path:** client/e2e output

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** Bridge is right but tokenizer + shell:false is not enough for an untrusted dev_server.command.
- **Findings:** security/high command trust → fixed (project-source runner allowlist, bare names, no eval flags); security/high repo-relative binaries → fixed (no path separators for project source); security/medium extra profile fields → fixed (field allowlist); medium TOCTOU → fixed (fresh re-resolve at spawn, read once); medium name/cwd hygiene → fixed (shape-checked names, neutral cwd, `-I`); medium /api/adopt/scan guards → fixed (AC5); medium Windows tree-kill + tmp → fixed (AC5); medium negative cache + concurrency → fixed (AC4); medium async loader ripple → fixed (grep all consumers; hasPreviewCapability divergence documented + tested); medium unknown sources → fixed (whitelist); low analyzer version/rendering → fixed; low test gaps → fixed (negative tests required).
- **Known limitations:** a runner such as `npm run x` still executes repo scripts — identical to the bundled profiles' `npm run dev` today.
- **Status:** 12 fixed, 0 declined

## Internal Architecture Review (architecture-internal-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Option 1 right for Preview; the adopt scan is the least justified addition.
- **Findings:** smallest-option/medium split adopt scan out → declined (operator asked for both in one iterate); security/medium trust gate → mitigated by the allowlist (a per-command confirmation dialog declined: Preview already runs repo scripts for bundled profiles); security/low tmp/guard → fixed; complexity/medium resolver contract skew → fixed (pinned `validate --json` fixture, fail closed); completeness/low AC7 fallback + spawn-time re-read → fixed.
- **Known limitations:** none beyond the above.
- **Status:** 3 fixed, 1 mitigated, 1 declined

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-10-25-custom-profiles-preview-and-adopt-wiring/architecture_brief.md`
- **Verdicts:** glm=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed
- **Findings:** none
- **Reconciliation:** nothing had been rejected in the mini-plan that the reviewers re-proposed.

## External Plan Review
- glm=revise, openai=revise. Accepted and fixed: negative cache; async-loader ripple (grep all consumers); adopt-scan exposure (guards in AC5); reason kept internally per failure class; containment tests incl. Windows case; distinguishable `unavailable` vs `error`; AC7 follow-up. HIGH (openai): "any failure → null" broke bundled-without-resolver → fixed (fallback to sync loader when the resolver is unavailable). Medium: cache revalidation + shadowing → TTL + re-resolve at spawn; stale scan response → request token ignored when path changed; E2E must prove the dev server really answers, and unknown-major refusal tested.
