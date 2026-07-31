# iterate-2026-07-31-revendor-accepted-risk-gate

**Run ID:** `iterate-2026-07-31-revendor-accepted-risk-gate`
**Intent:** CHANGE · **Complexity:** medium · **Spec Impact:** NONE
**Risk flags:** none auto-detected; treated as security-gate-affecting by judgment
**Upstream carried:** shipwright #507 `987e49c6` (`iterate-2026-07-31-accepted-risk-gate-holes`)

## Why this needed its own card

`scripts/ci/` vendors four shared modules behind a sha256 manifest. `sha256` (the
as-vendored hash) is enforced automatically in both directions by
`tests/test_accepted_risks_vendored.py`. `canonical_sha256` — the *upstream* hash
— is **not** verified by anything, by recorded decision: the only offline check
would depend on a workstation-only env var and a sibling clone that is not
guaranteed present. So when upstream moves, this repo is silent. The re-vendor
does not happen by itself and the drift guard does not raise it.

SecFix-1 and SecFix-3 were filed *from here* and fixed *upstream*. This item
carries that fix downstream; it deliberately did not start until #507 merged,
because before that there was nothing to vendor.

## Acceptance criteria

| # | AC | Status |
|---|---|---|
| AC-1 | The four modules re-vendored from upstream `987e49c6`, provenance headers kept | done |
| AC-2 | The three verbatim modules are byte-identical to upstream below the header | done — diff is purely additive, 0 upstream lines removed/changed |
| AC-3 | The CLI keeps its adaptations: no `converge`, scoped missing-dependency handler, wrapped sibling imports | done — 14 assertions, all pass |
| AC-4 | Both manifest hash columns refreshed and reconciling | done |
| AC-5 | The two redundant repo-level backstops retired — **confirmed**, not assumed | done, with one narrowed rather than deleted (below) |
| AC-6 | `eol=lf` pin kept | done — `.gitattributes` untouched, `i/lf w/lf` on all six files |
| AC-7 | Vendored suite green in the environment the selftest job actually has | done — 117 passed on 3.11.15 + pytest + pyyaml only |

## AC-5 in full: what upstream now covers, and what it does not

The instruction was to retire two backstops **but not to delete them blind** —
to confirm against the re-vendored code that the upstream fix covers each case.
Confirmation was empirical: each probe mutates a throwaway copy of this repo's
real state and runs the **re-vendored** `accepted_risks_cli.py check`.

| Probe | State | Observed | Meaning |
|---|---|---|---|
| P0 | untouched | exit 0, "no drift" | baseline |
| P1 | register deleted, suppressions left live | **exit 1**, 3× `UNRECORDED` | EC-1 **covered** |
| P2 | `expired_at` backdated, register current | **exit 1**, `STALE … its own expiry has passed` | EC-2 lapsed half **covered** |
| P3 | `expired_at: whenever` | **exit 0, "no drift"** | EC-2 malformed half **NOT covered** |
| P4 | lapsed **and** unregistered | exit 0 | correct — a lapsed entry suppresses nothing |
| P5 | live **and** unregistered (control) | **exit 1**, `UNRECORDED` | proves P4's silence is real, not a dead gate |

**`test_this_repo_still_has_a_register` — DELETED, but its residual moved rather
than vanished.** Upstream's `cmd_check` no longer returns 0 on the absent *file*
before discovering anything; it reconciles against an empty record, so every live
suppression reports `UNRECORDED` (P1). As a blanket file-exists assertion it is
duplicated enforcement and it went.

**That was not the whole story, and P1 is why I nearly missed it.** Stage-3
showed the new coverage is CONDITIONAL: `check` catches a deleted register only
while a *discoverable* suppression is live. P1 passed because three trivy entries
happened to be live that day — not because the case is structurally covered. This
repo's semgrep toggle in `.claude/settings.json` is un-discoverable by design
(the gate reads `security.yml`, never that file — DO-NOT #25), so its record could
have vanished in silence, and after 2027-07-18 with no edit at all. The residual
is now carried by CR-1, which owns that channel: see D-1 below. P0–P5 remain
correct about what they tested; they were simply not sufficient evidence for the
deletion, which is the lesson recorded in the notes at the end.

**`test_no_trivy_suppression_has_silently_lapsed` — NARROWED, not deleted**, and
renamed `test_no_trivy_suppression_has_an_unreadable_expiry`. Its *lapsed* half is
now expressed upstream by `_is_lapsed` (P2) and was removed. Its *malformed* half
is **not** covered and must stay:

- `_is_lapsed` treats an unparseable date as "no expiry" and keeps the entry
  ACTIVE. Upstream's own docstring names this a disclosed limit and files the
  failure contract for a structurally invalid ignore file as **out of scope**.
- Trivy does the opposite: it unmarshals `expired_at` into a `time.Time`, so one
  bad date makes it reject the **whole** ignore file and apply no suppression.
- So P3's state is the gate certifying three suppressions the scanner never
  applies — CR-2's failure shape exactly. Deleting the guard would have been a
  silent regression, which is precisely what "do not delete blind" protects.

The narrowed guard was falsified: with `expired_at: whenever` it fails and names
`GHSA-frvp-7c67-39w9`.

## Defect found and fixed in passing: the canonical hashes matched no upstream blob

Every `canonical_sha256` in the manifest — and the `canonical-source-hash` in each
module header — was a **CRLF-converted** hash, computed from a Windows working-tree
checkout of the sibling clone (`core.autocrlf=true`) rather than from the git blob.
It matched **no** upstream object.

Proven, not inferred: `gh_action_tag_owner.py` was untouched by #507, yet its
recorded `cd7ebbdf…` equals the CRLF hash of upstream `main` and not its LF hash
`12fad290…`. All four recorded values reproduce exactly as `CRLF(987e49c6^)`.

This is the field nothing verifies, which is why it went unnoticed for the whole
window. Refreshing it required choosing a flavour, so it is now the **LF git blob**
hash — reproducible on any platform. A `canonical_commit` field was added because
`canonical_version` is an iterate **run id**, not a git ref, and cannot be handed
to `git show`; the documented command was run verbatim and reproduces the recorded
hash.

## What the review cascade changed

Stage 1 (spec) PASSED. Stage 2 (code) APPROVED and found one **real defect in this
run's own new test**, plus gaps worth closing. All were reproduced before fixing.

1. **False pass in the narrowed guard (fixed).** The guard claimed to mirror
   `accepted_risks.coerce_date` but stringified first. `coerce_date` accepts a
   `date`/`datetime` or an ISO `str` and returns `None` for anything else — so on
   `expired_at: 20261028` (unquoted = a YAML **int**) `date.fromisoformat("20261028")`
   SUCCEEDS on 3.11 and the guard stayed silent, while `coerce_date` returned
   `None`, `_is_lapsed` read "no expiry" and kept the entry ACTIVE, and Trivy —
   unable to unmarshal an int into a `time.Time` — would drop the whole ignore
   file. Exactly the fail-open the guard exists for. Reproduced, then fixed to
   mirror by TYPE. Falsified: the int case now fails and names the type.
2. **Header ↔ manifest values were never compared (fixed).** The provenance test
   asserted the header KEYS were present, never that their VALUES matched the
   manifest — 8 hand-maintained values with zero enforcement, in a change whose
   whole premise is that an unverified provenance field rotted silently. Added
   `test_header_provenance_agrees_with_the_manifest` (commit/hash/path/version,
   4 modules). Falsified: corrupting one manifest hash turns it red. This closes
   the last surface checkable WITHOUT a sibling clone; header-vs-real-upstream
   still needs a clone and stays a hand-check by recorded decision.
3. **The headers demonstrated what the new guard forbids (fixed).** The manifest
   guard rejects abbreviated shas, while the reproduction command used a 12-char
   one. Now full 40-char in all four headers.
4. **A new one-day red nobody had recorded (documented).** `_is_lapsed` lapses ON
   the date; `Acceptance.is_expired` lapses AFTER it. Every entry pairs the two on
   the SAME day, so on each `expired_at` `check` fails STALE while `expire` is
   still green. Verified by evaluating both against 2026-10-28. That day used to
   pass, so the red is new — and is the fix working. Recorded in
   `.trivyignore.yaml`'s header with both remedies rather than silently changing
   security dates, which is not this run's call.
5. **Manifest key order (fixed)** — `canonical_commit` sits with its siblings.
6. **Bloat (checked, no action).** `accepted_risks_cli.py` (349) and
   `accepted_risks.py` (310) exceed 300, but the baseline's 94 entries are all
   under `client/`/`server/` — zero under `scripts/` — and `anti_ratchet_check.py`
   exits 0. If the Stop gate ever raises these, the disposition is an EXCEPTION,
   not a split: they are vendored copies whose byte-identity to upstream is the
   contract the manifest enforces, and splitting them would break it.

### Stage 3 (doubt, adversarial) — it broke three of my claims

It attacked six claims, could not break two (verbatim byte-identity; the `eol=lf`
pin for this diff) and said so, and disproved three. All were reproduced before
fixing. **One was a real enforcement regression I had introduced.**

**D-1 (high) — the retirement DID weaken the gate, and I had missed it.** My AC-5
argument was "probe P1 shows `check` catches a deleted register". P1 passed only
because three trivy suppressions happened to be live. The shared `check` catches
a deleted register **only when a DISCOVERABLE suppression is live** — and this
repo's one *un*-discoverable suppression, the `.claude/settings.json` semgrep
toggle (DO-NOT #25, the reason CR-1 exists), is exactly the one whose record could
then vanish silently. Reproduced: register deleted + `vulnerabilities: []` →
`check` AND `expire` both exit 0 while the toggle keeps suppressing. Worse, that
state needs **no edit at all** after 2027-07-18, when every `expired_at` has
lapsed and `_is_lapsed` empties the trivy channel. A repo-wide grep confirmed
nothing else asserted the register existed. Fixed in the guard that already owns
the un-discoverable channel: `_REGISTERED_SEMGREP_KEYS` became a mapping
`toggle → register entry id`, and CR-1 now asserts the register exists and the
named entry is in it whenever the toggle is live. That also removes the hardcoded
set's own drift risk. Falsified: removing the register turns CR-1 red.

**D-2 (high) — my mirror was exact, to the wrong reference.** Stage 2 had me
mirror `coerce_date`; that helper is strictly *more permissive than Trivy*, which
parses `expired_at` with the Go layout `2006-01-02` only. So `2026-10-28xyz`
passed both `coerce_date` and my guard while Trivy would reject the whole file.
Worse, my own remediation text ("quote it") converted a caught case into an
uncaught one: `"20261028"` parses as basic ISO 8601 on 3.11, so following the
printed advice moved the operator from *flagged* to *silently mis-dated*. The
guard now enforces Trivy's shape directly and says "write it UNQUOTED as
YYYY-MM-DD". Both cases falsified red.

**D-3 (medium) — the guard skipped structurally invalid entries.** A bare
`- GHSA-1234` under `vulnerabilities:` was silently skipped by both my guard and
`read_trivyignore_ids`, while Trivy rejects the whole file over it. Non-mapping
entries and entries with no `id:` are now flagged. Falsified red.

**D-4 (medium) — three provenance corruptions still passed.** `canonical_repo`
was not compared (the most supply-chain-relevant field, and the one my new test
skipped); the `git show` reproduction command carried an unguarded second copy of
commit+path, so a drifted command would send the sole manual verification at the
wrong blob; and `re.search` took the first match, so a second drifted line lower
down passed. All three fixed. Falsified against the *realistic* attack — header
changed **and** manifest `sha256` refreshed, as a re-vendor from a fork would do —
because the plain edit is masked by the drift guard and proves nothing.

**D-5 (medium) — the new guards ran on the wrong triggers.**
`test_accepted_risks_vendored.py` ran only in pr-review.yml (`pull_request`), so
the *scheduled* gate executed vendored modules whose byte-integrity was last
checked whenever the previous PR landed — contradicting the reasoning the
invariants file gives for its own placement. Added to the gate job's pytest step,
with an invariant pinning it there. Falsified red.

**D-6 (low) — fixed.** The `eol=lf` pin and the reverse-drift guard are *both*
non-recursive, so a future module at `scripts/ci/lib/foo.py` would have had
neither a CRLF pin nor drift coverage. The reverse guard is now recursive and
keyed on the relative path; the flat-file convention is recorded in the
re-vendor notes below.

**D-7 (low) — recorded.** `_is_lapsed`'s disclosed fail-safe omits a third
outcome: an entry counted as absent AND unregistered simply vanishes from
`discovered`, so it can never be reported UNRECORDED. Combined with the disclosed
UTC-vs-local clock gap this is a narrow new blind spot (≈zero on UTC runners).
Upstream owns the function; noting it here so the next reader need not re-derive
it. Related and accepted: a lapsed *unregistered* ignore entry is now silent dead
config, where the retired guard listed it by name.

## Affected Boundaries

- `scripts/ci/*.py` ↔ upstream `shared/scripts/**` (vendoring boundary; sha256 manifest)
- `scripts/ci/accepted_risks_cli.py` ↔ `.trivyignore.yaml` + `shipwright_accepted_risks.yaml` (file-parsing boundary)
- `scripts/ci/**` ↔ `.github/workflows/{security,pr-review}.yml` (CI invocation boundary)
- Git text normalization (`.gitattributes` `eol=lf` ↔ `core.autocrlf=true`) — byte-hash boundary

## Confidence Calibration

- **Boundaries touched:** the four above — vendoring/hash, ignore-file parsing, CI
  invocation, and git EOL normalization.
- **Empirical probes run:**
  - P0–P5 above (backstop coverage) — decided AC-5; P3 changed the plan.
  - Manifest reconciliation recomputed from disk **and** from `git show <commit>` —
    all 8 values reconcile.
  - Verbatim-body check: `diff` upstream vs vendored = 0 upstream lines
    removed/changed for all three.
  - CLI adaptation check: 14 assertions (converge absent, `github_code_scanning`
    absent, try/except present, `yaml`-scoped handler re-raising others,
    `_SCRIPTS_ROOT` own-dir, new upstream symbol imported, new lapse logic present).
  - CRLF hypothesis: `CRLF(987e49c6^)` reproduces all four recorded values exactly.
  - Falsification of the narrowed guard: malformed date → red, naming the id.
  - Suite in the **CI-equivalent** venv (3.11.15 + pytest + pyyaml only): 117 passed.
  - `git ls-files --eol`: `i/lf w/lf` on all six touched files.
- **Test Completeness Ledger:**

| # | Behavior | Disposition | Evidence |
|---|---|---|---|
| B1 | Vendored files match the manifest `sha256` | `tested` | `test_accepted_risks_vendored.py`, 117-pass run |
| B2 | Every vendored module has a manifest entry (reverse drift) | `tested` | same file, both-directions test |
| B3 | Re-vendored CLI reports drift on this repo's real state | `tested` | probe P0 (clean) + P5 (dirty) |
| B4 | Absent register no longer disarms the gate | `tested` | probe P1 |
| B5 | Lapsed ignore entry surfaces as STALE | `tested` | probe P2 |
| B6 | Malformed `expired_at` fails the repo guard | `tested` | falsification run — red, names the id |
| B7 | Lapsed+unregistered entry is correctly silent | `tested` | probe P4, with P5 as control |
| B8 | CLI keeps `check`/`expire` only (no `converge`) | `tested` | `test_accepted_risks_cli_contract.py` + 14 assertions |
| B9 | Vendored files stay LF under autocrlf=true | `tested` | `git ls-files --eol` on all six |
| B10 | `canonical_sha256` reproduces from `git show <canonical_commit>` | `tested` | command run verbatim; matches |
| B11 | Gate wiring in both workflows still intact | `tested` | surviving invariants in the same file (unchanged) |
| B12 | Missing-PyYAML path exits 2, not 1 | `untestable` — `covered-by-existing-test` | `test_accepted_risks_cli_contract.py`; re-proving it needs a Python without PyYAML, and the CI venv has it by definition |
| B13 | A header value disagreeing with the manifest fails | `tested` | `test_header_provenance_agrees_with_the_manifest`; falsified by corrupting one manifest hash |
| B14 | `canonical_commit` present and a full 40-hex sha | `tested` | `test_manifest_exists_and_is_wellformed` |
| B15 | A non-str, non-date `expired_at` (YAML int) is flagged malformed | `tested` | falsified with `expired_at: 20261028` — red, names the type |
| B16 | `expired_at`/`expires` lapse a day apart, producing a STALE-before-EXPIRED window | `untestable` — `covered-by-existing-test` | behaviour of upstream `_is_lapsed` vs `Acceptance.is_expired`, both upstream-tested; verified here by direct evaluation at 2026-10-28 and documented in `.trivyignore.yaml` |
| B17 | A deleted register with a live un-discoverable toggle fails | `tested` | CR-1's new assertion; falsified by moving the register aside |
| B18 | A live toggle naming a missing register entry fails | `tested` | CR-1's mapping check |
| B19 | `expired_at` with trailing junk is rejected (Trivy's shape, not `coerce_date`'s) | `tested` | falsified with `2026-10-28xyz` and `"20261028"` |
| B20 | A non-mapping or id-less ignore entry is rejected | `tested` | falsified with a bare-string entry |
| B21 | A header naming a different canonical repo fails | `tested` | falsified with header + manifest `sha256` both updated (the fork-re-vendor case) |
| B22 | A drifted `git show` reproduction command fails | `tested` | falsified the same way |
| B23 | Duplicate provenance lines fail | `tested` | `findall` + exactly-one assertion |
| B24 | The gate job runs the vendored drift guard on every trigger | `tested` | falsified by removing it from `security.yml` |
| B25 | A vendored module in a subdirectory cannot escape the reverse guard | `tested` | recursive scan keyed on relative path; verified it still matches the four flat modules and excludes `tests/` |

  **0 testable-but-untested.** 25 behaviors enumerated against 7 ACs.

- **Confidence-pattern check:**
  - *Asymptote (depth):* the CRLF finding came from refusing to accept "hash
    mismatch = upstream changed". The module upstream **never touched** in #507
    also mismatched, which falsified that reading and forced the real cause. Depth
    stopped when the hypothesis reproduced all four values exactly.
  - *Coverage (breadth):* probes span both retired backstops, both directions of
    the drift guard, both ignore-file shapes the reader accepts, and a control
    (P5) so a clean result cannot be confused with a dead gate.
  - *Integration composition:* n/a — `cross_component` does not fire; no framework
    cross-component machinery is touched.

## Notes for the next re-vendor

- Vendor from a **commit**, record it in `canonical_commit`, and hash the **git
  blob** (`git show <commit>:<path> | sha256sum`) — never a Windows working-tree file.
- Use `git merge-file` for `accepted_risks_cli.py`. The import block is the one
  place upstream and the local hardening overlap.
- Upstream's **malformed-`expired_at`** gap is still open and still backstopped
  here. If a later upstream release closes it, retire
  `test_no_trivy_suppression_has_an_unreadable_expiry` too — after probing, not
  on the strength of a changelog line.
- **Keep vendored modules FLAT under `scripts/ci/`.** Both the `eol=lf` pin
  (`scripts/ci/*.py`) and — before this run — the reverse-drift guard were
  non-recursive. The guard is now recursive; the pin is not. A module at
  `scripts/ci/lib/foo.py` would get CRLF on a Windows checkout and a false
  "edited in place" failure. If nesting ever becomes necessary, widen the
  `.gitattributes` glob in the same commit.
- **A probe that passes proves less than it looks.** P1 passed because live
  suppressions happened to exist, which hid the fact that `check` catches a
  deleted register only *conditionally* (D-1). When a probe is the evidence for
  removing enforcement, also run it in the state where the thing it depends on
  is absent.
