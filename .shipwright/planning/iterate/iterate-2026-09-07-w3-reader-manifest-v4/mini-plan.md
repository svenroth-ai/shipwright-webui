# Mini-plan — w3: Reader on manifest v4 (S9)

**Run ID:** `iterate-2026-09-07-w3-reader-manifest-v4`
**Campaign:** `req3-06-mechanics-webui` · sub-iterate `w3`
**Complexity:** small (Step 2: `small`; Step 3.4 diff-driven re-check: `small`,
unchanged — `plan_review_required: true` fires on `diff_loc: 203 > 100`, not on
complexity)
**change_type:** change · **spec_impact:** none (a fail-soft compatibility
constant + doc comment + a new test file; no product route, schema, or
write-surface changed) · **affected_frs:** FR-01.66 (test-traceability reader)

## Precondition (this unit's own gate, per its spec)

Before implementing anything, verified the monorepo's shipped manifest
contract is at `schema_version` 4:

- `git -C shipwright fetch origin` → `origin/main` tip is `c0d1b38be2` ("feat(compliance):
  AC-scoped `@covers` tag grammar + test-traceability manifest v4 (P3.2) (#686)").
- `git show origin/main:plugins/shipwright-compliance/scripts/lib/traceability_schema.json`
  pins `"schema_version": {"const": 4, ...}`, title "Test-Traceability Manifest v4".

Precondition met — proceeding to build, per the spec's own instruction ("if it
is not [met], HALT … do NOT implement a reader against a schema that does not
exist yet, and do NOT skip the unit silently" — the converse holds once met).

## Problem

The WebUI's `test-traceability.json` reader (`server/src/core/mission-context/traceability.ts`)
pins its "known max" schema version at `TRACEABILITY_SCHEMA_VERSION = 3`
(`server/src/core/contract-version.ts`). The monorepo's collector now writes
`schema_version: 4` for any repo whose spec uses the new AC-scoped `@covers`
grammar (`covers("FR-01.11/AC07")`). Left unbumped, every such manifest would
trip the fail-soft `contract_version_ahead` warning path — noisy, and wrong,
because v4 is not actually ahead of what this reader was written to handle;
it's a version the WebUI now specifically supports.

## What v4 actually changes (verified against the shipped schema, not assumed)

Read `plugins/shipwright-compliance/scripts/lib/traceability_schema.json` at
the monorepo's `origin/main` tip directly. v4 adds exactly two ADDITIVE,
OPTIONAL fields, per the schema's own description:

- `requirement.acs` — a per-AC breakdown (keyed `AC\d{2,}`) mirroring the
  requirement's own `tests`/`coverage` shape.
- `testLink.ac_id` — the AC id a test's `@covers` tag named, when it named one.

Both are **omitted entirely** when a requirement/test carries no AC tag —
"a repo with none of these tags yet emits a byte-identical v3-shaped body
(only the `schema_version` const moves)" (schema's own doc comment). Every
field this reader currently consumes (`requirements[*].id`, `.tests[<layer>][*].id`,
`.layer`, `.resolved_from`) is REQUIRED and UNCHANGED in v4.

## Approach — surgical, not speculative

1. **Bump `TRACEABILITY_SCHEMA_VERSION` 3 → 4** in `contract-version.ts`, with
   an updated doc comment describing what v4 adds and why this reader needs
   no logic change (it never reads `acs`/`ac_id` — those are new fields this
   reader doesn't consume, not fields it consumes differently).
2. **No change to `traceability.ts` itself.** It does not validate
   `additionalProperties`; it only reads the specific keys named above, which
   are unchanged across v3 → v4. Extending `TraceabilityFileEntry`/`TestFrRef`
   to surface `ac_id` downstream is explicitly OUT OF SCOPE for this unit —
   the AC only requires "the reader accepts v4 and still accepts v3-shaped
   bare FR tags," not that it surface AC-level data. w5 (bind-and-promote,
   which depends on w3) is a separate sub-iterate with its own review if it
   needs that.
3. **Frozen fixture** (`traceability.v4-fixture.test.ts`): two manifests, both
   `schema_version: 4`, copied field-for-field from the shipped schema's
   `$defs.requirement`/`$defs.testLink`/`$defs.acNode` shapes (not reduced to
   only what the reader reads) —
   - `WITH_AC_TAG`: a requirement carrying `acs` + a test link carrying `ac_id`.
   - `BARE_FR_TAG`: a requirement with neither — the "v3-shaped bare FR tag"
     case the AC names explicitly.
   Both assert: `status: "ok"`, no `contract_version_ahead` warning, and the
   correct `byFile` inversion (`frId`, `layers`, `caseCount`) — pinning that a
   future schema change starting to depend on one of these unread v4 fields
   would show up here as a new failure, not as silent drift.

## Non-goals / explicit exclusions

- No product route, spec.md, or write-surface touched.
- No consumption of `ac_id`/`acs` downstream (client types, mission-context
  artifacts) — out of scope per the AC text; left for whichever sub-iterate
  actually needs AC-scoped data (w5, if its own review decides so).
- The repo's own committed `.shipwright/compliance/test-traceability.json`
  is NOT regenerated (still `schema_version: 3`, produced by this repo's
  vendored compliance tooling, which has not itself been re-synced to the
  monorepo's P3.2 collector) — regenerating it is a separate concern
  (compliance-tooling sync), not this reader's contract.

## External-Plan-Review-Findings (Step 3.5, both reviewers: approve)

| # | Severity | Reviewer | Finding | Disposition |
|---|---|---|---|---|
| 1 | medium | openai | Verify the complete ingestion path (not just `traceability.ts`) has no strict validator that would reject `acs`/`ac_id` | accepted-and-fixed — verified `readTraceabilityIndex` has exactly one call site (`slice2-sources.ts`), which takes the `TraceabilityIndex` return value directly with no intervening typed/zod validator; documented in the fixture test's header comment |
| 2 | low | openai | Add a mixed fixture (one AC-scoped requirement, one bare, same manifest) | accepted-and-fixed — added `MIXED_MANIFEST` + a third test asserting no cross-requirement contamination |
| 3 | low | openai | Trim the frozen fixture to required fields only — full schema-literal copy is brittle | rejected-with-reason — deliberate design choice, affirmed independently by the other reviewer ("the latter specifically catches a future reader change that starts depending on a v4 field without an explicit version-gate"); trimming would defeat the fixture's stated purpose |
| 4 | low | openai | State explicitly that the version bump is a compatibility check, not schema validation | accepted-and-fixed — added to the fixture test's header comment |
| 5 | medium | glm | Verify the v3→v4 delta mechanically (diff the schema files) rather than trust the schema's own doc comment | accepted-and-fixed — ran `git diff 227a525e4..c0d1b38be2 -- .../traceability_schema.json` in the monorepo; confirmed the only changes are `$id`/title/description strings, `schema_version.const` 3→4, and the two additive blocks (`requirement.acs` + `acNode` def, `testLink.ac_id`) — no required field/enum/pattern changed. Documented in the fixture file. |
| 6 | low | glm | Add a negative case: `schema_version: 5` still trips `contract_version_ahead` | rejected-with-reason — already covered: `traceability.schema-version.test.ts`'s "WARNS (once) when schema_version is ahead" test uses `TRACEABILITY_SCHEMA_VERSION + 1`, which is now 5 with this change, and still asserts the warning fires |
| 7 | low | glm | Pin the verified precondition commit hash somewhere auditable | accepted-and-fixed — `source_commit` in every v4 fixture is pinned to `c0d1b38be27730dca4c9f00afc4538dd10f76e56` (PR #686), called out explicitly in the fixture file's header comment |
| 8 | low | glm | Confirm `TRACEABILITY_SCHEMA_VERSION` (or an equivalent "known max") isn't mirrored elsewhere (client, CLI) | accepted-and-fixed — grepped the whole repo; `contract-version.ts` is the sole definition, `traceability.ts` its only importer; documented in the fixture file |
| 9 | low (positive) | glm | Affirms the scoping decisions (no manifest regen, no downstream `ac_id` surfacing, field-for-field fixture) | acknowledged — no action; kept the framing in this plan and the commit message |

## Verification

- `server` vitest — the three `traceability*.test.ts` files: 20/20 passed
  (17 pre-existing + 3 new in `traceability.v4-fixture.test.ts`; external
  code review, low finding — this figure was stale at 19/19 before the
  `MIXED_MANIFEST` case was added).
- `server` full suite: 352 files / 3938 tests passed, 1 file / 5 tests skipped
  (unchanged from before this change — this is a fail-soft constant bump plus
  a new, additive test file).
- `tsc --noEmit` clean.
- `oxlint .` — no new warnings (all pre-existing, none in the two changed files).
