# Mini-plan — w4: Tagging backfill (WebUI)

**Run ID:** `iterate-2026-09-07-w4-tagging-backfill-webui`
**Campaign:** `req3-06-mechanics-webui` · sub-iterate `w4`
**Complexity:** small (Step 2: `small`; Step 3.4 diff-driven re-check: `small`, unchanged)
**change_type:** change · **spec_impact:** none (test-file annotations only; no
product source, no `spec.md` FR text touched except one pre-existing docstring
typo correction, see below) · **affected_frs:** every FR-01.NN in the adopted
spec that already had a matching, unbound test (21 FRs via the automated pass,
plus 5 more via a targeted manual pass — see Approach).

## Problem

The WebUI's `.shipwright/compliance/test-traceability.json` manifest (regenerated
fresh on `main` at the base commit, PR #436) reports:

- **1161** tests carrying a bound `@covers` tag, all via `tag_source: covers_comment`.
- **6211** tests enumerated but untagged.
- Coverage = 1161 / 7372 = **15.75%**.
- **25 / 32** FRs have at least one bound test; 7 have **zero** (`FR-01.05`,
  `FR-01.16`, `FR-01.17`, `FR-01.31`, `FR-01.49`, `FR-01.70`, `FR-01.71`).

Scope (per the sub-iterate spec): tag **existing** tests that already prove an
FR's acceptance criterion but carry no binding. Writing a *new* test is
out of scope (REQ3.07 / `trg-58a3e32d`). No test may be deleted or weakened to
raise the number.

## Approach

**Pass 1 — automated, self-declared-but-unbound tags.** The `@covers` grammar
only binds a `// @covers FR-XX.YY` comment on the line *immediately preceding*
(or trailing) an `it(`/`test(`/`describe(` declaration (`fr_tag_grammar.py`).
Many WebUI test files already **name their own FR** in a file-header docstring
or a `describe()` title (e.g. `scenario.test.ts`'s header literally reads
`@covers FR-01.66` four lines above its first `describe(`) — too far away to
bind, so the collector silently drops it as informational.

A scripted sweep (Python, scratch-only, never committed) found every FULLY
UNTAGGED test file that names **exactly one** FR-01.NN anywhere in its own
text, after:

1. **Resolving every mention through the spec's `## FR-Fold-Map`** to its
   survivor ID first (the collector's `foldwire.resolve_binding` accepts
   survivor tags at face value; a folded ID could file into `fr_absent` if the
   fold walk ever changes upstream — survivor-only is the documented webui
   convention regardless).
2. **Excluding** lines matching a cross-reference phrase set (`lives in`,
   `split out`, `moved to`, `see also`, `live[s] here now`, …) — a file that
   merely *points at* another file's FR, or says only *part* of itself hosts
   that FR, must not blanket-tag its whole test list. (Caught two real
   near-misses this way: `triage-enrich.test.ts`'s docstring said the
   FR-01.33 tests "live here now" for one of its two `describe` blocks only —
   excluded, left untagged, rather than mis-tagging its unrelated
   `enrichPendingDelivery` block.)
3. Per-`describe`-block scoping (brace-depth stack, mirroring
   `_suite_tags.py`) so a describe with its **own** FR mention wins over a
   file-header fallback, and a file whose header FR would blanket a
   *different* concern's tests is left untagged for that concern (this is
   exactly how `compliance-reader.test.ts`'s unrelated `parseDashboard —
   structured fields (AC-A)` block stayed untagged while its
   `dimensions (A16, FR-01.60)` block got tagged FR-01.59).
4. A dedicated post-hoc audit (grouping every inserted tag by FR + eyeballing
   file names against the FR's own spec title) — caught one further
   **pre-existing miscitation**: `campaigns.events.test.ts`'s header comment
   said `(FR-01.31)` (Network access profile) for a `GET
   /api/campaigns/:projectId` test — a one-digit typo for `FR-01.33`
   (Campaigns lane), unrelated to the file's actual subject. Corrected the
   docstring + used the correct survivor for the `@covers` tag; this is the
   only non-test-file-annotation edit in the diff.

Insertion is comment-only, one `// @covers FR-XX.YY` line per resolved
describe/decl target (deduped to the outermost qualifying block so
propagation covers everything nested under it) — **zero lines removed except
the one corrected digit above**, satisfying the "never weaken a test" AC by
construction.

**Pass 2 — manual, verified against the spec text.** For the FRs Pass 1 could
not close (no file names the FR anywhere in its own text), the file's already
existing tests were read against the FR's spec paragraph directly and tagged
by hand:

- `FR-01.05` (Diagnostics page) → `diagnostics.cli-context.test.ts`,
  `diagnostics.plugin-version.test.ts` (the latter's own `describe` matches
  spec AC (F) *verbatim* — "a Versions section shows the WebUI's own version
  and the current Shipwright plugin … version, falling back to
  '(not detected)'").
- `FR-01.16` (Action catalog) → `project-actions-loader.test.ts` (spec AC (E)
  names `loadActionsForProject` and "merges … over the bundled defaults" —
  this file's four describes are exactly that contract).
- `FR-01.17` (Preview spawn) → `preview-session-manager{,.validation,.win32}.test.ts`
  + `external/preview/__tests__/routes.test.ts` — the spec's own AC (T) rows
  **name** `core/preview-session-manager.test.ts` test titles verbatim.
- `FR-01.31` (Network access profile) → `resolveHonoHost{,.precedence}.test.ts`,
  `resolveNetworkProfile.test.ts`, `network-profile-sync.test.ts` — direct
  `HONO_HOST`/`VITE_HOST`/`SHIPWRIGHT_NETWORK_PROFILE` matches to the three ACs.
- `FR-01.70` (Leads org route) → `external/org/__tests__/routes.test.ts`
  (`createOrgRouter — host + secret gates`, the exact host+secret-gated
  `/api/external/org/*` surface the FR describes).
- `FR-01.71` strengthened (already closed by Pass 1) with
  `routes/__tests__/org.test.ts` (`createOrgApiRouter — /api/org/* plain-surface
  proxy`, the FR's explicit "browser-facing `/api/org/*` proxy" AC).

## Non-goals / explicit exclusions

- No new test is written (out of scope by the spec).
- `EmbeddedTerminal.test.tsx` and several other files that mention an FR only
  in a scattered inline comment (not a header or describe title) were left
  untagged — the signal was too weak / potentially file-wide-inaccurate to
  trust automatically; a future pass can read them by hand.
- The committed `.shipwright/compliance/test-traceability.json` is **NOT**
  regenerated or committed by this run — per `derived_snapshots.py`
  (`TEST_TRACEABILITY`) and the CI job's own docstring in `ci.yml`, iterate PRs
  never carry a regenerated manifest (collision avoidance across parallel
  campaign units); the push-only CI gate regenerates + diffs it after merge.
  The before/after numbers in this plan and the ADR were measured with a
  scratch, uncommitted regen of the SAME pinned collector CI uses.
- `.github/workflows/**` untouched.

## Verification

- `server` vitest: 3936 passed / 5 skipped (352 files, 1 skipped) — unchanged
  pass/skip counts from before this run (comment-only diff).
- `client` vitest: 3882 passed (421 files) — unchanged.
- `tsc --noEmit` clean on both packages.
- Scratch regen of the collector shows: coverage 15.75% → **31.97%**, FRs with
  ≥1 test 25/32 → **32/32**, `orphans` unchanged at 12 (pre-existing, unrelated
  `FR-04.22` entries — a different area's numbering, not touched here),
  `invalid_tags` stayed 0, and `tag_source` stayed 100% `covers_comment` both
  before and after (this repo has no `native_tag`/`title_suffix`/`pytest_marker`
  usage yet — nothing in this pass introduces one either).
