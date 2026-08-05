# Mini-plan — iterate-2026-08-01-pr-review-stale-verdict

Port monorepo ADR-117 (shipwright#508) into this repo's vendored Tier-3 reviewer:
on a **passing** verdict, dismiss this reviewer's own superseded
`CHANGES_REQUESTED` reviews.

## Chosen approach — port the behaviour, adapt the shape

Canonical split the feature into a pure selector plus a calls module. This repo's
copy is older and flatter (`scripts/ci/pr_review.py` + `pr_review_lib.py`, with the
`gh` wrappers inline in the tool). Port the **selector verbatim** — it is the whole
safety surface and three upstream review rounds narrowed it — and adapt only the
wiring.

### Step order (TDD — red first at each step)

1. **`scripts/ci/tests/_pr_review_fixtures.py`** — shared review-shape builders
   (`NONCE`, `OTHER_NONCE`, `HEAD`, `OLD`, `BOT`, `review()`, `anchor()`,
   `marked_body()`, `crlf_body()`). Ported; the CRLF builder is load-bearing.
2. **`test_pr_review_dismiss.py`** (RED) → **`pr_review_dismiss_select.py`** (GREEN).
   The pure ownership rule. Verbatim port.
3. **`test_pr_review_gh.py`** (RED) → **`pr_review_gh.py`** (GREEN). Move the three
   existing wrappers **verbatim**; add `_decode_pages`, `list_pr_reviews`,
   `fetch_pr_head_sha`, `dismiss_pr_review`.
4. **`test_pr_review_dismiss_calls.py`** (RED) → **`pr_review_dismiss.py`** (GREEN).
   Best-effort orchestrator + local `strip_display_unsafe`.
5. **`test_pr_review_stale_verdicts.py`** (RED) → wire **`pr_review.py`** (GREEN):
   mint the nonce, `read_reviewed_head()` **before** `fetch_pr_diff`, `_post_verdict()`
   stamps + reports whether the state landed, dismiss on a passing verdict only.
6. **Re-point `test_pr_review_script.py::TestGhWrappers`** at `pr_review_gh`
   (Test-Update-Klausel — the wrappers moved, so their tests move with them).
7. **Update the vendor-provenance header** on `pr_review.py`: this copy is no longer
   "byte-identical to canonical" in behaviour. Enumerate the divergence honestly.
8. **Line-count check** — `pr_review.py` must land **≤ 300** with no new baseline entry.

### Verification

- `python -m pytest scripts/ci/tests -q` (the gate both `pr-review.yml` and
  `security.yml` run).
- Line-count assertion on `pr_review.py` as an explicit test, not a manual look.
- **Mutation-verify** the three guards whose deletion leaves the suite green:
  the head-read ordering, the `.strip()` in `_own_marker` (CRLF), and the
  `isinstance(user, dict)` guard.
- F0.5: `surface = cli` — live **read-only** probes against the real GitHub API
  with the real `gh` CLI (list reviews, read head, run the selector over real
  objects). No mutating call is made in verification.

## Alternative considered — re-vendor the whole canonical `pr_review*` tree

Canonical has moved well past this copy: a generated-artifact diff filter, a
rendering module, byte-level diff reads, `nothing_reviewed_summary`, a reworked
truncation notice. Re-vendoring would bring the ADR-117 behaviour *and* three
unrelated behaviour changes under one heading.

**Rejected** because it makes the actual safety surface unreviewable — the whole
point of the upstream split was that the ownership rule can be read on its own —
and because each of those other changes deserves its own risk assessment and its
own acceptance criteria. It is also the larger irreversible-write risk: shipping
a mutating GitHub call inside a diff nobody can hold in their head is exactly how
an over-reach bug survives review. Filed as follow-up rather than smuggled in.

## Risk

The one dangerous direction is **over-dismissal** — retracting a *human's*
blocking review on this repo's own merge gate. Every guard in the selector exists
against that, and the tests weight refusal cases over the happy path accordingly.
Dismissal has no inverse, so the ownership rule is ported verbatim and is
explicitly out of scope for "simplification".
