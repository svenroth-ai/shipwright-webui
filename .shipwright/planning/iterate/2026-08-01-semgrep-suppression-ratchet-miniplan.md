# Mini-Plan: semgrep-suppression-ratchet

- **Run ID:** iterate-2026-08-01-semgrep-suppression-ratchet
- **Spec:** `.shipwright/planning/iterate/2026-08-01-semgrep-suppression-ratchet.md`

## Files to create/modify

| File | Change | Why |
|---|---|---|
| `scripts/ci/tests/semgrep_channels.py` | **new** | Shared discovery: scope matcher, syntax allowlist, directive scanner. Not a test module (mirrors `accepted_risks_paths.py`). |
| `scripts/ci/tests/test_semgrep_scan_scope.py` | **new** | Scope-channel ratchet + `_SCOPE_PATTERNS` rationale registry. |
| `scripts/ci/tests/test_semgrep_inline_suppressions.py` | **new** | Directive-channel ratchet + `_INLINE_SUPPRESSIONS` and the extension policy. |
| `scripts/ci/tests/test_semgrep_channels_scanner.py` | **new** | Fixture-driven regression tests for the helpers (external review O5). |
| `.semgrepignore` | **edit** | Replace the blanket `server/scripts/` line with the three genuinely non-shipped files; refresh the header. |
| `CLAUDE.md` | **edit** | DO-NOT #25 states these two channels are NOT gated. That becomes false — amend in the same commit, and add DO-NOT #31 for the ratchet itself. |
| `.shipwright/agent_docs/decision_log.md` | **drop** | F3 decision drop (keyed by run_id). |
| `CHANGELOG-unreleased.d/security/` | **drop** | F4, one bullet per AC group. |

**Four modules, not the one the first draft named.** The 300-line cap forces the
split, and the seam is the one the subject already draws: one file per channel,
plus shared discovery, plus the fixture suite the external review's O5 finding
asked for. The registries stay next to the assertions that enforce them.

## Stage-2 code review — disposition (verdict: REQUEST CHANGES, 10 findings)

**All ten accepted and implemented.** Four were false-negative classes — a
working suppression the ratchet reported as green — which is the only failure
this design cannot tolerate.

| # | Sev | Finding | What changed |
|---|---|---|---|
| F1 | High | Semgrep's inline matcher is case-INSENSITIVE; ours was not, so `NOSEMGREP:` suppressed for real and scanned as nothing | `re.IGNORECASE` on both patterns; fixture + end-to-end mutation 9 |
| F2 | High | `tokenize` made `.py` a strict SUBSET of Semgrep, which does not parse comments at all but regex-matches a finding's raw line — so a marker in a Python STRING was honoured and invisible, inside the CI trust boundary | EVERY language now read line by line; the vendored file that cannot comply gets a rot-guarded `PROSE_EXEMPT` entry instead of an invisible parser asymmetry. **This fix immediately caught two more marker literals in our own fixture docstrings.** |
| F3 | Med | Extensionless files were all classed "not source", but Semgrep guesses language from a shebang — so `scripts/hooks/pre-commit` (executable, the bloat gate) was skipped | `is_scanned()` shebang fallback; end-to-end mutation 11 |
| F4 | Med | The id tail was captured as a single comma-run, so `<marker>: blessed.rule second.rule` left the pinned count unchanged while Semgrep honoured both | tail split on commas AND whitespace, block-comment terminator stripped, any malformed token voids the whole directive; end-to-end mutation 10 |
| F5 | Low | `fnmatch` applies `os.path.normcase` — case-insensitive on Windows, sensitive on Linux CI | `fnmatchcase` + a fixture |
| F6 | Low | `UnsupportedPattern` carried only the pattern string | Message now names all four supported shapes and what to do; asserted by a fixture |
| F7 | Low | Repeated tree walks and re-classification | Patterns classified once up front in `in_scan_scope` — which also closes a real hole: `excluded()` short-circuits, so a later unsupported pattern could go unclassified depending on which file was tested first |
| F8 | Low | `git ls-files` C-quotes non-ASCII names, so such a file stays "in scope" under a nonsense suffix | `-z` + `core.quotePath=false` |
| F9 | Low | The fixture module's docstring claim was false about its own file | Resolved by F2 — the guard now catches this class itself |
| F10 | Low | The end-to-end fixture inherited the developer's global gitignore, so two negative assertions could pass for the wrong reason | `core.excludesFile=` + a positive control on `tracked_files` before the negatives |

Reviewer's non-finding on `.cjs`: correct, and left as-is —
`test_every_in_scope_extension_is_classified` forces the decision the day a
`.cjs` file lands, which is when it is answerable.

**Module count grew 4 → 6** under the 300-line cap: `semgrep_scan_surface.py`
(what Semgrep reads) split from the inline ratchet, and
`test_semgrep_ignore_matcher.py` split from the scanner fixtures.

## Why `scripts/ci/tests/`, not a vitest meta-test

Three reasons, and the third is decisive:

1. **It is already the home of this subject.** `test_accepted_risks_repo_invariants.py`'s docstring defines its scope as "the suppression channels this repo actually uses, including the one the shared gate structurally cannot see". These are two more of exactly that.
2. **It runs on the trigger that matters.** `python -m pytest scripts/ci/tests -q` is executed by *both* `security.yml`'s `accepted-risks` job (so: the weekly schedule) and `pr-review.yml`'s `Reviewer Selftest` (so: every PR, including forks). No workflow edit is needed — `test_the_gate_job_also_runs_these_invariants` pins the whole-directory form precisely so a new module is covered on day one.
3. **The hardest problem lives here.** Telling a real directive from prose that mentions one is forced by `scripts/ci/accepted_risk_scan.py` — vendored, byte-identical to upstream, two marker mentions in its docstrings, and therefore uneditable. *(The first draft answered this with `tokenize` and called it decisive. Stage 2 overturned that: Semgrep does not parse comments, so a token-aware reader is a strict SUBSET of what it honours. The answer is now a rot-guarded exemption — see the Stage-2 table, F2.)*

Sibling-module split rather than extending `test_accepted_risks_repo_invariants.py` (183 lines): two registries plus a scanner would push it past the 300-line cap, and the name would blur the very distinction this iterate draws — these are deliberately **not** register entries.

## Work breakdown

1. **Scanner + scope matcher** (`_live_patterns`, `_excluded`, `_tracked_sources`).
   *Test:* `test_the_scope_matcher_implements_gitignore_semantics` — un-anchored `dist/` matches at depth, anchored `client/e2e/` does not match elsewhere, and a floor assertion on the in-scope file count so a broken `git ls-files` cannot pass vacuously.
2. **Scope ratchet + rationale gate.**
   *Test:* `test_scope_patterns_match_the_pinned_set` (both directions) and `test_every_scope_pattern_carries_a_rationale`.
3. **`.semgrepignore` narrowing.**
   *Test:* `test_the_build_shaping_script_is_in_scan_scope` — asserts no blanket `server/scripts/` line, `copy-assets.mjs` in scope, the other three out.
4. **Directive scanner** — every marker line, in every scanned language. *(Drafted as `tokenize` for `.py`; replaced at Stage 2.)*
   *Test:* pinned against the two real files (0 / 1).
5. **Suppression ratchet + rationale gate + rule-naming rule.**
   *Test:* `test_inline_suppressions_match_the_pinned_set` (counts included), `test_every_inline_suppression_carries_a_rationale`, `test_every_directive_names_its_rule`.
6. **Falsification (AC-7).** Add a throwaway pattern → expect red → revert. Add a throwaway directive → expect red → revert. Record verbatim output.

## Test strategy

Red-Green: each ratchet is written against the *known* real set, so "green" alone proves nothing — step 6 is what buys the guard. Both directions are asserted for both registries (registry→disk and disk→registry), matching the shape `create-cta-standard.test.ts` and `shell-scroll-invariant.test.ts` already use in this repo. No E2E: `surface = none`, justified in the spec.

## Alternative approach considered — and why rejected

**Alternative: make the ratchet a vitest meta-test under `server/src/test/`,** extending `no-shell-true-spawn.test.ts` (which already pins the 3 pty-site suppressions) into a general suppression guard.

Rejected on two counts. **(a) Trigger coverage is worse where it matters most.** That file runs in `ci.yml`'s server-vitest job, which is `pull_request`-only; the scope-exclusion channel is exactly the kind that rots between PRs, and the Python home inherits `security.yml`'s weekly schedule for free. **(b) The parsing problem is Python-shaped.** The vendored `accepted_risk_scan.py` carries two uneditable marker mentions, and the eventual answer (read every line, exempt that file explicitly) is far more natural next to the module it exempts than in a TS meta-test.

Retained from the alternative: `no-shell-true-spawn.test.ts` **stays**.

## External plan review — disposition (both providers: `revise`)

| # | Finding | Sev | Disposition |
|---|---|---|---|
| G1 / O1 | Hand-rolled gitignore matcher is error-prone; use `pathspec` (G) / at minimum reject unsupported constructs (O) | High | **ACCEPT O's form, REJECT G's.** `pathspec` is a new CI dependency — both jobs install only pytest + PyYAML, so adding it means editing a workflow and dragging the CI trust boundary into this change — and it implements *git*'s semantics, not Semgrep's, so it buys no parity. Instead a **syntax allowlist**: four supported shapes, everything else REJECTED, so an unknown-unknown is a red build rather than a silent misread. Plus fixtures per shape. |
| O3 | The extension allowlist may miss a language Semgrep scans | Med | **ACCEPT.** Add an **extension policy registry**: every extension present among in-scope tracked files must be classified `scanned` or `not-a-semgrep-language` (with a reason), both directions asserted. A new language landing in the repo turns the suite red demanding a decision, which is exactly when the question is answerable. Measured: 21 distinct extensions over 945 in-scope files today. |
| G4 | Legacy directive form `nosem:` is honoured by Semgrep and would dodge the ratchet | Low | **ACCEPT — and it is the most dangerous finding in the set**, because unlike the others its failure direction is a *false negative*. Semgrep's inline matcher is `nosem(grep)?`. The scanner now matches both stems. (`semgrep: ignore` was also suggested; not implemented, because I could not confirm it is a real directive and inventing a form would be guessing.) |
| O4 | Rule-ID grammar undefined; a permissive regex could accept malformed or multi-ID directives | Med | **ACCEPT.** Explicit grammar `[A-Za-z0-9._-]+`, comma-separated for the multi-ID form, each ID registered separately. Anything outside it fails closed naming the file and line. |
| O5 | Manual AC-7 falsification does not protect the scanner from future regression | Med | **ACCEPT — the single most valuable finding.** Fixture modules drive the same production helpers against temp-dir trees, covering every drift direction. AC-7's manual falsification stays as end-to-end evidence on the real tree. |
| G3 | Narrowing scope could break CI if `copy-assets.mjs` carries findings | Med | **ACCEPT the question, answer structurally** — Semgrep is Linux/macOS-only and cannot run here. A new finding *cannot* block CI: the critical gate fires only at `security-severity >= 9.0` or a Gitleaks secret, and `--config auto` emits no `security-severity`. The file is 8 lines with no taint source. Residual and intended: it may add a low-severity triage row, which is the point. |
| O6 | Who is authorised to approve a registry update? A 40-char rationale is audit metadata, not an approval control | Med | **ACCEPT as documentation — verified rather than assumed.** `pr-review-run.yml:183` routes on `^(…\|scripts/ci/\|…\|\.semgrepignore\|…)`, so **both** surfaces this change touches are Tier-3a sensitive and produce the required, merge-blocking `PR Review` context. That is the control, and it is automated: this repo runs 0 required approvals by ruleset, so there is no human CODEOWNERS to point at and adding one is out of scope. Recorded in the ADR and the DO-NOT entry, which is O6's own stated fallback. |
| G2 / O2 | Naive "every marker line" matching will false-positive on strings and template literals | Med/High | **REJECT — this reads a deliberate choice as an oversight.** Both suggestions trade a false *positive* for a false *negative*, and only the latter voids a ratchet — which is O2's own competing worry. Under the strict rule that class cannot exist: in a scanned file every marker line is either a registered directive or a red build. A fixture pins the trade so it stays visible. *(The Python half of this answer was later overturned by Stage 2 — see F2 below; the strict rule won everywhere.)* | It asserts something this module does not — that four specific remediated files carry no `shell: true` at all, including three under `bootstrapper/`, which is not a vitest workspace and which the Python suite does not read. The overlap on the pty count is deliberate duplication across two different jobs, and is cross-referenced in both files.
