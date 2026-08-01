# Mini-Plan: bootstrapper-ci-contract

Run ID: `iterate-2026-08-01-bootstrapper-ci-contract` · medium · FEATURE

## Files

| # | File | Change |
|---|---|---|
| 1 | `.github/workflows/ci.yml` | + `schedule` trigger; + job `Bootstrapper (type + lint + test)`; + `if: github.event_name != 'schedule'` on the four other jobs |
| 2 | `bootstrapper/test/helpers/network-verdict.mjs` | NEW — pure `classifyFetchOutcome()` (the skip-vs-fail rule) |
| 3 | `bootstrapper/test/marketplace-contract.test.mjs` | NEW — live contract probe + offline unit tests of the rule |
| 4 | `scripts/ci/tests/test_bootstrapper_ci_job.py` | NEW — workflow-shape guard, runs in the required `Reviewer Selftest` |
| 5 | `server/src/test/win32-spawn-mirror-parity.test.ts` | comment correction (premise falsified by file 1) |
| 6 | `server/src/test/no-shell-true-spawn.test.ts` | comment correction (same) |

## The convention this sets (first network-dependent test in the repo)

The rule is **"could not ask" vs "asked and got a bad answer"**, and it is
encoded in one pure function so it is reviewable and testable without a network:

| Outcome | Verdict | Why |
|---|---|---|
| DNS / connect failure, `AbortError` / timeout | **skip** | no response ever arrived |
| HTTP 429 | **skip** | rate limit — GitHub declined to answer, not an answer |
| HTTP 5xx | **skip** | server-side transient |
| HTTP 404 | **fail** | the manifest is gone from the path the installer fetches — every user breaks |
| HTTP 403 and any other non-2xx | **fail** | a definite answer the installer cannot use (e.g. repo no longer publicly readable) |
| 2xx + body | **check** | parse it; `parseManifest` rejecting it is a real red |

Loudness on skip is three-channel and non-negotiable: `ctx.skip(reason)`
(annotates the vitest report), `console.warn` (visible in any log), and — under
`GITHUB_ACTIONS` — a `::warning title=...::` annotation so an unverified run
surfaces in the Actions run summary UI instead of being buried.

**Deliberate, scoped exception to the skill's silent-skip CI-discipline rule.**
That rule ("a `skip` on a missing binary / ImportError MUST hard-fail in CI")
targets an *environment defect*, which is the maintainer's to fix. A GitHub
outage is not, and Sven's ruling is explicit: network errors skip, no red build.
The exception is bounded to this one cause (transport unreachable) and paid for
by AC6 — the decision rule itself is covered by deterministic offline tests, so
the skip path can never quietly widen into "everything is a skip".

## Why the shape guard lives in `scripts/ci/tests/`

Because of the "prove first, then arm" decision the new job cannot block a merge
yet. `Reviewer Selftest` **is** already a required check and already runs
`python -m pytest scripts/ci/tests -q` with PyYAML installed. Putting the
workflow-shape assertions there means AC1 + AC2 gate from day one, and the
guard also ratchets in reverse: a future job added to `ci.yml` without a
schedule guard fails the test, so the "bootstrapper only, weekly" decision
cannot rot silently.

## Alternative considered — and rejected

**A separate `bootstrapper.yml` workflow** instead of a job inside `ci.yml`.

- *For:* self-contained triggers; no `if:` guard on four unrelated jobs; the
  weekly schedule cannot accidentally widen to the whole suite.
- *Against, and decisive:* it splits the answer to "what does CI check?" across
  two files for one more package, while the `if:` guards are three words each
  and are themselves ratcheted by file 4. It would also add a seventh workflow
  to the set `test_workflow_token_permissions.py` and the action-pinning posture
  test sweep, for no gain. Sven's brief also said "Job ergänzen, analog zu
  server-checks" — a job, in `ci.yml`.

A second alternative — **only the contract test on the schedule, via a
`vitest --testNamePattern` filter** — was rejected as strictly worse: it makes
the weekly run diverge from the PR run, so the weekly signal would no longer be
"the installer is healthy", only "the manifest still parses".

## Risk / rollback

- The job is advisory on arrival; a mistake in it cannot block anyone.
- `if: github.event_name != 'schedule'` only ever *narrows* scheduled runs. On
  `pull_request` and `push` the expression is true, so PR behaviour is provably
  unchanged — this is what file 4 asserts.
- Rollback is deleting one job block, one trigger and four `if:` lines.
