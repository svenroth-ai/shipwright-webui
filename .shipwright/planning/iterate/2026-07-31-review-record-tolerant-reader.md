# Iterate Spec: review-record-tolerant-reader

- **Run ID:** iterate-2026-07-31-review-record-tolerant-reader
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal

Make the Mission Review reader forward-compatible so the producer can stop working
around it: a per-run review record may carry review passes this reader does not know
and a schema version newer than the one it pins, and it is still a healthy record —
rendered, not reported as a data-integrity fault.

## Why now (the blocked half)

The producer records a **sixth** pass, the Stage-1 spec-compliance HARD-GATE. It cannot
put it where it belongs. `readReviewRecord` rejects a `reviews` object holding any key
outside its own five (`review-record.ts:276`) **and** rejects any `schema_version` other
than its constant (`:261`) — and an invalid record does not degrade to the marker view,
it renders **every** row as a data-integrity fault (`review-state.ts:242`). So the
producer parked the row in a sibling `gates` object this reader never inspects, purely
to avoid reporting healthy records as corrupt. Its own source says so, and names the
release condition verbatim:

> Promotion into `REVIEW_TYPES` — one line here, one there — becomes safe as soon as the
> webui ships a reader that tolerates unknown review types.
> — `shipwright/shared/scripts/lib/review_record_schema.py:74`

This iterate ships that reader. The monorepo half (move `spec` from `GATE_TYPES` into
`REVIEW_TYPES`, bump `SCHEMA_VERSION` to 2) follows **after** this merges — in the other
order it breaks the Mission view for every run.

## Acceptance Criteria

- [ ] **AC1** A record whose `reviews` object carries a key outside the pinned five is
      VALID. The reader returns the five pinned rows plus one row per unknown key,
      each mapped by the identical entry validation.
- [ ] **AC2** Row order is stable and pinned-first: the five in contract order
      (`self · plan · code · doubt · external_code`), then the unknown keys in the
      record's own key order.
- [ ] **AC3** A `schema_version` integer **greater than or equal to** the version this
      reader understands is accepted. A missing, non-integer, boolean or `< 1` version
      is still an integrity fault.
- [ ] **AC4** An unknown entry is validated exactly like a known one (`review_type`
      equality, status vocabulary, findings / `findings_count` agreement, `parse_status`
      vocabulary, disposition required for a terminal non-completed status, the
      `unstructured`-carries-no-findings invariant). **Where they differ is the blast
      radius, and only that:** a PINNED entry that fails is still the whole record, while
      an unknown one degrades to its own explicitly-unreadable row and leaves the five
      intact. Degraded, never dropped. *(Amended after the Stage-3 doubt review: the
      original made one unknown word in one unrecognised pass replace five
      perfectly-parsed rows with "could not be read" — applying a corruption prior to
      the one object this change defines as unknown-by-construction, with asymmetric
      costs.)*
- [ ] **AC5** An unknown key that is not a plain identifier (`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
      is an integrity fault — corruption is not evolution.
- [ ] **AC6** A **missing** pinned type still invalidates the record. The five may grow
      past, never shrink below.
- [ ] **AC7** The Review card renders an unknown pass as its own row, with the same
      status word, count rules and findings list as a known pass. Its name is DERIVED
      from its own key (`_` becomes a space, first character capitalised, " review"
      appended) and then shows the raw key: `spec` → "Spec review (spec)". Never
      invented, never a name map. **The parentheses are load-bearing, added after the
      Stage-2 review:** the derivation is not injective — `spec` and `spec_` both
      prettify to "Spec review" and HTML collapses the difference — so without the key
      in the VISIBLE text two different passes could render under one name, in the
      artifact whose whole purpose is not misleading its reader. `data-review-type`
      still carries the key for machines, and settles nothing for a person.
- [ ] **AC8** The number of review passes is bounded at 32. A record carrying more is an
      integrity fault stated as such — entries are NEVER silently dropped, because a
      dropped pass is exactly the invisible-review failure this artifact exists to
      prevent.
- [ ] **AC9** Every pre-existing behaviour is unchanged: an absent record still falls
      back to the markers, an unreadable one still reports the integrity fault without
      falling back, a record naming another run is still rejected, and the marker path
      still emits its five rows.
- [ ] **AC10 — reading forward is SAID, not silent.** *(Added by the Stage-3 doubt
      review, which is the finding that most changed this change.)* Accepting a newer
      version cannot be justified by "entry validation is total", because `toRow`
      validates only the fields it NAMES and rejects no added one — and additions are
      exactly what the producer's contract promises. The version pin was the only thing
      that ever caught them. So the summary line — the sentence a skimming reader
      finishes — states it when the reader has read past its own knowledge:
      **(a)** a `schema_version` beyond the newest this build understands, and
      **(b)** review passes recorded under a record-level key this build does not read,
      detected by SHAPE rather than by the name `gates`, so the next such sibling is
      disclosed the day it appears. (b) is not hypothetical: it is true of every record
      written today, which is why this run's own Review card was under-reporting five
      findings — two of them blocking — before this criterion existed.

## Spec Impact

- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.66 — the Review artifact's reading rule. Today a review pass the
  Command Center does not recognise makes the whole record read as broken; after this
  it is shown as its own pass. Appended as AC **(O)**.
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope

- **The monorepo half.** Moving `spec` into `REVIEW_TYPES` and bumping `SCHEMA_VERSION`
  is a separate change in a separate repo, and MUST land after this one. Opened as its
  own follow-up once this merges (decided with the operator, 2026-07-31).
- **Teaching this reader the name `spec`.** Adding it to the pinned five would make the
  reader REQUIRE it and invalidate every record written before it existed — the exact
  failure this iterate removes. The generic unknown-type path is the whole mechanism.
- **Relaxing entry validation.** Only the two gates named in the brief move.
- **The marker fallback BEHAVIOUR** (`review-state.ts`) — untouched. One attributed
  exception, and only one: its pinned order constant becomes `as const`, because
  widening `ReviewType` (AC1) would otherwise leave its `ReviewType[]` annotation
  unable to catch a typo it used to catch. No behaviour change; the Stage-1 spec
  review flagged the earlier "byte-for-byte" wording as contradicting the mini-plan,
  and this is the sentence that was wrong, not the code.

## Design Notes

No new UI surface. One new row shape in an existing list plus one truncation notice
reusing the Tests card's existing pattern and wording. Tier 1 (text) design check:
the unknown row is visually identical to a known row; the label is derived, never
invented, so a reader can always trace what they are looking at back to the record.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `shipwright/shared/scripts/lib/review_record_core.py:materialize` | `server/src/core/mission-context/review-record.ts:readReviewRecord` | JSON (`.shipwright/planning/iterate/<run_id>/reviews.json`) |
| `server/src/core/mission-context/types-slice2.ts` (`ReviewType`, `ReviewArtifact`) | `client/src/lib/missionContextApi.ts` (verbatim mirror) | TypeScript wire contract |

## Confidence Calibration

- **Boundaries touched:** the cross-repo `reviews.json` contract; the server→client
  Mission wire mirror.

- **Empirical probes run:**
  1. **Differential probe, reader level.** Ran the NEW tests against the OLD reader
     (`git show HEAD:…/review-record.ts` swapped in). Exactly 4 cases failed —
     newer-version accepted, unknown row returned, ordering, unknown entry mapped —
     and the other 28 passed in BOTH. Finding: the tolerance tests are load-bearing;
     the malformed-entry and key-grammar cases are absolute regression guards that
     pass either way, which is correct for their purpose but must not be counted as
     evidence the change works.
  2. **Differential probe, browser level.** Same swap, real server, real Chromium:
     the new E2E failed on `toHaveCount(6)` (the old reader rendered five
     integrity-fault rows). Finding: the E2E is not vacuous.
  3. **Real-producer round trip — the promotion itself.** Took THIS run's own
     `reviews.json` (real bytes from `record_review_pass.py`, not a fixture), applied
     the exact monorepo change that is waiting on this iterate — move `gates.spec`
     into `reviews`, bump `schema_version` to 2 — and read it back. Findings:
     as written today → `valid`, 5 rows (no regression); after promotion → `valid`,
     6 rows, order `self · plan · code · doubt · external_code · spec`, and the spec
     row correctly reads "has not answered yet" rather than a fabricated zero.
  4. **Transitional shape.** Same record with `reviews.spec` AND the old sibling
     `gates` both present — `valid`, 6 rows. Finding: the producer may promote and
     clean up in either order; a leftover `gates` key is ignored, so the two repos do
     not have to land in lockstep.
  5. **F0.5, real stack.** 6/6 Playwright tests green against a built client + real
     Hono on an isolated temp home (`surface_verification.py` exit 0).
  7. **The promotion probe, re-run against the final reader — and what it exposed.**
     The same real record, after the Stage-3 fixes: as written TODAY it now reports
     `valid, 5 rows` **plus the caveat** "This run also recorded 1 review pass
     somewhere this version does not read". That caveat is the proof of a defect that
     was live the whole time and that no test had ever asked about — this run's own
     Review card was summarising 14 findings across 3 reviews for a record holding 19
     across 5, including a spec gate whose first two findings begin "BLOCKING". After
     the promotion: `valid, 6 rows` + the newer-format caveat. With `gates` left
     behind during a transition: both caveats, 6 rows. The disclosure is not a
     hypothetical guard — it fired on the first real record it was pointed at.
  6. **A probe that failed, and what it caught.** Adding a `__proto__` case to the
     key-grammar table turned it RED — and the defect was in the test helper, not the
     reader: `reviews["__proto__"] = entry` sets the object's PROTOTYPE rather than
     creating a key, so the case had been asserting against a record that never
     carried it. Rewritten with `Object.defineProperty` (which is what `JSON.parse`
     does on the read side), it passes for the right reason. Worth stating plainly: a
     security-shaped test that passes while testing nothing is worse than no test,
     because it is counted as coverage.

- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Unknown review key is accepted and returns a row | tested | `review-record.validation.test.ts::accepts the record and returns a row for the unknown pass` PASSED (fails on old reader) |
  | 2 | Pinned five first in contract order, strangers appended in key order | tested | `…::keeps the pinned five FIRST, in contract order, and appends the strangers` PASSED |
  | 3 | Unknown entry maps through the identical entry rules (count, location, source) | tested | `…::maps an unknown pass through the SAME entry rules` PASSED |
  | 4 | `schema_version` newer than the floor is accepted | tested | `…::accepts a version NEWER than the one it was written against` PASSED |
  | 5 | `schema_version` `0` / `"1"` / `true` / `1.5` / `null` / missing still faults | tested | `…::still rejects a version that is not a whole number` (5 cases) + `…::still rejects a version OLDER than any that ever existed` PASSED |
  | 6 | A malformed unknown entry still invalidates the record (6 clauses) | tested | `…::still invalidates the whole record for an unknown pass with %s` (6 cases) PASSED |
  | 7 | A review key that is not an identifier is a fault | tested | `…::refuses a review key that is not a plain identifier` (5 cases) PASSED |
  | 8 | A missing pinned type still invalidates, even beside a valid stranger | tested | `…::still refuses a record that is MISSING a pinned type` PASSED |
  | 9 | 32 passes read; 33 is a stated fault, never a silent drop | tested | `…::is still bounded, and says so rather than dropping passes` PASSED |
  | 10 | A newer version is accepted only while its entries hold up | tested | `…::accepts a NEWER version only while its entries still hold up` PASSED |
  | 11 | The card renders the unknown pass as its own row | tested | `MissionSlice2Details.unknown-review.test.tsx::gets a row of its own beside the pinned five` + E2E `…never heard of, on a NEWER record` PASSED (E2E fails on old reader) |
  | 12 | Label is derived from the key; pinned names stay curated | tested | `…::derives %s from the key itself` (4 cases) + `…::keeps the curated name for the pinned pass %s` (5 cases) PASSED |
  | 13 | The raw key survives as the row's identity | tested | `…::keeps the RAW key as its identity` PASSED |
  | 14 | The derived label renders as text, never as markup | tested | `…::renders the unknown name as TEXT — never as markup` PASSED |
  | 15 | An absent record still falls back to the markers | untestable | covered-by-existing-test (`review-record.validation.test.ts::reports absent when there is no record`, `review-state.precedence.test.ts`) |
  | 16 | An invalid record still never falls back to the markers | untestable | covered-by-existing-test (`review-state.precedence.test.ts`) |
  | 17 | The marker path still emits exactly five rows | untestable | covered-by-existing-test (`review-state.test.ts`, E2E `…five passes, with unrecorded ones explicit`) |
  | 18 | The server↔client wire mirror stays in sync after widening `ReviewType` | untestable | covered-by-existing-test (`server/src/test/mission-context-types-sync.test.ts`, 519 mission-context tests green) |
  | 19 | The `review-record.ts` → `review-record-entry.ts` split is behaviour-preserving | untestable | covered-by-existing-test (`review-record.test.ts` mapping suite unchanged and green; full server suite 3122 passed) |
  | 20 | A record written by the REAL producer today still reads unchanged | tested | promotion probe #3: `valid`, 5 rows |
  | 21 | A record written by the real producer AFTER the promotion reads with 6 rows | tested | promotion probe #3/#4: `valid`, 6 rows, correct order, transitional `gates` tolerated |
  | 22 | A key that IS a plain identifier is accepted, including at the length bound | tested | `…::accepts a review key that IS a plain identifier` (1 char, 64 chars, `constructor`, `v2-GATE_x`) PASSED — added after the Stage-2 review noted the bound was only tested on its rejecting side |
  | 23 | A `__proto__` key is rejected, and cannot pollute | tested | `…::refuses a review key that is not a plain identifier: __proto__` PASSED (only after the helper was fixed — see below) |
  | 24 | Two passes whose names prettify alike stay distinguishable on screen | tested | `MissionSlice2Details.unknown-review.test.tsx::stays distinguishable ON SCREEN when two keys would prettify alike` PASSED |
  | 25 | `reviewTypeLabel` does not throw on a non-string type | tested | `…::does not throw on a row whose type is not a string` PASSED |
  | 26 | Both sides of the wire mirror keep the open arm of `ReviewType` | tested | `server/src/test/mission-context-review-type-widening.test.ts` (2 cases) PASSED — the sync guard reads quoted literals only and is structurally blind to this |
  | 27 | `reviewWord` returns a string for an unpinned type, and the pinned table stays exhaustive | untestable | covered-by-existing-test — the fix is a TYPE narrowing plus a runtime `in` fallback; the Stage-3 review correctly flagged that no test can fail on it, so this row states that honestly rather than claiming suite coverage it does not have |
  | 28 | An unknown pass whose entry is malformed degrades to its own unreadable row, leaving the pinned five intact | tested | `review-record.tolerance.test.ts::degrades — never drops, never blanks the record` (6 cases) PASSED |
  | 29 | A PINNED pass whose entry is malformed still invalidates the whole record | tested | `…::keeps a PINNED pass strict — its failure is still the whole record` PASSED |
  | 30 | A newer `schema_version` is disclosed in the summary | tested | `…::says so when it has read PAST what it understands` PASSED + E2E `artifact-summary` contains "newer Shipwright" in a real browser |
  | 31 | Passes under a record-level key this build does not read are counted and disclosed | tested | `…::says so when passes are recorded somewhere it does not read` PASSED + promotion probe on this run's real record |
  | 32 | A caveat reaches the SUMMARY and is never left as the last good news | tested | `artifacts-slice2.review-decisions.test.ts::carries a caveat into the SUMMARY` PASSED (asserts ordering, not just presence) |

  0 untested-testable. 32 behaviors enumerated against 10 ACs.

- **Confidence-pattern check:**
  - **Asymptote (depth):** YES, and it fired THREE times, each time after I had
    treated the design as settled. (1) After the external plan review, the Stage-1
    spec gate found two real defects — the FR-01.66 acceptance line was declared in
    the Spec Impact block and never written, and the Out-of-Scope bullet contradicted
    the mini-plan. (2) After that, Stage 2 found the one site my own `ReviewType`
    audit structurally could not reach, because it is spelled
    `Record<ReviewRow["reviewType"], string>`. (3) After THAT, Stage 3 falsified the
    central safety claim of the whole change: "entry validation is total" covers
    reshapes and not ADDITIONS, and additions are what the producer's contract
    actually promises — so the version pin this iterate removes was the only thing
    that ever caught them. Each round was followed by another probe rather than by a
    restatement of confidence; probe #7 is the one that verified the fix on real
    producer bytes and, in doing so, showed the reader had been silently
    under-reporting this very run.
  - **What that pattern says, plainly:** every one of the three rounds found something
    the round before it could not have found. That is the asymptote behaving exactly as
    documented, and it is the reason "are you confident?" was not asked at any point.
  - **Coverage (breadth):** every row above is `tested` or `untestable` with a valid
    `reason_code`; nothing is "could test but didn't".

## Verification (medium+)

- **Surface:** web
- **Runner command:** `node <playwright-cli> test --config client/playwright.config.ts client/e2e/flows/mission-artifacts-s2.spec.ts` against an isolated stack (temp `USERPROFILE`, Hono + built client on 127.0.0.1)
- **Evidence path:** `.shipwright/planning/iterate/iterate-2026-07-31-review-record-tolerant-reader/f05/`
