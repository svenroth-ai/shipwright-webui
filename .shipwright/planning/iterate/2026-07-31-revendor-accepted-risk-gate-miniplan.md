# Mini-plan — iterate-2026-07-31-revendor-accepted-risk-gate

**Intent:** CHANGE · **Complexity:** medium · **Spec Impact:** NONE (behaviour of
the CI gate changes, but no FR does — this carries an upstream fix downstream)

## Problem

`scripts/ci/` vendors four shared modules with a sha256 manifest. The manifest
records the upstream hash but **nothing verifies it** — a recorded decision, since
the only offline check would need a workstation-only env var plus a sibling clone
that is not guaranteed present. Consequence: when upstream changes, nothing here
says so. SecFix-3 landed upstream (shipwright #507, commit `987e49c6`) and fixes
two fail-open holes this repo had backstopped locally. The re-vendor will not
happen by itself and the drift guard will not raise it, so it needs its own card.

## Chosen approach

1. **Re-vendor mechanically, not by hand.** Three verbatim modules = upstream body
   + re-inserted vendor header. The adapted CLI = `git merge-file` 3-way merge of
   upstream's delta onto the vendored file, so the local hardening is *preserved*
   rather than re-typed. Refresh both manifest hash columns.
2. **Probe before deleting.** Run the *re-vendored* gate against mutated copies of
   this repo's real state, one probe per retired backstop plus a control. Retire
   only what a probe proves is covered.
3. **Keep the `eol=lf` pin untouched.**

## Alternative considered — and rejected

**Hand-apply upstream's diff to the vendored files.** Rejected: the CLI's two
hardening changes sit exactly where upstream edited (the import block), so a
manual reconciliation is where a silent drop would happen. A 3-way merge makes the
one genuine overlap surface as a conflict that must be resolved deliberately —
which is what happened, and it was the *only* conflict.

**Delete both backstops as instructed, unconditionally.** Rejected on evidence:
probe P3 shows upstream does **not** cover the malformed-date half of EC-2, and
upstream's own docstring files that case as out of scope. Deleting it would be a
silent enforcement regression. Retire the covered half, keep the uncovered half.

## Risks

| Risk | Handling |
|---|---|
| New lapse logic turns CI red on landing | Pre-checked: all three `expired_at` dates are future-dated and each pairs with a register `expires`. Probe P0 = exit 0 |
| Local hardening silently dropped | 14-point assertion over the merged CLI (converge absent, try/except present, yaml-scoped handler, new upstream symbol present) |
| Verified in a richer env than CI has | Verification runs in a throwaway venv: Python 3.11.15 + `pytest` + `pyyaml` **only**, matching both jobs' `pip install` line |
| CRLF corrupts the byte-hash on Windows | `eol=lf` pin kept; `git ls-files --eol` confirms `i/lf w/lf` on every touched file |
