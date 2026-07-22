# Iterate Spec: show what the reviews actually found

- **Run ID:** iterate-2026-07-22-mission-review-record
- **Type:** feature
- **Complexity:** medium (history-calibrated, n=20)
- **Risk flags:** none automated; `touches_io_boundary` **declared by hand** — this
  is the CONSUMER half of a cross-repo serialized contract.
- **Spec Impact:** MODIFY — extends **FR-01.66** with a dated `(iterate-…)` AC
  line, per the campaign's "no new FR minted" rule.
- **Origin:** the open follow-up from webui campaign `2026-07-18-mission-artifacts`
  Slice 2 (`trg-74ec44b8`). Producer side delivered in shipwright monorepo
  **PR #428** (`iterate-2026-07-21-review-record`).

---

## Problem

Slice 2 shipped the Review artifact from the only sources that had a clean
contract — the two `external_*review_state.json` markers — and represented the
internal self / code / doubt passes **explicitly as unavailable**, with a note
naming the gap. That was the right call then: the alternative was scraping raw
JSONL, and guessing a contract would have fabricated review history.

The monorepo has since closed the gap. Every iterate now writes a per-run record:

```
.shipwright/planning/iterate/<run_id>/reviews.json
```

keyed by review type, carrying **individual findings**, immutable once a pass has
answered. So today webui:

1. **renders three of five types as permanently "unavailable"** via a hardcoded
   note, even when a real record sits on disk next to the markers it does read;
2. **has no `self` type at all** — yet at trivial and small complexity the
   Self-Review is the ONLY review that runs, so the commonest case shows nothing;
3. **states "the individual findings were not recorded, only the count"** — a
   sentence that was true of the marker and is now false of the record.

The producer emits the data; the consumer does not read it.

## What the producer guarantees (pinned by PR #428)

```json
{ "schema_version": 1, "run_id": "iterate-…",
  "reviews": { "<type>": { "review_type", "status", "findings_count",
                           "findings": [...], "provider", "completed_at",
                           "disposition", "recorded_by", "parse_status",
                           "raw_excerpt" } } }
```

- `reviews` always holds **exactly five** keys: `self · plan · code · doubt ·
  external_code`. A type nobody recorded reads `pending`.
- `status` ∈ `pending | completed | not_run | not_applicable`. A terminal
  non-`completed` status always carries a `disposition` naming the rule.
- `findings_count == len(findings)`, enforced on write.
- Each finding: `{severity: high|medium|low|null, category, file, line, finding,
  suggestion, source}`.
- `parse_status` ∈ `structured | partial | unstructured | null` — set for the
  external passes. **`unstructured` means the review RAN and its prose could not
  be itemized**, which is NOT the same as a clean review, and `findings_count`
  is then 0 for a review that may have found plenty.

## Non-goals

- Changing the record format. This iterate consumes it; the producer is merged.
- Backfilling records for the 64 existing runs — they keep today's behaviour.
- Rendering `raw_excerpt` (the unparsed reviewer prose). Bounded but long;
  the honest note is what the artifact owes the reader, not the raw dump.

## Behaviour

**Source precedence.** `reviews.json` is authoritative when present and valid.
When absent, fall back to today's marker read exactly as it behaves now — the
64 existing runs must not regress. When present but corrupt, that is an
integrity fault: report `unavailable`, never fall back silently to the weaker
source and never report it as an absence.

**`self` becomes a fifth type**, rendered first (it is the one review that
always runs). On the fallback path it has no source, so it reads `unavailable`
with the existing note.

**A `completed` pass whose `parse_status` is `unstructured`** renders its count
AND a note saying the findings could not be itemized — never a bare "0 issues",
which reads as "found nothing".

## Acceptance criteria

- **AC1** With a valid `reviews.json`, all five types render from it: real
  statuses, real `findingsCount`, and per-finding detail (severity, text, and
  `file:line` where the record has them).
- **AC2** `self` is present in the contract order (self · plan · code · doubt ·
  external_code) and labelled in plain language ("Self-review").
- **AC3** A `not_run` / `not_applicable` type renders its `disposition` — the
  reason the pass did not run — instead of the generic unavailable note.
- **AC4** A `pending` type renders as `unavailable` (the producer's gate should
  prevent it reaching here, but a mid-run read can see it).
- **AC5** Absent `reviews.json` → today's marker behaviour, unchanged, including
  the internal-pass note. Verified against a fixture built from a real 64-run-era
  layout.
- **AC6** Corrupt or schema-invalid `reviews.json` → `unavailable` with an
  integrity note; it does NOT silently fall back to the markers, and does NOT
  read as "no reviews".
- **AC7** A `completed` pass with `parse_status: unstructured` shows the count
  plus "could not be itemized"; it never renders as a clean review.
- **AC8** A finding with `severity: null` renders without inventing a severity.
- **AC9** The record is read through the existing path guard and bounded read —
  an oversized or escaping path is refused like every other artifact source.
- **AC10** The client type mirror stays byte-aligned with the server SoT
  (`mission-context-types-sync.test.ts` green), and the renderer shows the new
  fields.

## External plan review — findings and disposition

gemini + openai via OpenRouter, 2026-07-22. 10 findings. (First attempt came back
**degraded** — `openai` package absent from the webui env — and was re-run with
`uv run --with openai`; a degraded gate is never recorded as completed.)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| O1 | high | Producer state is inconsistent: spec says delivered, risk says blocked | **accepted** — monorepo #428 is green but not merged. The fixture is pinned to the exact producer commit and the test records that SHA; **merging #428 is a stated prerequisite for merging this PR**, not something graceful-absence covers. |
| O2 | high | Types cannot express AC3/AC7 — no `parseStatus`, and the renderer cannot distinguish provenance | **accepted** (`disposition` already existed; `parseStatus` did not). Adding `parseStatus` AND `source: "record"｜"marker"` to the SoT rather than folding either into free-text `note` — a renderer that has to string-match a sentence to pick a branch is a renderer that breaks when the sentence is reworded. |
| O3 | high | Validation must check `schema_version` and `run_id`, not just the five keys | **accepted** — a stale or copied record at a valid guarded path would otherwise render as this run's history. The producer validates its own `run_id` for exactly this reason; the consumer must not trust the file's own claim either. |
| O4 | med | "absent" must mean ENOENT ONLY; every other read failure is an integrity fault | **accepted** — the reader returns a discriminated `valid ｜ absent ｜ invalid`. Only `absent` may fall back to markers; oversize, path-guard rejection, bad UTF-8, bad JSON and schema failure are all `invalid`. |
| G1/O5 | high/med | A mid-run read could see partial JSON and render a false integrity fault | **rejected — disproved, not argued.** The producer writes through `durable_atomic_write`: same-directory temp file → `fsync` → `os.replace`. A reader therefore sees the whole old file or the whole new one, never a partial one; `os.replace` is atomic on both POSIX and Windows. A retry loop would add a real failure mode (masking genuine corruption) to defend against one that cannot occur. Verified in `shared/scripts/lib/atomic_write.py`. |
| G2 | med | The corrupt-record state is not exposed in types or the renderer | **rejected — already handled.** `buildReviewArtifact` maps `sawUnreadable` to `state: "unavailable"` with a note, and the panel renders that state today; the §6 state model exists precisely so an unreadable artifact shows rather than hides. Covered by AC6 instead of new plumbing. |
| G3 | low | The bounded-read limit was tuned for tiny markers | **accepted, measured** — the real 46-finding record is **46 KB** against a 256 KB marker bound. Comfortable today, but one noisy run away from a false integrity fault, so the record gets its own 2 MB bound. |
| G4/O6 | low/med | "0 issues (could not be itemized)" still reads as a clean pass to a skimmer | **accepted** — when `parseStatus` is `unstructured` the count is suppressed entirely and only the caveat renders. The whole artifact exists to stop a reader completing "0" into "found nothing". |
| O6b | med | The "count but no findings" message is only meaningful for the marker path | **accepted** — the branch is now driven by `source`: marker-backed keeps "details were not recorded"; record-backed `unstructured` gets the itemization caveat; record-backed structured rows render their items. |

## Code review — findings and disposition

Internal `code-reviewer` (10) + external cascade gemini/openai (4), 2026-07-22.
**All 14 fixed.** The three that mattered most:

| Sev | Finding | Disposition |
|---|---|---|
| high | **The artifact SUMMARY ignored `parseStatus`.** An unstructured pass counted as 0, so the summary read "1 review ran and raised no issues" — printed ABOVE the renderer's own caveat. I fixed the renderer and left the line a skimmer actually reads first. | **fixed** — `counted` now excludes unstructured; pinned by a `buildReviewArtifact` test asserting the summary never matches /no issues/i. |
| high | **`existsSync` cannot mean ENOENT.** It swallows every errno, so an unreadable record (EACCES, broken symlink, a directory in the file's place) would report "absent" and silently fall back to the markers — the exact downgrade this reader exists to prevent, and the exact class the PLAN review had already warned me about (O4). | **fixed** — `statSync` with explicit ENOENT discrimination, a non-file check, and the `realPathGuard` half of the documented guard pair. |
| high | **The existing E2E was left red** (`toHaveCount(4)`, now five rows) and no record-path E2E existed, so AC1/AC7 had no end-to-end coverage at all. | **fixed** — spec updated to five, plus a new E2E that seeds a real-shaped `reviews.json` and asserts the self row, a per-finding location, "did not apply" + reason, and that an unstructured pass shows NO count. Run in a real browser: 5 passed. |
| med | An all-`pending` record reported `hasRecord: true`, so Review appeared mid-run saying "No review was recorded as having run" — worse than the honest "not written yet" it replaced. | **fixed** — `hasRecord` means "a source carried an answer" on both paths. |
| med | The `isSafeRunId` branch in the marker path was unreachable, and the surviving path claimed a record "exists but could not be read" for a file nobody probed. | **fixed** — guard hoisted, dead branch deleted. |
| med | `partial` was treated exactly like `structured`, presenting a count known to UNDERSTATE what was found as precise. | **fixed** — its own caveat; the count stays, as a floor. |
| med | Four adjacent spans, no separator text, no CSS: findings would render as `mediumthe lock is releasedserver/src/x.ts:42widen the lock`. **jsdom normalizes this away and cannot catch it.** | **fixed** — CSS added, and asserted in a REAL browser via `toHaveCSS("display","flex")`, which is the only place this is visible. |
| med (ext) | Unknown `parse_status` normalized to null; `not_run` accepted with no reason; `unstructured` accepted alongside itemized findings. | **fixed** — all three are now schema faults. |
| low | `as ReviewStatus` cast severed the union link — a sixth producer status would reach the client's exhaustive switch and render an EMPTY status word. | **fixed** — typed `Record` lookup; it is a compile error now. |
| low | Findings rendered unbounded against a 2 MB record bound, unlike every other Slice-2 detail. | **fixed** — capped at 50 per row, with the cap DISCLOSED. |
| low | Spec Impact declared MODIFY with no FR-01.66 AC line; the F11 gate fails closed on that. | **fixed** — dated `(M)` AC line added. |
| med (ext) | The AC5 fallback fixture is hand-written, not lifted from a real pre-record run. | **partially accepted** — the marker shape it uses was measured from this repo's 55 real markers when the marker path was written, and that path is otherwise untouched and still covered by its original tests. Copying a second real fixture would re-pin a shape nothing in this diff can move. |

## Affected Boundaries

**Cross-repo consumer.** Producer: shipwright monorepo
`shared/scripts/lib/review_record*.py` (PR #428). Consumer: this change. The two
repos never import each other (DO-NOT #7), so the shape is mirrored by hand and
the only protection is a fixture pinned to the producer's real output — a
fixture invented here would test my belief about the producer rather than the
producer. **The fixture is therefore copied verbatim from a record the monorepo
tool actually wrote**, and its provenance is recorded in the test.

Second boundary: server SoT → client mirror, guarded by the existing sync test.

## Confidence Calibration

- **Boundaries touched:** the cross-repo record contract (producer: shipwright
  monorepo `review_record*.py` at commit `84a246cb`, PR #428; consumer: this
  change), and the server SoT → client mirror. Neither repo can import the other.

- **Empirical probes run:**
  1. **The fixture is copied, not written** — `reviews-record-real.json` is
     byte-for-byte the record the producer wrote for its own run (5 types, 46
     findings). A fixture I authored would have tested my belief about the
     producer, which is how cross-repo contracts rot.
  2. **Measured the record**: 46 KB against a 256 KB marker bound — comfortable
     today, one noisy run from a false integrity fault, hence its own 2 MB bound.
  3. **Disproved the atomicity concern** rather than defending against it: both
     external reviewers wanted a retry loop for partial reads; the producer
     writes through `durable_atomic_write` (temp → `fsync` → `os.replace`), so a
     torn read cannot occur and a retry would have added a real failure mode
     (masking genuine corruption) to guard an impossible one.
  4. **Real-browser CSS assertion** — the four finding spans have no separator
     text, so `toHaveCSS("display","flex")` in Playwright is the only check that
     can see the defect; jsdom normalizes it away.
  5. **The `partial` path validated itself on real data**: recording this run's
     own external cascade produced `parse_status: "partial"`, because gemini's
     leg did not itemize and openai's did.

- **Test Completeness Ledger:** in `shipwright_test_results.json`
  → `iterate_latest.test_completeness`; **0 testable-but-untested**.
  ~5,935 tests green across both workspaces plus 5 real-browser E2E.

- **Confidence-pattern check:**
  - *Asymptote.* Three reviewers produced 14 findings and converged on ONE
    cluster — the honesty rules I had applied at the row level but not at the
    summary, the marker fallback, or the schema edges. That is a signal the
    cluster was real, not that depth was exhausted.
  - *Coverage.* All five types, four statuses, three parse states, both sources,
    absent/invalid/valid, and the renderer for each. NOT covered: the producer
    itself (other repo, tested there).
  - *Residual, stated plainly.* The Stage-3 doubt pass did NOT run — recorded as
    `not_run` with that reason in this run's own review record, which is exactly
    the mechanism this feature adds. On the previous iterate that pass caught two
    ship-blockers, so its absence is a real reduction in assurance, not a
    formality. **Producer PR #428 is also not merged yet**, so until it lands
    this consumer simply never sees a record and every run keeps today's
    behaviour.

