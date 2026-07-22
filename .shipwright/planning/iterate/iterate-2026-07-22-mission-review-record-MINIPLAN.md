# Mini-Plan: iterate-2026-07-22-mission-review-record

## Chosen approach — record-first, marker-fallback, one reader

**1. `server/src/core/mission-context/review-record.ts` (new, ~150 LOC)**
Reads and validates `.shipwright/planning/iterate/<run_id>/reviews.json` through
the existing `pathGuard` + `readBoundedFile`, and maps it to `ReviewRow[]`.
Validation is deliberately strict and mirrors the producer's own schema check
(five keys, key == `review_type`, closed status vocabulary, `findings_count ==
findings.length`): a record that fails it is an integrity fault, not an absence.
Its own module because `review-state.ts` is 231 LOC against the 300 ceiling and
the marker reader stays exactly as it is.

**2. `review-state.ts` (modified, ~+35 LOC)**
Becomes the precedence resolver: try the record; on success return its rows; on
absence fall through to today's marker path untouched; on corruption return an
`unavailable` lookup carrying `sawUnreadable: true` so `buildReviewArtifact`
SHOWS it rather than hiding the artifact. `reviewStatePaths()` gains the record
path so a late-written record refreshes the artifact's `sourceRev`.

**3. `types-slice2.ts` (modified, ~+20 LOC)**
- `ReviewType` gains `"self"`, and the contract order becomes self-first.
- `ReviewStatus` gains `"not_applicable"` — the producer distinguishes "did not
  apply at this size" from "applied and was skipped", and collapsing them here
  would throw away the distinction the disposition then has to re-explain.
- `ReviewFinding` gains `location: string | null` (`file:line`, pre-joined
  server-side so the client does no formatting) and `suggestion: string | null`.
  `title` keeps its name and carries the finding text.

**4. Client mirror + renderer**
`missionContextApi.ts` mirrors the SoT verbatim (the existing
`mission-context-types-sync.test.ts` fails the build on drift).
`missionArtifacts.ts` gains the `self` label and a `not_applicable` status word.
`MissionSlice2Details.tsx` renders `location` and `suggestion` per finding, and
**deletes** the now-false "the individual findings were not recorded, only the
count" branch in favour of one driven by the data: shown only when a completed
pass really has a count and no findings.

**5. Tests**
- `review-record.test.ts` — mapping, all five types, the four statuses, strict
  validation rejections, `severity: null`, `parse_status: unstructured`.
- `review-state.test.ts` (extend) — precedence: record wins; absent → marker
  path unchanged; corrupt → `unavailable`, never a silent marker fallback.
- **A real-output fixture** copied verbatim from the record the monorepo tool
  wrote for `iterate-2026-07-21-review-record` (46 findings across 5 types),
  with its provenance recorded in the test — see "the fixture" below.
- Client unit for the renderer; E2E for the rendered artifact (medium+ ⇒ RUN).

## The fixture is copied, not written

The producer lives in another repository and this consumer cannot import it, so
a hand-written fixture would encode *my belief* about the producer's output —
which is exactly the failure mode that makes cross-repo contracts rot. The
fixture is therefore lifted byte-for-byte from a record the monorepo tool
actually produced, and the test names where it came from. If the producer's
shape moves, this fixture is the thing that has to be re-copied, and saying so
in the test is what makes that obvious to the next reader.

## Alternative considered — extend `review-state.ts` in place

Add the record read to the existing module, branch inside `readReviewState`.

**Cheaper by one file, and rejected.** `review-state.ts` is 231 LOC against a
300-line rule; the record reader plus its validation is ~150 more. It would
breach the ceiling immediately and force the split anyway, but *after* the two
readers had been interleaved — and the marker path is code I explicitly do not
want to touch, because 64 existing runs depend on its exact behaviour. Keeping
it untouched and adding a reader beside it means the fallback path is proven
unchanged by the tests that already cover it.

## Risks

- **The producer is not merged yet** (monorepo #428 is green but blocked on a
  review dismissal). The shape is committed and test-pinned there, and this
  consumer degrades to today's behaviour when the file is absent, so shipping
  ahead is safe — but the fixture must come from the merged commit, not a draft.
- **Rendering more per finding lengthens the panel.** Bounded: `location` is one
  short span, `suggestion` is clamped, and the row order puts severity first.
