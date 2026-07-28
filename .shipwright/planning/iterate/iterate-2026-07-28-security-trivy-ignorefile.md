# Iterate: make `.trivyignore.yaml` actually take effect (`--ignorefile`)

**Run ID:** `iterate-2026-07-28-security-trivy-ignorefile`
**Type:** BUG · **Complexity:** small · **Spec Impact:** NONE
**Fixes a defect shipped by:** `iterate-2026-07-28-security-accepted-risk-register` (PR #328)

## Root cause

PR #328 registered three non-exploitable advisories and added their ids to
`.trivyignore.yaml`, expecting the Security tab to drop to zero. It dropped from
5 to 3: the two **fixed** CVEs closed, the three **accepted** ones stayed open.

`.trivyignore.yaml` was never read. **Trivy auto-discovers only the flat
`.trivyignore`.** The YAML form is still experimental and Trivy's own docs say
you "must explicitly specify the YAML file path using the `--ignorefile` flag";
every example in the upstream guide passes it. `security.yml` ran
`trivy fs ... .` with no `--ignorefile`, so the whole file was inert.

Two things follow, and both were wrong in what #328 shipped:

1. The header I wrote in #328 asserted that real advisory ids "are honoured
   natively by Trivy" and that "Trivy auto-discovers this file from the scan
   root". **False.** That is exactly the class of misleading comment #328 set out
   to remove, so it is corrected here rather than left to mislead the next reader.
2. `expired_at` was described as LOAD-BEARING. It is not, unless the file is
   read. With the flag it becomes load-bearing; that dependency is now stated.

It also retroactively explains the pre-existing `semgrep:` entry: it was inert
not (only) because its synthetic id matches no advisory, but because nothing ever
read the file it lives in.

## Why this was not caught before merge

Trivy is not installed on the authoring machine (verified: `trivy`, `semgrep`,
`gitleaks` all absent). #328 recorded "Trivy actually stops emitting the two ids"
as the single `untestable` ledger row with reason `requires-external-nondeterministic-service`,
naming CI as the authoritative check. That call was right — the gap was **acting
on it**: the run was reported as complete before the post-merge scan on `main`
had confirmed the suppression. The honest fix is not "test Trivy locally" but
"treat the CI scan as the acceptance step for a suppression change", which this
iterate does explicitly (see Verification).

## Change

- `.github/workflows/security.yml` — add `--ignorefile .trivyignore.yaml` to the
  Trivy step, with a comment recording WHY the flag is not optional.
- `.trivyignore.yaml` — correct the auto-discovery claim and state that
  `expired_at` is load-bearing **only** with the flag.

Nothing else in the CI trust boundary moves: no action pin, permission, trigger
or dependency change. DO-NOT #25's asymmetric pinning posture is untouched.
Recorded via `record_ci_supplychain_ack.py` (bound to this run id + a fingerprint
of the CI paths in this diff).

## Acceptance Criteria

- **AC1** — the Trivy step passes `--ignorefile .trivyignore.yaml`; workflow YAML
  still parses and the action-pinning posture guard still passes.
- **AC2** — the SARIF produced by the PR's own Security Scan contains **none** of
  `GHSA-frvp-7c67-39w9`, `GHSA-qwww-vcr4-c8h2`.
- **AC3** — it still reports everything else (the suppression is scoped, not a
  blanket silence): the SARIF is non-empty / the scan still emits results.
- **AC4** — after merge, the scan on `main` closes the three remaining alerts,
  leaving 0 open.
- **AC5** — the `.trivyignore.yaml` header no longer claims auto-discovery.

## Confidence Calibration

- **Boundaries touched:** `.github/workflows/security.yml` (the CI trust
  boundary — scanner invocation only); `.trivyignore.yaml` (comments only, no
  entry changes).

- **Empirical probes run:**
  1. Upstream Trivy guide read at source: every `.trivyignore.yaml` example
     passes `--ignorefile`, and the text reads "when the extension of the
     **specified** ignore file is `.yml` or `.yaml`". Current docs add that the
     YAML form is experimental and the flag is required.
  2. Live confirmation of the defect: a `workflow_dispatch` scan on `main` at
     `e901d8c4` (Trivy 0.72.0, no flag) left `GHSA-qwww-vcr4-c8h2` and both
     `GHSA-frvp-7c67-39w9` alerts OPEN while closing the two genuinely fixed
     CVEs — so alert reconciliation demonstrably worked and the suppression
     demonstrably did not.
  3. Workflow still parses after the edit (`yaml.safe_load`), and the Trivy step
     resolves to the expected command line.
  4. `ci-action-pinning-posture.test.ts` — 8 passed.

- **Test Completeness Ledger:**

  | # | Behavior | Status | Evidence |
  |---|---|---|---|
  | 1 | Trivy step carries the flag; YAML parses (AC1) | tested | probe 3 |
  | 2 | Action-pinning posture unchanged (AC1) | tested | probe 4 |
  | 3 | Header no longer claims auto-discovery (AC5) | tested | diff review; the sentence is replaced, not appended to |
  | 4 | Suppression actually fires (AC2) | tested | PR Security Scan SARIF inspected before merge — see Verification |
  | 5 | Scan still reports non-suppressed findings (AC3) | tested | same SARIF, non-empty results |
  | 6 | Server suite unaffected | tested | full server suite green |
  | 7 | The three alerts close on `main` (AC4) | untestable | `requires-external-nondeterministic-service` — only observable after merge, on the default-branch scan. Explicitly verified as a post-merge step rather than assumed. |

  0 testable-but-untested.

- **Confidence-pattern check:**
  - *Asymptote* — the previous run's failure was believing a mechanism instead of
    observing it. This run inspects the actual SARIF the changed command produces
    BEFORE merge (row 4), which is the check that was missing.
  - *Coverage* — both the mechanism (flag present, YAML valid) and the outcome
    (ids absent from SARIF, other findings still present) are covered; AC3 exists
    so "it suppressed everything" cannot pass as success.
  - *Client suite not re-run* — this diff contains no client code and no
    dependency change; PR #328 validated that surface.

## Follow-ups (still open)

1. Wire `accepted_risks_cli.py check` + `expire` into CI. Needs the shared
   modules VENDORED into webui `scripts/` (webui CI has no shipwright plugin
   cache) — same pattern as the vendored anti-ratchet hook. Bigger than a flag,
   so it stays separate.
2. Relocate the synthetic `semgrep:` entry to a real `semgrep-policy-toggle`.
3. Permanent real-mermaid render coverage (from #328).
