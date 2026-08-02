# Iterate Spec: bootstrapper-ci-contract

- **Run ID:** iterate-2026-08-01-bootstrapper-ci-contract
- **Type:** feature
- **Complexity:** medium
- **Risk flags:** touches_ci_supplychain
- **Status:** draft

## Goal

Close two connected gaps around `bootstrapper/` — the published npm package
`@svenroth-ai/shipwright`, which has the widest blast radius in the repo (every
`npx @svenroth-ai/shipwright`) and today has zero CI coverage. (1) Its 153 tests
in 11 files never run in CI: `.github/workflows/ci.yml` gates `client` and
`server` only. (2) The cross-repo contract with the monorepo is untested on both
sides: the installer fetches `.claude-plugin/marketplace.json` from
`raw.githubusercontent.com/svenroth-ai/shipwright/main` and parses it with
`parseManifest()`, but every existing test feeds synthetic fixtures — no test
touches the real document. If the monorepo changes the manifest's shape, `npx`
breaks for every user and neither CI notices.

## Acceptance Criteria

- [ ] **AC1** `ci.yml` defines a job named `Bootstrapper (type + lint + test)`
      that runs, with `working-directory: bootstrapper`: `npm ci` →
      `npx tsc --noEmit` → `npm run lint` → `npm test`, on Node 20 with
      `cache-dependency-path: bootstrapper/package-lock.json`.
- [ ] **AC2** `ci.yml` carries a weekly `schedule` trigger, and on a `schedule`
      event **only** the bootstrapper job runs — every other job in the file is
      gated so it does not fire on the schedule.
- [ ] **AC3** A new `bootstrapper/test/marketplace-contract.test.mjs` fetches
      `MANIFEST_RAW_URL` (the same exported constant the installer uses, so the
      URL itself is pinned) and asserts the **live** document is accepted by
      `parseManifest()`, and that the production seam
      `makeFetchRemoteManifest()` resolves the identical plugin list.
- [ ] **AC4** When the manifest could not be retrieved — DNS/connect failure,
      timeout/abort, HTTP 429, or HTTP 5xx — the test **skips** with a reason,
      prints a `console.warn`, and under GitHub Actions emits a `::warning::`
      annotation. It never fails the build.
- [ ] **AC5** When a response **was** retrieved but does not conform — any other
      non-2xx status (incl. 404 and 403), a non-JSON body, or a body
      `parseManifest()` rejects — the test **fails**. "Cannot check" is never
      recorded as "check passed".
      **AMENDED 2026-08-01** (Stage-3 doubt review added a retry; the external
      code review then correctly flagged that the retry contradicted this AC as
      originally worded). The precise rule is: a `fail`-classified **status** is
      re-read **once** after a 1 s backoff, and *(a)* if the second read also
      fails, the run is RED — real drift is persistent and survives a retry;
      *(b)* if the second read returns a usable document, that document is still
      held to the FULL contract, and the disagreement between the two reads is
      **announced** on all four channels via `reportInconsistentEndpoint` — it is
      never silently forgiven. Body-level violations (non-JSON, `parseManifest`
      rejection, a wrong marketplace ID, a missing `source`) are **not** retried
      at all: they are deterministic, so a retry could only waste time. The
      purpose of the retry is narrow — a single CDN edge answering 404/403 while
      the manifest is fine would otherwise red an unrelated contributor's PR, and
      block it outright once the job is armed.
- [ ] **AC6** The skip-vs-fail decision rule is a pure, exported function
      (`classifyFetchOutcome`) that is unit-tested offline and deterministically,
      so the convention itself is verified on every run even when the live probe
      skips.
- [ ] **AC7** The two server tests whose header comments assert "there is no
      bootstrapper job" are corrected to the new truth and explicitly kept (they
      still guard cross-package parity, which a bootstrapper-only test cannot).
- [ ] **AC8** The workflow shape of AC1 + AC2 is guarded by a stdlib+PyYAML
      pytest under `scripts/ci/tests/`, which the **already-required**
      `Reviewer Selftest` check runs — so the shape gates from day one even
      though the bootstrapper job itself lands advisory.
- [ ] **AC9** The new job is **not** added to the `main-protection` ruleset in
      this PR; the arming step is documented in-workflow, matching the existing
      `E2E smoke (gate)` / `Visual regression (gate)` precedent.
- [ ] **AC10** (added 2026-08-01 after the Stage-3 doubt review, and confirmed
      with Sven) On the **`schedule`** event a skip is a **failure**, not a skip.
      A skipped test leaves the job and the run green, and GitHub mails only on a
      FAILED scheduled run — so without this, fifty-two skipped weeks are
      indistinguishable from fifty-two verified ones and the weekly probe means
      nothing. Pull requests are unchanged: a network failure still skips, so an
      outage never blocks a contributor. Overridable both ways via
      `SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION`.
- [ ] **AC11** The contract additionally asserts two fields `parseManifest` never
      reads but the installer depends on: the **top-level `name`** (the
      marketplace ID, hardcoded at four call sites in `lib/`) and an installable
      **`source`** on every entry. Neither hardcodes a plugin list, and neither
      goes red on a legitimate 15th plugin.

## Spec Impact

- **Classification:** none
- **ADD:** none
- **MODIFY:** none
- **REMOVE:** none
- **Affected FRs (context only):** FR-01.49 — npx installer / updater
- **NONE justification:** CI and test coverage only. The installer's runtime
  behaviour is byte-identical — no acceptance criterion of FR-01.49 changes, and
  no user-visible capability is added, altered, or retired. What changes is how
  continuously the existing behaviour is verified, which is process, not product.

## Out of Scope

- **Checking a copy of the manifest into the repo as a fixture.** Deliberately
  not done: it looks like coverage, ages silently, and stays green while users
  are broken. The live document is the only honest source.
- **Adding the new job to the required-status-check ruleset.** Decided
  2026-08-01: prove first, then arm (mirrors the `#205` diff-coverage
  warn -> prove -> hard-flip rollout). Arming is a GitHub Settings action for
  the maintainer, not a repo edit.
- **Running the full CI suite on the weekly schedule.** Decided 2026-08-01:
  bootstrapper only. Visual-regression baselines drift with browser/font updates
  in the pinned image, so a weekly full run would produce red mail unrelated to
  the installer.
- **Asserting a plugin count or any specific plugin name** in the contract test.
  `lib/plugins.mjs` exists precisely to never hardcode a plugin list ("NEVER a
  hardcoded list" — module header); the bootstrapper references zero plugin
  names in shipped code (verified by grep over `lib/ bin/ scripts/`). Asserting
  "14" or "must contain shipwright-iterate" would re-introduce the very coupling
  the module was written to avoid, and would go red on a legitimate 15th plugin.
  The contract IS `parseManifest`'s shape rule, nothing more.
- **Extending the contract test to the webui <-> monorepo direction.** All 14
  plugin names are referenced across `server/src` + `client/src`, so a second
  consumer-driven contract is arguable — but it is a different pair and a
  different change.

## Design Notes

No UI surface. Design Check is n/a — the diff touches CI configuration and test
files only, and renders nothing.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| svenroth-ai/shipwright `.claude-plugin/marketplace.json` (external repo) | `bootstrapper/lib/plugins.mjs:parseManifest` | JSON over HTTPS |

This is the boundary the change exists to instrument. `touches_io_boundary` did
not fire (no `*_config.json` / `.env*` path, no anchored `json.load` producer
keyword in the diff), but the pair is real and is exactly what AC3 probes. The
round-trip here is cross-repo and one-way (read-only consumer), so the probe is
a live read, not a write-then-read.

## Confidence Calibration

- **Boundaries touched:** the cross-repo manifest boundary above; plus the CI
  trust boundary (`.github/workflows/ci.yml`) via `touches_ci_supplychain`.

- **Empirical probes run** (each one a real execution, not a re-read):
  1. **Live manifest, before writing any test** — `HTTP 200`, 5431 bytes, 275 ms,
     14 plugins, `parseManifest` accepts it. Top-level `name` is `"shipwright"`;
     every entry carries a `source`. This is what made AC11 concrete rather than
     speculative.
  2. **The marketplace ID is really load-bearing** — grepped `lib/`: hardcoded at
     `plugins.mjs:142`, `plugins.mjs:161` (`<name>@shipwright`),
     `claude-cli.mjs:99`, `claude-cli.mjs:103`. `parseManifest` reads none of it.
  3. **`ctx.skip(reason)` genuinely skips and keeps the suite green** — throwaway
     probe against an unresolvable host: `↓ … [PROBE contract: NOT VERIFIED —
     transport failure: TypeError: fetch failed (ENOTFOUND)]`, run reported
     `23 passed | 1 skipped`. Confirms a network outage cannot red a PR.
  4. **The annotation is really emitted** — same probe with `GITHUB_ACTIONS=true`
     printed `::warning title=PROBE contract::…` verbatim.
  5. **AC10, the mandatory branch** — with `GITHUB_EVENT_NAME=schedule` and an
     unreachable host, the branch throws (`rejects.toThrow(/REQUIRES
     verification/)` passed).
  6. **AC10 has no false-red** — the REAL live suite under
     `GITHUB_EVENT_NAME=schedule` with a healthy network: `3 passed`.
  7. **Falsification of the workflow guard, round 1** — four mutations of
     `ci.yml` (drop a job's schedule guard · copy the server job's `-- --run` ·
     rename the job · delete the schedule). Each failed on exactly its own test
     and nothing else; the restored file went green.
  8. **Falsification of the anti-tamper guards, round 2** — five more mutations
     (`needs: [server-checks]` · `continue-on-error: true` · a
     `== 'pull_request' || == 'schedule'` disjunction · `if: == 'push'` on the
     exempt job · reverting the concurrency group to ref-only). Each failed on
     exactly its own test; restored file green at 15 passed.
  9. **The external reviewer's counter-proposal was checked, not assumed** —
     gemini proposed reading a local `../../.claude-plugin/marketplace.json`.
     No such path exists in this repo (`ls` + `find`): the manifest lives in
     `svenroth-ai/shipwright`, a different repository. Its suggestion was also
     the checked-in fixture Sven explicitly rejected.

- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Job exists, named `Bootstrapper (type + lint + test)`, in `bootstrapper/` | tested | `test_bootstrapper_ci_job.py::test_the_job_is_named_exactly_what_the_ruleset_would_need` + `::test_the_job_runs_in_the_bootstrapper_workspace` PASSED |
  | 2 | The four checks run in order, with no `-- --run` | tested | `::test_the_job_runs_install_typecheck_lint_and_tests_in_order` PASSED (falsified: probe 7) |
  | 3 | Node pinned to 20; npm cache keyed on the bootstrapper lockfile | tested | `::test_node_is_pinned_to_the_packages_declared_floor` + `::test_the_npm_cache_is_keyed_on_the_bootstrappers_own_lockfile` PASSED |
  | 4 | Nothing makes the job green regardless of its steps (`continue-on-error`, step `if:`) | tested | `::test_nothing_makes_the_job_green_regardless_of_its_steps` PASSED (falsified: probe 8) |
  | 5 | A weekly `schedule` trigger exists | tested | `test_bootstrapper_ci_schedule.py::test_ci_runs_on_a_weekly_schedule` PASSED (falsified: probe 7) |
  | 6 | Only the bootstrapper job runs on the cron; disjunctions rejected | tested | `::test_every_other_job_opts_out_of_the_weekly_schedule` PASSED (falsified: probe 8) |
  | 7 | The exempt job cannot exclude itself (`if:`) or be skipped (`needs:`) | tested | `::test_the_bootstrapper_job_is_the_one_that_runs_on_the_schedule` + `::test_..._cannot_be_skipped_by_a_dependency` PASSED (falsified: probe 8) |
  | 8 | The cron and a push to main cannot cancel each other | tested | `::test_the_schedule_cannot_cancel_a_push_to_main_run` PASSED (falsified: probe 8) |
  | 9 | The PR-only exemption stays earned; the exempt sets are non-vacuous | tested | `::test_the_pr_only_exemption_is_still_earned` + `::test_the_exempt_sets_are_not_vacuous` PASSED |
  | 10 | The LIVE manifest is accepted by `parseManifest` | tested | `marketplace-contract.test.mjs` live case PASSED against the real endpoint |
  | 11 | The production seam yields the identical list over the same bytes | tested | same case, `assertManifestContract` PASSED |
  | 12 | The seam's DEFAULT target is `MANIFEST_RAW_URL` | tested | `marketplace-contract.test.mjs::the seam fetches MANIFEST_RAW_URL when no url is injected` PASSED |
  | 13 | Top-level marketplace ID is asserted (AC11) | tested | `marketplace-contract-rules.test.mjs::a RENAMED marketplace …` PASSED |
  | 14 | Every plugin entry has an installable `source` (AC11) | tested | `::a plugin entry with no installable source` + `::… whose source is blank` PASSED |
  | 15 | A 15th plugin is NOT drift (no count/name coupling) | tested | `::a 15th plugin is NOT drift` PASSED |
  | 16 | Non-JSON / empty / no-`plugins[]` / bad name / empty list → RED | tested | `::a retrieved-but-wrong manifest is RED` table, 9 cases PASSED |
  | 17 | Transport failure, 429, 5xx, mid-read death → SKIP | tested | `marketplace-contract-rules.test.mjs` + `-probe.test.mjs` PASSED |
  | 18 | 404 / 403 / any other non-2xx → FAIL | tested | `::404 is DRIFT, not an outage` + `::403 -> fail` + `::every other non-2xx` PASSED |
  | 19 | A malformed URL is a DEFECT → FAIL, not a skip | tested | `-probe.test.mjs::a MALFORMED url fails` PASSED |
  | 20 | The deadline is enforced and its timer always cleared | tested | `::the deadline is enforced, and its timer is always cleared` + happy-path case PASSED |
  | 21 | One retry on a fail-status; none on skip or success | tested | `::one retry, and only where it helps`, 4 cases PASSED |
  | 22 | An ambiguous classify call throws rather than defaulting to skip | tested | `::an ambiguous call throws rather than defaulting to skip` PASSED |
  | 23 | A skip is loud on all four channels, and payloads are escaped | tested | `::an unverified run is announced, not swallowed`, 4 cases PASSED (+ probes 3, 4) |
  | 24 | A failing summary channel cannot fail the run | tested | `::a failing summary channel never takes the build down with it` PASSED |
  | 25 | On `schedule` a skip FAILS; on a PR it skips; env overrides both (AC10) | tested | `-probe.test.mjs::when 'could not check' must fail instead of skip`, 3 cases PASSED (+ probes 5, 6) |
  | 26 | No manifest fixture is checked in | tested | `test_bootstrapper_ci_job.py::test_no_manifest_fixture_was_checked_in` PASSED |
  | 27 | All three contract test files exist and the live one uses the URL constant | tested | `::test_the_contract_tests_exist` (×3) + `::test_the_live_probe_uses_the_installers_own_url_constant` PASSED |
  | 28 | The two amended server guards still run and still pass (AC7) | tested | full server suite 3198 passed / 1 skipped, 274 files |
  | 29 | The annotation actually RENDERS in the GitHub run-summary UI | untestable | `requires-external-nondeterministic-service` — GitHub's runner renders it; probe 4 proves we emit it correctly, and the `GITHUB_STEP_SUMMARY` channel was added precisely so the guarantee does not rest on that rendering |
  | 30 | The job passes on ubuntu-latest + Node 20 (CI's real matrix) | untestable | `requires-external-nondeterministic-service` — locally verified on Windows + Node 24 (typecheck, oxlint, 196 tests); the ubuntu/Node-20 arm is confirmed by this PR's own first CI run, and is called out in the handoff |

  0 untested-testable.

- **Confidence-pattern check.**
  *Asymptote (depth):* the "are you confident?" pattern fired **twice** in this
  run and both times produced a finding, so I kept probing rather than stopping.
  Stage 1 APPROVED all nine ACs — and Stage 2 then found three blocking defects.
  After those were fixed, Stage 3 found two HIGH ones, including one that
  **inverted a guarantee this change's own header claimed** (a skip is a green
  run; on the cron, an unnotified one). Probes 5–8 were run only because that
  pattern said "one more round". The last round produced no new mechanism.
  *Coverage (breadth):* 30 rows, 28 `tested`, 2 `untestable` with closed-vocab
  reason codes, 0 untested-testable. Both untestable rows are GitHub-side
  rendering/runner facts, not logic of ours.
  *Integration composition:* `cross_component` did not fire (no framework
  merge/hook/phase-validator/campaign path is touched), so no
  `category:"integration"` behavior is required.

## Verification (medium+)

- **Surface:** cli
- **Runner command:** `cd bootstrapper && npm ci && npx tsc --noEmit &&
  npm run lint && npm test` (the new job's exact step sequence, executed
  locally against the real network) plus
  `python -m pytest scripts/ci/tests -q` (the workflow-shape guard as the
  already-required `Reviewer Selftest` job runs it).
- **Evidence path:** `.shipwright/planning/iterate/iterate-2026-08-01-bootstrapper-ci-contract/`
