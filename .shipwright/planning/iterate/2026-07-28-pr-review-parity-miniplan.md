# Mini-Plan — `iterate-2026-07-28-pr-review-parity`

## Chosen approach: port canonical module-for-module, tests first

Recreate the canonical six-module shape inside the flat `scripts/ci/` layout,
keeping every canonical docstring and comment (they carry the *why* that the
vendoring convention says to mirror), and re-point only the five declared
adaptations. Tests are ported alongside each module, then mutation-probed.

**Order (each step green before the next):**

1. `pr_review_generated.py` — policy, no dependencies. Tests: membership matrix,
   lockfile-absence, agent-doc non-blanket.
2. `pr_review_diff_filter.py` — mechanism (LF split, stop-at-`@@`,
   `count_sections`, `ReviewedDiff`, boundary cut, `MAX_DIFF_CHARS = 1M`).
   Tests: forged-boundary matrix (9 break chars), truncation, filter.
3. `pr_review_render.py` — `safe_path` (alphabet + brace strip + 160-char bound),
   `_path_list`, `build_pr_meta`, `nothing_reviewed_summary`, `render_comment`.
4. `pr_review_gh.py` — bytes fetch + explicit UTF-8 bodies + raise on non-zero.
5. `pr_review_openrouter.py` — HTTP boundary, `DEFAULT_TIMEOUT = 600`.
6. `pr_review_lib.py` — pure core + one-pass `build_messages` + re-exports.
7. `pr_review.py` — orchestration: filter → fail-closed-on-nothing → truncate →
   `build_pr_meta(**missing)` → `build_messages` (ValueError → redacted EXIT_ERROR).
8. Rewrite `test_pr_review_{lib,script}.py` for the moved monkeypatch targets.

**Why this order:** every step compiles and tests green on its own, and the two
security fixes that must land together (one-pass fill + brace strip) both sit in
steps 3 and 6, *before* step 7 wires the path lists that would make them live.

## Alternative considered: minimal three-fix patch (brief steps 1–3 only)

Fix the chained `.replace()`, the `text=True` fetch and the sanitiser in place;
skip the filter, the 1M cap and the fail-closed gate. **Rejected.**

- It leaves the only *currently live* exposure untouched — the gate has no lower
  bound on what it reviewed, so an empty or header-less fetch is a green required
  check over an unread change. That needs no attacker and is not one of the three.
- The sanitiser fix (brief step 3) presupposes a metadata block that lists changed
  paths. This fork has none, so "port the sanitiser" without the filter/truncation
  work would ship a sanitiser guarding a sink that does not exist — dead code that
  reads as a defence.
- It would leave the fork mid-way between two canonical versions, which is the
  worst state for the next vendor-sync: neither "behind by one run" nor "current".

**Cost of the chosen path, accepted:** a ~1,000-line diff on a required gate,
where the minimal patch would be ~30. Mitigated by porting canonical text verbatim
(reviewable against a known-good source), by the module split keeping every file
under the guideline, and by mutation-probing each pin.

## Risks

| Risk | Mitigation |
|---|---|
| This PR touches `scripts/ci/` → the gate reviews **its own** modified code from the PR head | `selftest` (offline pytest) runs first and on every PR incl. forks; run the full vendored suite locally before push |
| Monkeypatch targets move (`pr_review.subprocess` → `pr_review_gh.subprocess`) | Rewrite both existing test modules in the same commit; keep `__all__` complete and pin it |
| Non-ASCII in the sanitiser character class could be mangled by tooling | Build the class from explicit codepoints (`chr(0x202a)`), never literal glyphs in source |
| 1M cap × non-streaming request could time out at 120 s | `DEFAULT_TIMEOUT = 600`, shared by the CLI flag and the direct call |
