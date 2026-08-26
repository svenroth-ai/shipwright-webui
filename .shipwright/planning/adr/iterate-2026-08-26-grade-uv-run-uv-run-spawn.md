# ADR: Route grade.py and triage_cli.py through `uv run`, never a bare system Python

**Run:** iterate-2026-08-26-grade-uv-run
**Spec:** [`.shipwright/planning/iterate/2026-08-26-grade-uv-run.md`](../iterate/2026-08-26-grade-uv-run.md)

## Context

`grade-runner.ts` and `triage-cli-runner.ts` each resolved a bare, unversioned
system Python (`python3`/`python`/`py`, whichever answered `--version` first)
via `resolvePython()` and spawned it directly to run plugin-owned scripts
built for `uv run`. On a machine whose ambient interpreter lacked the
plugin's declared dependencies (`defusedxml`, Python 3.11+), `grade.py` died
with `ModuleNotFoundError` in ~110ms while `/api/readiness` kept reporting
Python green — its own uv-managed fallback was never consulted by the actual
spawn.

## Decision

Both call sites now resolve `uv` via a new `uv-runner.ts::resolveUv()` (a
presence probe reusing the readiness probe's PATH augmentation) and spawn:

- `grade-runner.ts`: `uv run --project <plugin-root> <script> --format json
  -- <target>` — the plugin's own `pyproject.toml`/`uv.lock`/`.venv`.
- `triage-cli-runner.ts`: `uv run --no-project --python ">=3.11" <script>
  --project-root <root> <op> <itemId> ...args --json` — `--python` because
  `shared/scripts/tools/` has no `pyproject.toml` of its own; `--no-project`
  (added after a Stage-3 doubt review) so `uv` never walks up from the
  spawning process's cwd looking for an ambient project to activate.

`uv` missing maps to an honest `engine-unavailable` outcome with the existing
repair command at both sites, never a silent python fallback.

A new source-scan regression guard
(`no-direct-python-spawn.test.ts` + `no-indirect-python-spawn.test.ts`,
sharing `python-spawn-guard-util.ts`) forecloses: `resolvePython()` calls
outside its two sanctioned readers (`readiness-probe.ts`,
`readiness-probe-run.ts`); a literal `python3`/`python`/`py` spawn target
(quote or backtick); that literal hidden behind a one-hop variable
indirection; and an inline reimplementation of the `python3`→`python`→`py`
probe loop copied from `readiness-probe-run.ts`. The last three were found
across an external code review and a Stage-3 doubt review, not the initial
implementation pass.

## Consequences

Grade and triage writes now depend on `uv` being installed — already a
first-class readiness-gate requirement, so no new install burden. A missing
`uv` surfaces as an honest degraded state with a repair command instead of a
confusing `ModuleNotFoundError`. `uv run --project` performs a one-time
dependency sync into the plugin's own cache directory
(`~/.claude/plugins/cache/shipwright/shipwright-grade/<version>/.venv/`) on
first use per version — verified live; this is `uv`'s own locked, scoped
mechanism, not a new write surface `grade-runner.ts` owns or must guard
(documented in that file's header). The triage invocation's `--no-project`
makes "no ambient project" structural rather than an accident of this repo
currently having no `pyproject.toml` anywhere in its tree.

## Rejected Alternatives

Reordering `resolvePython()`'s own `python3`→`python`→`py` probe order to
prefer a uv-managed interpreter (AUFGABE point 3 in the original bug report)
was rejected: after this fix neither runner calls `resolvePython()` at all,
so reordering it would only change a cosmetic `/api/readiness` display
string, not close any vulnerable path. The regression guard forecloses any
*future* call site from repeating the original mistake independent of that
ordering.

## Review Trail

- Stage 1 (spec-reviewer): PASS, no divergence from the 5 acceptance criteria.
- Stage 2 (code-reviewer): PASS, 2 low-severity findings (a `homeDir`
  test-seam asymmetry, a stale doc comment) — both fixed in follow-up.
- External code review (openrouter/openai): 1 medium finding — the
  regression guard's basename-allowlist and literal-adjacency assumptions had
  bypasses — fixed (full-path allowlist, template-literal + variable
  indirection + probe-loop-reimplementation detection added).
- Stage 3 (doubt-reviewer): 2 medium doubts fixed (triage's implicit
  no-ancestor-project assumption via `--no-project`; two further regression-guard
  bypasses via a widened regex + a third scan), 1 low-medium doubt resolved by
  a documented rebuttal (uv's own plugin-cache write during first sync), 2 low
  doubts actively disproven against the real cache with no action needed.
