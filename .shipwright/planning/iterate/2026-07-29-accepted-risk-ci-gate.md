# Iterate: enforce the accepted-risk register in CI

- **Run ID:** iterate-2026-07-29-accepted-risk-ci-gate
- **Intent:** CHANGE (enforcement of an existing posture)
- **Complexity:** medium · risk flag `touches_ci_supplychain`
  (enforces `ci_supplychain_ack` + mandatory review)
- **Spec Impact:** NONE — no product behaviour, endpoint, schema or UI changes.
- **Origin:** Part 1 of 2 of the follow-ups left over from the 2026-07-28
  dependency triage (`iterate-2026-07-28-security-accepted-risk-register`).
  Part 2 (`iterate-2026-07-29-mermaid-real-render-e2e`, PR #331) is merged.

## Problem

`shipwright_accepted_risks.yaml` records every consciously accepted security
finding with an `expires` re-review date — but **nothing gated on it**.
`accepted_risks_cli.py check` (register-vs-suppression drift, both directions)
and `expire` (past-due) were run on demand only, so an overdue acceptance
surfaced in a dashboard table instead of failing the build.

The only automatic backstop was the scanner-side `expired_at` in
`.trivyignore.yaml`: once the date passes Trivy stops ignoring and the alert
returns. That **self-heals but does not gate**, and it covers only the Trivy
channel — a Semgrep or CI-posture acceptance has no backstop at all.

The register's own header said as much ("NOT YET WIRED INTO CI"). This closes it.

## Acceptance Criteria

- **AC-1** `check` and `expire` run automatically and FAIL the build.
- **AC-2** The gate works with no shipwright plugin cache, because webui CI has
  none. The shared modules are VENDORED into `scripts/` following the vendored
  anti-ratchet hook pattern: canonical-source hash + version in the header.
- **AC-3** A drift guard makes an in-place edit of a vendored file fail CI.
- **AC-4** The gate's own dependency (PyYAML) is installed by the workflow.
- **AC-5** Settle what actually holds the `github-actions-mutable-action-tag`
  finding quiet **before** relocating any toggle, and correct the record.

## Mini-plan (and the alternative that was rejected)

**Chosen.** A new `accepted-risks` job in `.github/workflows/security.yml`,
running the two vendored subcommands, plus a drift-guarded vendor of the four
shared modules under `scripts/ci/` and a pytest suite in the existing
`scripts/ci/tests/`, which the `Reviewer Selftest` job already executes.

That job DOES need one change, contrary to this plan's first draft: it installed
only `pytest`, and the new contract tests subprocess the CLI and assert exact
exit codes, so without PyYAML five of them get exit 2 (the fail-closed
"could not run" code) and the job would be RED unconditionally — unable to
distinguish a real vendored-file edit from baseline. Caught by the Stage-1
reviewer (S1-1) and confirmed by running that job's exact command with pytest
alone: 5 failed, 103 passed.

**Why `security.yml` and not `ci.yml`** — the load-bearing reason, not a
preference: **`expire` is TIME-based, not diff-based.** A PR-only gate would
never fire on an entry that lapses while nobody happens to open a PR, which is
exactly the silent rot this iterate exists to stop. `security.yml` already
carries the weekly `schedule` (Mon 06:00 UTC), so the job inherits the one
trigger that makes expiry enforceable. It also sits next to the
`.trivyignore.yaml` it reconciles against.

**Alternative considered and REJECTED: extend the existing `Reviewer Selftest`
job in `pr-review.yml`.** It already installs Python and runs on every PR
including forks, so it looked free. Rejected because it is `pull_request`-only:
the gate would have had no scheduled run, and `expire` would have been enforced
only as a side effect of unrelated PR traffic. It would also have conflated a
vendored-reviewer selftest with a live security gate under one check name.

**Also rejected: a separate step inside the existing `scan` job.** That job
installs Semgrep, Trivy and Gitleaks; a register failure would report under the
same check name as a scanner failure, and an offline gate that finishes in
seconds would wait on ~90 s of scanner installs.

## Implementation

| File | Lines | Role |
|---|---|---|
| `scripts/ci/accepted_risks.py` | 287 | register parse + validation (verbatim) |
| `scripts/ci/accepted_risk_scan.py` | 160 | discovers real suppressions (verbatim) |
| `scripts/ci/gh_action_tag_owner.py` | 123 | owner-scoped predicate (verbatim) |
| `scripts/ci/accepted_risks_cli.py` | 265 | the CLI (**adapted** — see below) |
| `scripts/ci/accepted_risks_vendor.json` | — | drift-guard manifest |
| `scripts/ci/tests/test_accepted_risks_vendored.py` | 127 | manifest drift, both directions + provenance |
| `scripts/ci/tests/test_accepted_risks_cli_contract.py` | 241 | the gate's behaviour: drift, expiry, fail-closed |
| `scripts/ci/tests/test_accepted_risks_repo_invariants.py` | 283 | this repo's fail-open closures + the CI wiring pins |
| `.github/workflows/security.yml` | +82/-5 | the `Accepted-risk register (gate)` job |
| `.github/workflows/pr-review.yml` | +10/-2 | `Reviewer Selftest` now installs PyYAML |

35 tests across the three files, all green in the selftest job's real
environment (`pip install pytest pyyaml`); **118** across the whole
`scripts/ci/tests` suite.

Three modules are **byte-identical** to canonical below their provenance header.
The CLI is **adapted**, and both facts are asserted by the test suite rather
than left to a comment.

### The CLI drops `converge` — deliberately

Canonical's third subcommand resolves `github-dismissal` entries against live
GitHub state and can mass-dismiss alerts. Canonical is explicit that **no
scheduled job may hold that authority** (an automated reconciler is the shape
that produced webui #285). Removing it from the vendored copy makes the CI gate
*structurally incapable* of it rather than merely discouraged, and it drops the
`github_code_scanning` import so the gate stays offline and stdlib-only + PyYAML.
`test_converge_is_absent_from_the_vendored_cli` pins the removal.

### Drift guard

`accepted_risks_vendor.json` records each vendored file's sha256 (as vendored)
and its canonical sha256 at the recorded version. The test enforces **both
directions** per the registry-driven SSoT rule: every manifest entry resolves to
a file whose hash matches, AND every vendored module has a manifest entry. An
in-place edit therefore fails CI until the manifest is updated — which is the
moment to ask "did I mean to diverge from canonical?".

## AC-5 — what actually holds that finding quiet (settled)

The register's filing note said the semantically correct home for the
`github-actions-mutable-action-tag` acceptance was a `semgrep-policy-toggle`
keyed to `SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS`, and that relocating
it was merely a CI-supply-chain change deferred to a later pass.

**Investigated, and that is wrong — but the first correction was also wrong, and
that matters more.**

The first pass concluded "relocating would be INERT" and wrote that into all
three permanent records. The Stage-1 reviewer falsified it *using code vendored
in this same diff*: `accepted_risk_scan.read_workflow_env` parses `SHIPWRIGHT_*`
assignments **out of `security.yml`** and maps this one to a
`semgrep-policy-toggle` suppression. Reproduced empirically — with the toggle
relocated, the newly-wired gate finds a suppression with no matching register
entry (this entry is filed `trivy-ignore`) and **fails the build**:

```
UNRECORDED  semgrep-policy-toggle: SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS
  -> exit 1
```

So relocating is **not inert — it is breaking**, unless the register entry's
`target` is flipped in the same commit, for zero operational gain. That is a
strictly stronger reason to leave the toggle where it is, and all three records
now say so. Underlying evidence, all independently verified:

1. `security.yml` runs a bare `semgrep scan --config auto` and contains **zero**
   `SHIPWRIGHT_SEMGREP_*` references (`grep -c` = 0). So does the canonical
   workflow template.
2. For SUPPRESSION purposes the variable has exactly one consumer:
   `semgrep_tailoring.normalize_tailored`, whose only caller is
   `plugins/shipwright-security/scripts/lib/oss_backend.py` — the LOCAL
   `/shipwright-security` scan path. So moving it into the workflow buys no
   suppression there. It does NOT follow that moving it is harmless: as of this
   PR a second consumer READS the workflow (see the correction above), which is
   the part the first pass missed.
3. In CI the finding **is** produced and lands in `sarif/semgrep.sarif`. It
   simply never BLOCKS, because the critical-findings gate fires only on
   `security-severity >= 9.0` or a Gitleaks secret, and Semgrep `--config auto`
   emits no `security-severity` at all.
4. The `.trivyignore.yaml` line is a SYNTHETIC id that Trivy never emits and
   therefore never ignores. It suppresses **nothing**; it exists so the drift
   gate and the compliance dashboard can SEE the acceptance instead of rendering
   it as unexplained DRIFT.

So: `.claude/settings.json` is the **correct** home, load-bearing for the local
scan (it keeps the accepted finding out of `findings.json` and the triage inbox).
No toggle was relocated. Three records that said or implied otherwise were
corrected in the same pass — the register's filing note, `.trivyignore.yaml`'s
header, and CLAUDE.md DO-NOT #25, which additionally claimed the finding was
"suppressed via `.trivyignore.yaml`". It is not.

## What this gate does NOT cover

Written here, in CLAUDE.md DO-NOT #25 and in the register header, because the
Stage-3 review showed the claim as first drafted ("an accepted security risk can
no longer rot silently") was **broader than the mechanism**. It is true for three
channels and false for several others that carry *more* suppression in this repo
today.

**Gated** — every PR and the weekly schedule: a `.trivyignore.yaml` id; a
`SHIPWRIGHT_SEMGREP_EXCLUDE_RULES` entry in `security.yml`; the GH-owned-action
toggle in `security.yml`. Plus four repo-level fail-open closures: register
deleted, a lapsed `.trivyignore.yaml` `expired_at`, an unregistered
`SHIPWRIGHT_*` key in `.claude/settings.json`, and Trivy's `--ignorefile`
pointing at a file other than the one the gate reconciles.

**NOT gated**, deliberately, and each is a real channel in use here:

- **`.semgrepignore`** (12 live path patterns) — read by the CI Semgrep run AND
  by the local scan that feeds `findings.json` and triage. Adding one line there
  silences an entire subtree, permanently, with no expiry, and the gate stays
  green. This is the largest uncovered channel.
- **Inline `# nosemgrep`** — ten in production source. Same story, per-site.
- **CodeQL `paths-ignore`** (`.github/codeql/codeql-config.yml`) — which, note,
  already excludes `**/scripts/**`, i.e. this gate's own code.
- **GitHub-side alert dismissals** — structurally unreconcilable from CI once
  `converge` was dropped. That trade is deliberate (no scheduled job may hold
  mass-dismissal authority) but it does mean the channel has no CI backstop.
- **A renewed rather than re-reviewed acceptance.** `expire` compares
  `expires < today` and nothing else: no maximum window, no requirement that
  `statement` or `rationale_ref` changed. A one-character date bump keeps the
  gate green. So this converts *silent rot* into a *visible bump* — real
  progress, and less than the first draft claimed.
- **`scope` and `rationale_ref` are not enforced semantically.** `scope` is read
  by nothing (the hono entry declares `scope.paths` while `.trivyignore.yaml`'s
  own note admits the suppression is id-level, so the register already
  overstates that acceptance's blast radius), and `rationale_ref` is validated
  by SHAPE only — `ADR-999` or a non-existent iterate id passes.

Closing `.semgrepignore` and inline `nosemgrep` the same way (a pinned pattern
set) is the obvious next step and was **deliberately not bundled**: this iterate
is already a CI-supply-chain change requiring maintainer sign-off, and each new
pinned set is a policy decision of its own. Recorded as follow-up rather than
smuggled in.

## Confidence Calibration

- **Boundaries touched:** the CI trust boundary (`.github/workflows/security.yml`)
  and the vendored-code boundary (`scripts/ci/**` ↔ canonical shared modules).
  `ci_supplychain_ack` recorded, bound to this run id and a fingerprint of the
  diff's CI paths. `touches_io_boundary` did NOT fire; the gate only READS
  `shipwright_accepted_risks.yaml` / `.trivyignore.yaml` / `security.yml`, and
  the register parser it uses is byte-identical to the canonical one already
  covered by the monorepo's own round-trip tests.
- **Empirical probes run:**
  1. *Would this go red on day one?* Ran `check` and `expire` against the real
     tree BEFORE writing anything: both exit 0, 3 entries / 3 suppressions
     reconciled, none past due. So the gate does not block existing work.
  2. *Does the vendored copy actually work standalone?* Ran both subcommands
     from the worktree with no plugin cache on `sys.path`. Yes.
  3. *Is `converge` really gone?* `invalid choice: 'converge'`, exit 2.
  4. *The CI steps verbatim* — green tree exit 0/0; a past-due fixture exits 1
     and names the entry; see the failure-mode table below.
  5. *Who consumes the semgrep env var* — `grep` over the whole plugin cache:
     exactly one caller for SUPPRESSION purposes, in the local scan backend.
     **That is only half the AC-5 evidence, and on its own it misleads** — a
     second consumer READS the workflow (`accepted_risk_scan.read_workflow_env`),
     which is what makes relocating the toggle breaking rather than inert. See
     the AC-5 section above; probe 7 is the half this one missed.
  7. *What relocating would actually do* — built a fixture with the toggle moved
     into `security.yml` and ran the gate against it: `UNRECORDED
     semgrep-policy-toggle: SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS`,
     exit 1. Reproduced, not reasoned.
  6. *Does the new job violate the pinning posture?*
     `ci-action-pinning-posture.test.ts` 8/8 unchanged.
- **Test Completeness Ledger:** below.
- **Confidence-pattern check:**
  - *Asymptote (depth)* — the gate was exercised in all three outcomes it can
    have (pass / drift / cannot-run), not just the happy one. Running the CI
    steps verbatim is what found the PyYAML defect below.
  - *Coverage (breadth)* — both drift directions, both expiry directions
    (past-due AND the boundary day), five malformed-register shapes, the
    vendoring manifest in both directions, and the absent-register case.
  - *Integration composition* — `cross_component` did not fire. The gate composes
    with the existing `Reviewer Selftest` job, and that composition was BROKEN in
    the first draft: running that job's exact command in the environment the job
    actually has (`pytest` alone) gave **5 failed / 103 passed**, because the
    contract tests assert exit codes and every register path returns the
    fail-closed 2 without PyYAML. With the install step added, the same command
    gives **113 passed**. The earlier "106 passed" figure in this section was
    measured with PyYAML present — an environment the job did not have — and is
    exactly the kind of number the repo's own learning warns about (S1-1).

### Defect found by the E2E, and fixed

Running the CI steps against a Python **without** PyYAML showed the CLI dying on
an unhandled traceback with **exit 1** — the *same* exit code as real drift. A
security gate that cannot run must never be mistaken for one that ran and found
something; the first thing a reader reaches for on exit 1 is "drift detected".
Now exits **2** (the fail-closed code already used for an unparseable register)
with the remediation in the message. Pinned by
`test_missing_pyyaml_is_not_reported_as_drift`, which injects a failing `yaml`
shim via `PYTHONPATH` rather than touching the interpreter.

### Test Completeness Ledger

| # | Behaviour introduced | Disposition | Evidence |
|---|---|---|---|
| 1 | `check` fails on an UNRECORDED suppression (AC-1) | `tested` | `test_suppression_without_register_entry_is_unrecorded` — exit 1 |
| 2 | `check` fails on a STALE register entry (AC-1) | `tested` | `test_register_entry_without_suppression_is_stale` — exit 1 |
| 3 | `check` passes when register and suppression pair | `tested` | `test_paired_register_and_suppression_pass` |
| 4 | `expire` fails on a past-due entry (AC-1) | `tested` | `test_past_due_entry_fails_expire` + the verbatim CI-step run |
| 5 | The due date itself is still active | `tested` | `test_entry_expiring_today_is_still_active` |
| 6 | An ABSENT register is not an error | `tested` | `test_absent_register_is_not_an_error` |
| 7 | An unparseable register fails CLOSED with exit 2 | `tested` | `test_unparseable_register_fails_closed`, 5 shapes |
| 8 | A missing PyYAML is not reported as drift | `tested` | `test_missing_pyyaml_is_not_reported_as_drift` — exit 2, no traceback |
| 9 | Vendored files match the manifest (AC-3, forward) | `tested` | `test_forward_every_manifest_entry_matches_disk` |
| 10 | No vendored module escapes the manifest (AC-3, reverse) | `tested` | `test_reverse_every_vendored_module_is_recorded` |
| 11 | Every module carries its provenance header (AC-2) | `tested` | `test_every_module_carries_its_provenance_header` |
| 12 | Adapted vs verbatim is stated where a reader sees it | `tested` | `test_adapted_modules_say_how_they_diverge` |
| 13 | `converge` is absent from the vendored CLI | `tested` | `test_converge_is_absent_from_the_vendored_cli` |
| 14 | The gate job is wired and runs BOTH subcommands (AC-4) | `tested` | `test_the_gate_job_is_wired_and_runs_both_subcommands`; falsified by typo-ing the `expire` step. The original ledger cited `test_workflow_token_permissions` / the shape tests, which assert NOTHING about this job (S1-4) |
| 14a | The gate runs on a SCHEDULE, not only on PRs | `tested` | `test_the_gate_job_runs_on_a_schedule_not_only_on_pull_requests` — the whole reason it lives in security.yml |
| 14b | The gate job grants no write scope | `tested` | `test_the_gate_job_does_not_inherit_write_scopes` — security.yml is no longer single-job, so top-level != effective scope (S1-4) |
| 14c | `Reviewer Selftest` installs PyYAML, so the drift guard can discriminate | `tested` | `test_the_selftest_job_installs_pyyaml`. Without it 5 contract tests get exit 2 and the job is RED unconditionally — verified by running that job's exact command with pytest alone (S1-1) |
| 15 | The new job does not breach the pinning posture | `tested` | `ci-action-pinning-posture.test.ts` 8/8 |
| 16 | CLAUDE.md edits keep the doc-sync map honest | `tested` | `client/src/test/doc-sync.test.ts` 104 passed |
| 17 | Corrected records stay machine-valid | `tested` | all three YAML files re-parsed; `check`/`expire` still exit 0 after the edits |

Untested-testable: **0**. No `untestable` rows.

## External-Code-Review-Findings

`external_review.py --mode code`, openrouter. The gemini leg returned an empty
reply (recorded, not hidden); the openai leg returned **`SHIPWRIGHT_VERDICT:
reject`** with two findings. Both are real, and both are now closed.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| EC-1 | high | `cmd_check` returns 0 when the register is ABSENT, before discovering suppressions. Deleting `shipwright_accepted_risks.yaml` while keeping `.trivyignore.yaml` entries makes both subcommands pass — a bypass of the enforcement this iterate adds. | **accepted-and-fixed, at the repo level.** `test_this_repo_still_has_a_register`. NOT fixed by forking the vendored module: the early return is correct for a fresh or legacy repo (canonical's adoption story), and it is only a bypass for a repo that HAS a register — which is a property of *this repo*, not of the shared logic. FALSIFIED: renaming the register turns it red. |
| EC-2 | med | `read_trivyignore_ids` collects ids regardless of `expired_at`, so a Trivy entry whose date has PASSED still counts as an active suppression and `check` reports it reconciled — while Trivy has already stopped ignoring it. Renewing only the register's `expires` produces exactly that state. | **accepted-and-fixed, at the repo level.** `test_no_trivy_suppression_has_silently_lapsed`. NOT fixed by forking: `accepted_risk_scan` is a shared LEAF that the compliance dashboard also consumes, so diverging it here would make webui's CI gate disagree with webui's own dashboard. FALSIFIED: backdating a real entry's `expired_at` turns it red and names the id. |

**Both are genuine UPSTREAM defects in the shared modules**, not artefacts of the
vendoring — the same holes exist in `shipwright/shared/scripts/`. They are
recorded here rather than filed as webui triage (webui's triage feeds webui) so
they can be carried to the monorepo:

1. `accepted_risks_cli.cmd_check` should reconcile even with an absent register,
   so a suppression with no register at all reports as UNRECORDED rather than
   passing silently.
2. `accepted_risk_scan.read_trivyignore_ids` should honour `expired_at`, since a
   lapsed ignore is not an in-effect suppression.

## Internal-Review-Findings (three-stage cascade)

**Stage 1 `spec-reviewer` — REJECT, REJECT, then PASS.** Round 1 (S1-1..S1-5)
caught that the drift guard would run in a job that was RED unconditionally (the
selftest job installs only pytest, so five contract tests get the fail-closed
exit 2 — reproduced: 5 failed / 103 passed); that AC-5's conclusion was falsified
by code vendored in the same diff; that the new job inherited write scopes it did
not need; that the ledger cited tests asserting nothing about it; and that three
line counts were wrong. Round 2 caught that two of the three permanent records
still carried the falsified "INERT" claim — one contradicting itself nine lines
below its own correction — and that a stale "106 passed" survived in the
Confidence Calibration. All fixed.

**Stage 2 `code-reviewer` — 15 findings, 3 blocking. All 15 addressed.** It found
**two more fail-open holes**, the finding class that matters most for a gate
whose whole job is not to be fooled.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| CR-1 | high | FAIL-OPEN. `discovered_suppressions` reads the semgrep channels ONLY from `security.yml`, and this repo's live toggle sits in `.claude/settings.json`. Adding `SHIPWRIGHT_SEMGREP_EXCLUDE_RULES` there genuinely suppresses rules in the scan that feeds `findings.json` and triage, while `check` exits 0 "no drift". | **accepted-and-fixed** — `test_no_unregistered_semgrep_toggle_in_claude_settings` pins the key set to the one registered toggle. FALSIFIED. |
| CR-2 | high | FAIL-OPEN. The gate proves register↔file agreement, never file↔scanner. Trivy is pointed at a hardcoded `--ignorefile`; rename it or drop the flag and Trivy suppresses nothing while `check` reports "3 reconciled". **This actually happened** — per `.trivyignore.yaml`'s own header the YAML file was never read at all until PR #330, and throughout that window this gate would have been green. Both files say "DO NOT drop this flag" *in a comment*, in a change whose premise is that a comment is not a guard. | **accepted-and-fixed** — `test_the_scanner_actually_reads_the_ignorefile_the_gate_reconciles` extracts the `--ignorefile` argument and asserts it equals the file the reader would select. FALSIFIED. |
| CR-3 | med | The EC/CR closures ran on `pull_request` ONLY, because `pytest scripts/ci/tests` lives in pr-review.yml. On the weekly run — the trigger the whole design turns on — none executed, and `main` is not branch-protected so a direct push never passes through selftest either. | **accepted-and-fixed** — the gate job now runs that file itself (~2 s), so the invariants ride every trigger the gate does. FALSIFIED. |
| CR-4 | med | `test_the_gate_job_is_wired…` was a raw substring scan: commenting out both `run:` lines left it green — exactly the regression its own docstring claims to prevent. | **accepted-and-fixed** — every workflow assertion now PARSES the YAML. FALSIFIED by commenting out the `expire` step. |
| CR-5 | med | The schedule test asserted prose; a job-level `if: github.event_name == 'pull_request'` would disarm the gate while leaving `schedule:` in the file. | **accepted-and-fixed** — asserts the trigger AND that the job carries no `if:`. |
| CR-6 | med | The `ModuleNotFoundError` handler was too broad (any missing module diagnosed as "install pyyaml" — a confidently wrong diagnosis, the same defect class it was written to fix) and too narrow (sibling imports run at module-import time, outside the try, so a botched re-vendor still died with exit 1 = "drift"). | **accepted-and-fixed** — handler scoped on `exc.name`; sibling imports wrapped, reporting "the vendored gate is broken" with exit 2. Both paths falsified. |
| CR-7 | med | `canonical_sha256` and the four `# canonical-source-hash:` headers are never verified, so "BYTE-IDENTICAL to canonical" is unfalsifiable here; edit a body plus its manifest hash in one commit and everything stays green. | **partially accepted** — the manifest is a change-DETECTOR by design and the ack's wording ("cannot be edited in place *unnoticed*") is the accurate claim, which the code comments now match. **Rejected-with-reason** the opt-in `SHIPWRIGHT_MONOREPO_PATH` verifier: it makes a guard's coverage depend on a workstation-only env var and a sibling clone that is not guaranteed present. Recorded as an upstream follow-up. |
| CR-8 | med | The reverse drift direction was NAME-scoped, so a fifth vendored leaf under any other name satisfied it vacuously — proof: `pr_review.py` / `pr_review_lib.py` already carry provenance headers and appear in no manifest. | **accepted-and-fixed** — the set is derived from the `# canonical-source-hash:` PROPERTY, with those two in an explicit documented `_NOT_HASH_PINNED` allowlist, making the pre-existing gap visible instead of silently out of scope. |
| CR-9 | low | The lapsed-suppression test used LOCAL time, in a file backstopping a module whose `today_utc()` exists precisely to avoid that; a malformed `expired_at` was silently treated as not-lapsed. | **accepted-and-fixed** — UTC, and malformed dates asserted separately. |
| CR-10 | low | `pytest.importorskip("yaml")` made a security invariant SKIP (i.e. pass) exactly where it was needed. | **accepted-and-fixed** — plain import; PyYAML is guaranteed in both jobs now. |
| CR-11 | low | A least-privilege comment pointed the reader the wrong way ("the block below" — it is above). | **accepted-and-fixed.** |
| CR-12 | low | A `check` failure short-circuited `expire`, so one weekly run could hide an expiry behind a drift. | **accepted-and-fixed** — `if: not cancelled()`. |
| CR-13 | low | The permissions test sliced the file by job order and indentation. | **accepted-and-fixed** — folded into the YAML parse. |
| CR-14 | low | `_run(*args, cwd=)` was passed as `--project-root`, never as a subprocess cwd. | **accepted-and-fixed** — renamed. |
| CR-15 | low | Comment volume in the new job restates what five other places already say. | **partially accepted** — the two facts a workflow reader cannot get elsewhere stay (why this workflow's schedule is load-bearing; that the code is vendored with a manifest). |

Stage 2 also confirmed explicitly: **no circularity** in the manifest (the header
carries the CANONICAL hash, not the file's own, so the recorded sha is
well-defined); job-level `permissions` correctly REPLACES the top-level block;
the job works on forks and needs no secrets; and it found **no spurious
fail-closed path** on a healthy tree. It noted one operational fact worth
stating plainly: on **2026-10-29** the `ar-2026-07-28-hono-…` acceptance lapses
and will block every PR's Security Scan until it is renewed or the dependency is
fixed. That is the design working as intended, and the failure message names the
entry.

## Notes

- The gate is **green on today's tree**, so it blocks nothing on landing. Its
  first real firing will be a genuine expiry or a genuine drift.
- This PR touches `.github/workflows/`, so `pr-review.yml`'s `decide` job routes
  it to Tier-3 review and it requires **maintainer sign-off** to merge. That is
  expected and was called out in the originating brief.
