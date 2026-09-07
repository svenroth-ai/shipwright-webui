# Reader on manifest v4: accept AC-scoped `@covers` tags without a false "ahead" warning

**Run:** `iterate-2026-09-07-w3-reader-manifest-v4` (sub-iterate `w3`,
campaign `req3-06-mechanics-webui`)

## Context

Sub-iterate w3 ("Reader on manifest v4") is the consuming half of a
cross-repo contract: the monorepo's `test-traceability.json` collector bumps
its manifest to `schema_version` 4 once a repo starts using the new
AC-scoped `@covers` tag grammar (`covers("FR-01.11/AC07")`). w3's own spec
required this unit to verify the precondition itself before implementing —
"do NOT implement a reader against a schema that does not exist yet" — and
to halt with a named reason if unmet, per the escalated attempt of this same
unit on 2026-09-07 (loop `sub_iterate-20260906-211316`, which correctly
halted because P3.2 was not yet merged).

## Precondition re-verified (before any code change)

- `git -C shipwright fetch origin` → `origin/main` tip `c0d1b38be27730dca4c9f00afc4538dd10f76e56`
  ("feat(compliance): AC-scoped `@covers` tag grammar + test-traceability
  manifest v4 (P3.2) (#686)").
- `git show origin/main:plugins/shipwright-compliance/scripts/lib/traceability_schema.json`
  pins `"schema_version": {"const": 4, ...}`, title "Test-Traceability
  Manifest v4".
- Mechanically diffed against the prior commit (`227a525e4`, schema v3):
  `git diff 227a525e4..c0d1b38be2 -- .../traceability_schema.json`. The
  delta is exactly the `$id`/title/description strings, `schema_version.const`
  3→4, and two additive blocks (`requirement.acs` + the new `acNode` def,
  `testLink.ac_id`). No required field, enum, or pattern changed.

Precondition met — proceeded to build.

## Decision

**Bumped `TRACEABILITY_SCHEMA_VERSION` 3 → 4** in
`server/src/core/contract-version.ts`, with an updated doc comment
describing what v4 adds and why the reader (`traceability.ts`) needs no
logic change: it never validates `additionalProperties` and only ever
reads `.id`/`.tests[<layer>][*].id/.layer/.resolved_from` — every field
required in BOTH v3 and v4, unchanged by the bump. `acs`/`ac_id` are new,
optional, additive fields this reader does not consume; they are omitted
entirely on a manifest with no AC tag anywhere, so a v4 manifest can still
be byte-identical in shape to a v3 one.

**No change to `traceability.ts` itself.** Deliberately out of scope:
surfacing `ac_id`/`acs` downstream (client types, mission-context
artifacts) is left for whichever future sub-iterate actually needs
AC-scoped data (w5 depends on w3, but its own predicate is about spec-side
`required_layers` promotion, not this manifest field — if it turns out to
need `ac_id`, that is its own review to make).

**Frozen fixture** (`traceability.v4-fixture.test.ts`, 3 new tests): two
manifests copied field-for-field from the shipped schema's
`$defs.requirement`/`$defs.testLink`/`$defs.acNode` shapes (not reduced to
"what the reader happens to read"), plus a third mixed manifest combining
both in one file:

- `WITH_AC_TAG` — a requirement carrying `acs` + a test link carrying
  `ac_id`. The link ALSO carries `resolved_from` (external code review,
  medium finding — the first version of this fixture never exercised fold
  provenance alongside the new v4 fields).
- `BARE_FR_TAG` — a requirement with neither — the "v3-shaped bare FR tag"
  case the unit's AC names explicitly.
- `MIXED_MANIFEST` — both requirements in the SAME manifest (external plan
  review, edge-case finding), confirming no cross-requirement state leak.

All three assert `status: "ok"`, no `contract_version_ahead` warning, and
the correct `byFile` inversion (incl. `mappedFrom` resolving correctly on
the AC-scoped link).

## Results

| Check | Result |
|---|---|
| `server` — the 3 `traceability*.test.ts` files | 20/20 passed (was 17/17 before this run) |
| `server` full vitest suite | 352 files / 3939 passed / 5 skipped (3944 total; unchanged in substance from before this run — 3 new fixture tests replace the count shift from the D4-ratchet event fix below) |
| `client` full vitest suite (re-run for completeness; untouched by this diff) | 421 files / 3882 passed |
| `tsc --noEmit` (both packages) | clean |
| `oxlint .` (both packages) | no new warnings — all pre-existing, none in the two changed files |
| `diff_loc` (Step 3.4) | 203 — triggers `plan_review_required` on diff-size alone (complexity stayed `small`) |

## External-Plan-Review-Findings

One round (`--mode iterate`, `openrouter`/`codex`): both `approve`.

| # | Severity | Reviewer | Finding | Disposition |
|---|---|---|---|---|
| 1 | medium | openai | Verify the complete ingestion path (not just `traceability.ts`) has no strict validator that would reject `acs`/`ac_id` | accepted-and-fixed: verified `readTraceabilityIndex` has exactly one call site (`slice2-sources.ts`), taking the `TraceabilityIndex` return value directly with no intervening typed/zod validator; documented in the fixture file's header |
| 2 | low | openai | Add a mixed fixture (one AC-scoped requirement, one bare, same manifest) | accepted-and-fixed: added `MIXED_MANIFEST` + a third test |
| 3 | low | openai | Trim the frozen fixture to required fields only — full schema-literal copy is brittle | rejected-with-reason: deliberate design choice, independently affirmed by the other reviewer ("the latter specifically catches a future reader change that starts depending on a v4 field without an explicit version-gate") |
| 4 | low | openai | State explicitly the version bump is a compatibility check, not schema validation | accepted-and-fixed: added to the fixture file's header comment |
| 5 | medium | glm | Verify the v3→v4 delta mechanically (diff the schema files) rather than trust the schema's own doc comment | accepted-and-fixed: ran the `git diff` (see Precondition above); documented in the fixture file |
| 6 | low | glm | Add a negative case: `schema_version: 5` still trips `contract_version_ahead` | rejected-with-reason: already covered — `traceability.schema-version.test.ts`'s existing "WARNS (once) when schema_version is ahead" test uses `TRACEABILITY_SCHEMA_VERSION + 1`, now 5 with this change |
| 7 | low | glm | Pin the verified precondition commit hash somewhere auditable | accepted-and-fixed: `source_commit` in every v4 fixture is pinned to `c0d1b38be27730dca4c9f00afc4538dd10f76e56` |
| 8 | low | glm | Confirm `TRACEABILITY_SCHEMA_VERSION` isn't mirrored elsewhere (client, CLI) | accepted-and-fixed: grepped the whole repo — `contract-version.ts` is the sole definition, `traceability.ts` its only importer |
| 9 | low (positive) | glm | Affirms the scoping decisions (no manifest regen, no downstream `ac_id` surfacing, field-for-field fixture) | acknowledged — no action |

## External-Code-Review-Findings

One round (`--mode code`, diff against `HEAD~1..HEAD` — the committed diff,
not the working tree). Both `revise`.

| # | Severity | Reviewer | Finding | Disposition |
|---|---|---|---|---|
| 1 | medium | openai | No executable gate enforces the precondition (schema_version 4 verified) before merge; a stale/reverted producer contract could slip through | rejected-with-reason: the precondition IS enforced at the process level, not by in-repo code — this exact unit's PRIOR attempt (loop `sub_iterate-20260906-211316`) halted via the `diff_risk_recheck` exit-3 escalation contract when the precondition was unmet; a runtime code check in THIS repo would require the reader to introspect a DIFFERENT repository's git state, which is out of `traceability.ts`'s (and FR-01.66's) responsibility |
| 2 | medium | glm | Deletion of `.shipwright/agent_docs/iterates/iterate-2026-08-15-gitignore-decision-drops.json` is undeclared, contradicting this run's own `declared_removals: []` — reads as unrelated tampering | rejected-with-reason: this is F5c's OWN documented retention mechanism (`references/F5c.md`: "each append evicts the oldest entry file (a tracked `git rm` in the same commit)"), not a silent revert — `declared_removals` in the F5c entry-json is for FR-linked test-removal declarations, a different concern; the evicted run is not lost (survives in git history + `shipwright_events.jsonl` per that same doc) |
| 3 | medium | glm | No fixture sets `resolved_from`, despite `contract-version.ts`'s doc comment saying the reader reads `.resolved_from` and the fixture header's "field-for-field" claim — fold provenance (`mappedFrom`) is untested against the new v4 shape | accepted-and-fixed: added `resolved_from: "FR-01.99"` to `WITH_AC_TAG`'s test link (both its top-level `tests` entry and its `acs.AC07.tests` copy, matching the schema's own note that `ac_id` and `resolved_from` can co-occur); updated both assertions that reference this fixture to expect `mappedFrom: "FR-01.99"` instead of `null` |
| 4 | low | glm | `.shipwright/agent_docs/iterates/<run_id>.test-results.json` shows as "Binary files differ" in the diff, suggesting non-UTF-8/corrupt content | rejected-with-reason: verified via `git show HEAD:<path> \| file -` → "JSON text data" (valid, well-formed UTF-8); the repo's own `.gitattributes` marks this exact pattern `-text -diff` on purpose (F5c.md: prevents CRLF normalization from corrupting the immutable byte-for-byte evidence file), which is exactly what makes `git diff` render it as opaque/binary — that is the intended protection, not a defect |
| 5 | low | glm | mini-plan.md said "19/19" for the traceability suite while the ADR said "20/20" (stale, pre-`MIXED_MANIFEST`) | accepted-and-fixed: corrected mini-plan.md to 20/20 with the 17-pre-existing + 3-new breakdown |

**One additional, self-discovered fix folded in alongside the above** (not
from either reviewer, found while re-verifying the full suite after
applying finding #3): the F5b-recorded `work_completed` event's `tests`
block omitted `skipped`, tripping `event-test-counts-executed.test.ts`'s
D4-ratchet invariant (`passed + skipped == total`) — same class of gap as
w1's and w2's fixes earlier in this campaign. Corrected directly in
`shipwright_events.jsonl` (pre-push, matching the w2 precedent) from
`{"passed":7820,"total":7825,"e2e_run":false}` to
`{"passed":7820,"total":7825,"skipped":5,"e2e_run":false}`.

## Self-Review

1. **Spec Compliance** — PASS. All 3 ACs met: precondition verified before
   implementing (Context above), reader accepts v4 while still accepting
   v3-shaped bare FR tags (`BARE_FR_TAG` test), frozen fixture pins the
   shape (3 tests, incl. the mixed case).
2. **Error Handling** — PASS. No new error path; the existing fail-soft
   `checkContractVersion` behavior (missing/corrupt/too_large/denied) is
   untouched — only the "ahead" threshold moved.
3. **Security Basics** — PASS. No new input-parsing surface, no auth
   boundary; this is a read-only compatibility change to an
   already-fail-soft version check on a locally generated compliance
   artifact.
4. **Test Quality** — PASS. 20/20 in the targeted suite, 3939/3944 full
   server suite (unchanged), 3882/3882 client (unchanged, untouched by
   this diff). `tsc --noEmit` clean both packages.
5. **Performance Basics** — PASS. O(1) constant bump; no loop/algorithm
   change; no additional I/O.
6. **Naming & Structure** — PASS. New test file follows the existing
   `traceability.<topic>.test.ts` naming convention (sibling:
   `traceability.schema-version.test.ts`); 250 LOC, under the 300 rule.
7. **Affected Boundaries (ADR-024)** — PASS, with a disclosed limit.
   Producer = the monorepo's `test_links` collector /
   `traceability_schema.json`; consumer = `readTraceabilityIndex`. Real
   round-trip probe run: fixtures were built field-for-field from the
   ACTUAL shipped v4 schema (not invented), and the v3→v4 delta was
   verified via a real `git diff` against the producer's own history, then
   run through the real reader function. A live producer-generated fixture
   (running the monorepo's Python collector against a spec file that
   actually uses an AC-scoped `@covers` tag) was not obtained — this repo's
   own `spec.md` has zero AC-scoped tags yet, so there is no real input to
   generate one from. The frozen fixture is the strongest available
   substitute given that constraint, and is exactly what the "mechanical
   schema diff" step (finding #5 above) was for.

## Confidence Calibration

Not triggered: effective complexity is `small` (Step 2: `small`; Step 3.4
diff-driven re-check: `small`, unchanged — `risk_flags: ["touches_migrations"]`
is a keyword false-positive from the spec text's own use of the word
"schema", not a real migration touch), and `touches_io_boundary` is not
set. Self-Review above is the only review this class of change requires
beyond the mandatory plan/code review cascade (triggered here by
`diff_loc > 100`, not by complexity).

## Consequences

The WebUI's test-traceability reader now recognizes `schema_version` 4 as
within its known range, so a repo that adopts the monorepo's AC-scoped
`@covers` grammar will no longer see a spurious `contract_version_ahead`
warning in the WebUI's own logs. No behavior of FR-01.66's own feature
(which requirement links render for a changed test file) changes for any
existing v1–v3 manifest, and a v4 manifest with no AC tags reads
identically to a v3 one. Downstream consumption of `ac_id`/`acs` is
explicitly deferred, not silently dropped.

## Rejected alternatives

- Trimming the frozen fixture to only the fields the reader currently
  reads (openai's suggestion) — rejected: the whole point of a
  field-for-field fixture is to catch a FUTURE reader change that starts
  depending on an unguarded v4 field; a trimmed fixture cannot do that.
- Extending `TraceabilityFileEntry`/`TestFrRef` to surface `ac_id`
  downstream now, pre-emptively for w5 — rejected: out of scope for this
  unit's stated AC ("the reader accepts v4 and still accepts v3-shaped bare
  FR tags"), and w5's own predicate (spec-side `required_layers`
  promotion) has not been shown to need it; deferred to whichever unit
  actually needs it, with its own review.
