# Iterate Spec: grade-uv-run

- **Run ID:** iterate-2026-08-26-grade-uv-run
- **Type:** bug
- **Complexity:** medium
- **Status:** draft

## Goal
`/api/wizard/grade` (and the triage write bridge) spawn a bare, unversioned
system Python (`resolvePython`'s python3→python→py probe) instead of `uv run`
— so on a machine whose ambient interpreter lacks `defusedxml` / Python 3.11+
(reported: macOS `/usr/bin/python3` 3.9.6), grade.py dies with
`ModuleNotFoundError: No module named 'defusedxml'` in ~110ms while the route
still returns HTTP 200 (`{"status":"grade-failed", ...}`), and `/api/readiness`
reports Python green the entire time because ITS OWN fallback (uv-managed
Python) never gets consulted by the actual spawn. Fix both call sites to run
through `uv run` in the plugin's own declared environment, and close the
regression class with a source-scan guard.

## Acceptance Criteria
- [x] `grade-runner.ts` spawns `grade.py` via `uv run --project <plugin-root>
      <absolute-script-path> --format json -- <target>`, never a bare
      resolved python binary.
- [x] `triage-cli-runner.ts` spawns `triage_cli.py` via `uv run --python
      ">=3.11" <absolute-script-path> ...` (no `pyproject.toml` in scope, so
      `--project` does not apply — verified against the real script).
- [x] uv missing → an honest `engine-unavailable` with the existing repair
      command, in BOTH call sites — never a silent fallback to system python.
- [x] `SHIPWRIGHT_GRADE_COMPLIANCE_ROOT` still reaches grade.py's env under
      `uv run` (uv inherits/extends the given env; the compliance root is
      layered onto the same env object handed to the spawn).
- [x] Regression guard: no call site under `server/src/` may resolve a raw
      python binary and spawn it directly (source-scan meta-test).

## Spec Impact
- **Classification:** none
- **ADD:** none
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** No FR describes *how* grade.py / triage_cli.py are
  invoked — only that the Grade door and Triage writes work. The fix restores
  the behavior the plugins were always built for (both scripts' own
  docstrings/`pyproject.toml` say "run via `uv run`"); it does not change any
  user- or system-observable contract (`GradeOutcome`, the triage CLI JSON
  envelope, and every exit-code mapping are unchanged).

## Out of Scope
- **`resolvePython()`'s internal python3→python→py ordering** (readiness
  probe's own toolchain check) is left untouched. AUFGABE point 3 asked for
  "prefer uv-managed python, defense-in-depth" there, but after this fix
  neither `grade-runner.ts` nor `triage-cli-runner.ts` calls `resolvePython`
  at all — both go through `resolveUv` exclusively and never fall back to a
  bare interpreter. Reordering `resolvePython` would only change which
  *string* `/api/readiness` displays when both a conforming system python AND
  a uv-managed one are available; it closes no vulnerable path. The regression
  guard (`no-direct-python-spawn.test.ts`) forecloses any *future* call site
  from repeating the mistake independent of that ordering. Reordering a
  working, already-tested probe for a display-only change is out of scope for
  a root-cause bug fix (CLAUDE.md: minimal, targeted change).
- Not fixing the pre-existing, unrelated `triage-fix-now.spec.ts` E2E failure
  (`new-issue-project-select` dropdown) discovered while re-running the triage
  E2E family — reproduced identically on unmodified `origin/main`, unrelated
  to python/uv spawning. Left for its own iterate.

## Design Notes
n/a — no UI change. `GradeOutcome` / triage CLI response shapes are unchanged;
only the subprocess invocation underneath them moved.

## Affected Boundaries
n/a — this changes *how* a subprocess is invoked (argv/env), not a serialized
file/wire format. `GradeOutcome`, the triage CLI's JSON envelope, and the
`triage.jsonl` event shapes are all unchanged.

## Confidence Calibration
- **Boundaries touched:** n/a (see above)
- **Empirical probes run:**
  1. `uv run --project <shipwright-grade-plugin-root>
     <plugin-root>/scripts/tools/grade.py --format json -- <this-worktree>`
     against the REAL local plugin cache (0.29.1) → exit 0, valid
     authoritative `ReportModel` JSON (grade A, 97.9).
  2. `uv run --python ">=3.11" <shared>/scripts/tools/triage_cli.py --help`
     against the real `shared/scripts/tools/` (confirmed no `pyproject.toml`
     anywhere above it) → exit 0, prints usage — confirms `--python`, not
     `--project`, is the correct form there.
  3. Real-browser E2E (`e2e/flows/triage-amend.spec.ts`, 2 tests) driving the
     ACTUAL fixed `uv run --python ">=3.11" triage_cli.py amend ...` spawn
     end-to-end (browser → HTTP → `runTriageCli` → uv → file write → DOM) →
     2/2 passed. Required also fixing `client/e2e/isolated-stack.mjs`'s
     synthetic `uv` stub, which previously only ever answered `--version` and
     never executed a script — a latent gap invisible until production code
     started actually spawning `uv run` to do something (see PR notes).
  4. Re-ran 12 further pre-existing triage E2E flow specs against the same
     harness → all green (no regression). Found and root-caused ONE
     pre-existing, unrelated failure (`triage-fix-now.spec.ts` — a
     `new-issue-project-select` dropdown assertion); reproduced byte-for-byte
     on unmodified `origin/main` with my changes stashed, confirming it
     predates this change.
  5. Full server suite: `tsc --noEmit` clean; `oxlint` clean on every changed
     file; `vitest run` — 318 files / 3665 tests passed, 3 pre-existing skips.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | grade-runner spawns `uv run --project <plugin-root> <script> --format json -- <target>` (fixed argv, `--` end-of-options) | tested | `grade-runner.test.ts::"runs via uv run --project ..."` PASSED |
  | 2 | grade-runner: uv missing → `engine-unavailable`, no python fallback, no spawn | tested | `grade-runner.test.ts::"uv missing → engine-unavailable ..."` (×2) PASSED |
  | 3 | `SHIPWRIGHT_GRADE_COMPLIANCE_ROOT` still reaches grade.py's env under uv | tested | `grade-runner.test.ts` asserts `opts.env[ENV_COMPLIANCE_ROOT]` PASSED |
  | 4 | triage-cli-runner spawns `uv run --python ">=3.11" <script> ...` (fixed argv) | tested | `triage-cli-runner.test.ts::"runs via uv run --python ..."` PASSED |
  | 5 | triage-cli-runner: uv missing → `engine-unavailable`, no python fallback | tested | `triage-cli-runner.test.ts::"uv missing → engine-unavailable ..."` PASSED |
  | 6 | `resolveUv`: absent uv → null; `--version` probed exactly; win32/POSIX bin+PATH resolution | tested | `uv-runner.test.ts` (4 cases) PASSED |
  | 7 | No call site in `server/src/` resolves+spawns a raw python interpreter (regression class closed), including a one-hop variable-indirection bypass and a same-basename-file bypass an external reviewer found in the first pass | tested | `no-direct-python-spawn.test.ts` (8 cases, hardened post external review) PASSED |
  | 8 | Real `uv run --project` invocation against the live `shipwright-grade` plugin cache produces a valid report | tested | manual empirical probe (Confidence Calibration #1), exit 0 + valid JSON |
  | 9 | Real `uv run --python ">=3.11"` invocation against the live `shared/scripts/tools/triage_cli.py` succeeds | tested | manual empirical probe (Confidence Calibration #2), exit 0 |
  | 10 | End-to-end triage `amend` write through the real browser→HTTP→uv→file-write chain | tested | `e2e/flows/triage-amend.spec.ts` (2/2) PASSED |
  | 11 | No regression in other triage write/read E2E flows | tested | 12 further triage E2E specs green (Confidence Calibration #4) |
  | 12 | No regression across the server's full test surface | tested | `vitest run` 3675/3678 passed, 3 pre-existing skips |
  | 13 | `triage-cli-runner.ts`'s `uv run --python` never silently adopts an ambient `pyproject.toml` from the spawning process's cwd (Stage-3 doubt review) | tested | live repro: cwd'd into a directory WITH a pyproject.toml, confirmed `--no-project` forces isolation; `triage-cli-runner.test.ts` argv assertion updated; `triage-amend.spec.ts` (2/2) re-run end-to-end |
  | 14 | The `uv-shim.mjs` E2E fixture correctly distinguishes value-taking uv flags (`--project`/`--python`) from boolean ones (`--no-project`) | tested | `triage-amend.spec.ts` (2/2) passed post-fix; would have failed pre-fix (boolean flag misconsumed the next argv slot) |

- **Confidence-pattern check:** Asymptote — this is a fresh root-cause
  investigation with no prior "are you confident?" moment in this run to
  re-check. Coverage — every ledger row is `tested`, 0 untested-testable.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `node e2e/isolated-stack.mjs --project=chromium
  e2e/flows/triage-amend.spec.ts e2e/flows/triage-deferred-envelope.spec.ts
  e2e/flows/triage-filters-sort-parked.spec.ts
  e2e/flows/triage-pending-delivery.spec.ts
  e2e/flows/triage-record-boundary-recovery.spec.ts e2e/flows/triage-tab.spec.ts`
  (run from `client/`)
- **Evidence path:** local Playwright run output (`client/playwright-report/`,
  `client/e2e-results.json`); terminal transcript of this session.
- **Justification (only if surface=none):** n/a
