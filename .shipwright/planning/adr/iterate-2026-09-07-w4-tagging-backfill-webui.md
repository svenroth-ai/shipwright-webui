# Tagging backfill: 15.75% -> 31.97% traceability coverage, 32/32 FRs bound

**Run:** `iterate-2026-09-07-w4-tagging-backfill-webui` (sub-iterate `w4`,
campaign `req3-06-mechanics-webui`)

## Context

Sub-iterate w4 ("Tagging backfill") tags **existing** WebUI tests that already
prove an FR acceptance criterion but carry no `@covers` binding — writing a
*missing* test is explicitly out of scope (REQ3.07 / `trg-58a3e32d`). The base
manifest (`.shipwright/compliance/test-traceability.json`, freshly regenerated
on `main` by PR #436) reported 1161/7372 tests bound (15.75%), 25/32 FRs with
>=1 bound test, 100% of bindings via `tag_source: covers_comment` (this repo
has never used `native_tag`/`title_suffix`/`pytest_marker`).

## Decision

Two passes, both comment-only (`// @covers FR-XX.YY`), zero test bodies
touched:

**Pass 1 (automated candidate generation + fold-aware filtering).** The
`@covers` grammar only binds a comment on the line immediately preceding (or
trailing) an `it(`/`test(`/`describe(` declaration. Many files already NAME
their own FR in a header docstring or `describe` title several lines above
their first test — too far to bind, silently dropped as informational. A
scratch script (never committed) found every fully-untagged file naming
**exactly one** FR-01.NN anywhere in its own text, after: (a) resolving every
mention through `spec.md`'s `## FR-Fold-Map` to its survivor ID (this repo's
documented convention — spec.md itself: "existing source-comment references to
folded IDs are left in place on purpose... only test `@fr` tags were
remapped"); (b) excluding lines matching a cross-reference phrase set (`lives
in`, `split out`, `moved to`, `live[s] here now`, ...); (c) per-`describe`-
block scoping (brace-depth stack mirroring `_suite_tags.py`) so a header-level
FR never blankets a *different* concern's block. Result: **1093** unique tests
newly bound across 165 files (343 insertion points), spanning 21 FRs.

**Pass 2 (manual, individually read against the spec text).** For FRs Pass 1
could not close (the FR never named in any file's own text), the file's
existing tests were read against the FR's spec paragraph directly:
`FR-01.05` (diagnostics.{cli-context,plugin-version}.test.ts), `FR-01.16`
(project-actions-loader.test.ts), `FR-01.17` (preview-session-manager*.test.ts
+ preview routes.test.ts — the spec's own AC rows literally name these test
titles), `FR-01.31` (resolveHonoHost*/resolveNetworkProfile/network-profile-
sync.test.ts), `FR-01.70` (org `__tests__/routes.test.ts`, the host+secret
gate), plus strengthening `FR-01.71` (org.test.ts, the browser proxy). Result:
**103** more unique tests bound across 13 files.

**One pre-existing miscitation corrected.** `campaigns.events.test.ts`'s
header comment cited `(FR-01.31)` (Network access profile) for a `GET
/api/campaigns/:projectId` test — a one-digit typo for `FR-01.33` (Campaigns
lane), confirmed by both FRs' spec text and the file's own 3 test titles
("overlays an event-confirmed completion...", "synthesizes a
derivedFromEvents campaign...", "a missing event log leaves dir-sourced
campaigns unchanged" — all Campaigns-lane projection behavior, none about
network binding). Corrected docstring + `@covers` tag to `FR-01.33`; this is
the diff's only non-annotation line change.

## Results (scratch regen, same pinned collector CI uses — `plugins/
shipwright-compliance` at `7e106939fbf82331f5e54a4ea27d90b4f279f1ce`, not
committed here — see "Manifest not committed" below)

| Metric | Before | After |
|---|---|---|
| Bound-test traceability coverage (bound / total enumerated) | 1161/7372 = 15.75% | 2357/7372 = 31.97% |
| FRs with >=1 bound test | 25/32 | **32/32** |
| Newly bound unique tests | — | **1196** (1093 automated + 103 manual) |
| `tag_source` breakdown, both before and after | 100% `covers_comment` | 100% `covers_comment` |
| `orphans` (all pre-existing `FR-04.22`, unrelated area) | 12 | 12 (unchanged) |
| `invalid_tags` | 0 | 0 (unchanged) |

"Coverage" above is **bound-test traceability coverage** (the manifest's own
metric), not behavioral/product-test coverage — the full `server`+`client`
vitest suites are unchanged pass/skip counts (3936 passed/5 skipped;
3882 passed), because this diff adds zero test logic.

## Manifest not committed (deliberate)

`.shipwright/compliance/test-traceability.json` is **NOT** regenerated or
committed by this run. Per `derived_snapshots.py` (`TEST_TRACEABILITY`) and
`ci.yml`'s own `Traceability manifest (gate)` job docstring, this repo's
iterate PRs never carry a regenerated manifest — collision avoidance across
parallel campaign units (w1/w2/w3/w5 all touch overlapping surfaces in this
same campaign). The push-only CI gate regenerates + diffs it after merge to
`main`. The numbers above come from an in-memory, uncommitted regen using the
exact plugin path + pinned commit CI's `Checkout shipwright-compliance
plugin (pinned)` step uses.

## External-Plan-Review-Findings

One round (`--mode iterate`, both `openrouter`/`codex`): both `revise`. Both
reviewers converged on the same core concern — Pass 1's file/describe-name-
level matching is a weaker signal than test-content verification, and the
plan text (submitted before this ADR existed) did not yet state exact
derived-vs-manual test counts.

| # | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | openai | high | Outermost-describe propagation can over-tag a mixed suite; file/title audit doesn't catch it at test level | accepted-and-fixed: did a targeted content-level read (not just titles) across a diverse sample spanning every risk tier — self-declared-header files (`merge-check.test.ts`'s own `@covers FR-01.66` 4 lines above its first describe), describe-title-citation files (`useKeyboardMap.test.tsx`, `ActionsConfigCard.test.tsx`, `contract.test.ts` — all cite their FR verbatim in the header, just unbound), and the highest-risk multi-describe header-fallback files (`routes.backlog.test.ts`'s second describe, read in full — genuinely tests the FR-01.01 backlog-stickiness AC). Zero content mismatches found in the sample; the one real defect (`campaigns.events.test.ts`) was already caught by a separate file-name-vs-FR-title audit before this review ran. Full per-test content verification of all 1196 tests was not performed (disclosed, not claimed) |
| 2 | openai | medium | Plan didn't state derived-vs-hand-mapped TEST counts (only FR counts) | accepted-and-fixed: exact counts now in Results above (1093 automated / 103 manual / 1196 total) |
| 3 | openai | medium | "Exactly one FR in file" is a weak proxy (aliasing, parameterized tests, prose) | accepted-and-fixed: disclosed as candidate-generation, not authority (this ADR); the `it.each`-with-multi-line-title gap this same review indirectly surfaces is recorded below |
| 4 | openai | medium | Security-sensitive FR-01.31/org tags need exact AC+test title, both positive and rejection paths represented | accepted-and-fixed: verified — `resolveNetworkProfile.test.ts` has "invalid profile value -> throws"; `resolveHonoHost.test.ts` has "invalid SHIPWRIGHT_NETWORK_PROFILE throws"; org `routes.test.ts` has 403/503/401 `it.each` rejection blocks (see "collector limitation" below for why they don't appear in the manifest's own test count) |
| 5 | glm | medium | File-name-level validation != test-content validation; state content-verified vs name-verified counts | accepted-and-fixed: see #1's sample; roughly 20 files/280 tests were read at full test-body level across this run (the sample cited in #1 plus every Pass-2 manual file), the remaining ~1170 tests rest on the self-declared-header/describe-title signal, which is the AUTHOR's own claim, not an inference |
| 6 | glm | medium | Propagation could bind a nested describe with no mention of its own via an outer header tag | accepted-and-fixed (not via the suggested blanket restriction): the suggested fix (cap header-fallback to single-top-level-describe files only) was evaluated and rejected — it would have discarded ~700 legitimate Mission-context tests verified single-concern by content read (see #1); the actual risk was addressed by content sampling instead |
| 7 | openai | low | "Coverage" could be misread as behavioral coverage | accepted-and-fixed: worded as "bound-test traceability coverage" throughout this ADR |
| 8 | glm | low | `campaigns.events.test.ts` correction needs to be auditable, not just asserted | accepted-and-fixed: actual test titles + both FRs' spec text now cited above |
| 9 | glm | low | Confirm scratch regen used the SAME pinned collector commit as CI | accepted-and-fixed: `7e106939fbf82331f5e54a4ea27d90b4f279f1ce` cited above, matches `ci.yml`'s pin |
| 10 | glm | low | Distinguish "FR has >=1 bound test" from "fully AC-covered" | accepted-and-fixed: Results table says "FRs with >=1 bound test", never "fully covered" |

## External-Code-Review-Findings

One round (`--mode code`, diff against the working tree). Both `revise`.
**Nearly every "bug" finding from both reviewers is a false positive rooted in
one gap: neither reviewer was given `spec.md`'s `## FR-Fold-Map`**, so every
correctly-resolved folded-ID-to-survivor tag (this repo's own documented
convention) read to them as a wrong FR. Verified against the fold-map table
one by one below; genuine findings are marked accordingly.

| # | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | openai+glm | high | Missing coverage-report artifact (before/after, derived/hand-mapped) in the diff | accepted-and-fixed: this ADR (written after the review ran, per the runner's own Step order — 3.5/3.7 review before F3) now carries it in full |
| 2 | openai+glm | medium | `95-terminal-appearance.spec.ts` etc. cite FR-01.44, tagged FR-01.28 | rejected-with-reason: `spec.md`'s `## FR-Fold-Map`: `FR-01.44 -> FR-01.28` (delta, "Embedded terminal appearance"). Survivor-only tagging is documented repo convention; reviewer had no fold-map context |
| 3 | openai+glm | medium | `markdown-editor.spec.ts` / `file-write-route.test.ts` cite FR-01.34, tagged FR-01.33 | rejected-with-reason: fold-map `FR-01.34 -> FR-01.33` (delta, "Campaign autonomous launch") |
| 4 | openai+glm | medium | `move-to-backlog.spec.ts`/`TaskCard.test.tsx`/`routes.backlog.test.ts` cite FR-01.32, tagged FR-01.01 | rejected-with-reason: fold-map `FR-01.32 -> FR-01.01` (endpoint, "Move task to backlog") |
| 5 | openai | medium | `compliance-reader.test.ts` cites FR-01.60, tagged FR-01.59 | rejected-with-reason: fold-map `FR-01.60 -> FR-01.59` (delta, "Ship's-Log project home") |
| 6 | glm | medium | `project-actions-loader.test.ts`: new outer `@covers FR-01.16` sits above `it()`s that ALREADY carry their own `@covers FR-01.37`, dual-binding the same tests | accepted-and-fixed (partial, see "project-actions-loader dual-binding" below): the new FR-01.16 tag is kept (genuinely correct, closes a hard zero-coverage FR); the pre-existing FR-01.37 tag is untouched (pre-existing, out of this run's scope) |
| 7 | glm | low | Org FR-01.70 vs FR-01.71 "inconsistency" | rejected-with-reason: two genuinely distinct FRs by spec design — FR-01.70 is the leadwright-internal host+secret-gated `/api/external/org/*` API, FR-01.71 is the operator-facing, browser-reachable `/api/org/*` proxy; independently read both route files, confirmed distinct handlers |
| 8 | glm | low | Inbox FR-01.50 vs FR-01.63/FR-01.04 "inconsistency" | rejected-with-reason: not an inconsistency — `FR-01.50` was never folded (used verbatim); `FR-01.63 -> FR-01.04` is a correct, separate fold-map resolution for a different file |
| 9 | glm | low | Mission tests citing FR-01.67 tagged FR-01.66 | rejected-with-reason: fold-map `FR-01.67 -> FR-01.66` (delta, "Mission lifecycle") |
| 10 | glm | low | `campaigns.events.test.ts` typo-correction needs verification | accepted-and-fixed: same as plan-review #8 — verified and cited |

## `project-actions-loader.test.ts` dual-binding (discovered mid-review)

Pass 2 skipped the "is this file already tagged somewhere" check Pass 1's
script performed automatically (`tagged_files` exclusion) — a genuine gap in
the MANUAL half of this run's methodology. Investigation: every `it()` in
this file already carried `// @covers FR-01.37` (pre-existing, from
`iterate-2026-06-11-custom-action-slash-command`), bound successfully before
this run — this file was never in `untagged_tests` at all. Reading the actual
test titles ("bundled default fallback", "user file path", "malformed file
handling", "mtime cache", "loadBundledDefault (pure)") against FR-01.37's
text ("a custom action can name a slash command... reports a clear error up
front") shows none of them test slash-command validation specifically — the
pre-existing FR-01.37 tag looks broad/imprecise, but auditing or correcting
a PRE-EXISTING tag is outside this run's mandate (backfill UNTAGGED tests,
not re-litigate existing ones). The new FR-01.16 tag is additive, not
destructive (nothing removed, no test weakened), and the loader's actual
behavior (bundled-default fallback + user-override precedence + malformed-
file handling) is a verbatim match for FR-01.16's own AC text. Left as
intentional dual-binding; the FR-01.37 precision question is recorded here
for a future pass, not silently dropped.

## Collector limitation discovered (not this run's to fix)

`server/src/external/org/__tests__/routes.test.ts` has real, thorough
rejection-path tests (403 `host_not_allowed`, 503 `leads_route_not_configured`,
401 `invalid_secret` x2, each parameterized over 8 endpoints via
`it.each(ALL_ENDPOINTS)(...)`) — but the title lives on the line AFTER
`it.each(ALL_ENDPOINTS)(`, not on the same line. Both the tag grammar's
`_TEST_DECL_RE` and the collector's `enumerate_tests` (same regex, by
design) require the title on the `it(`/`test(` line itself, so these tests
are **structurally invisible** to the manifest — neither tagged nor counted
in `untagged_tests`. This is a pre-existing collector limitation (shared
`shipwright-compliance` plugin, a different repo), not something this run
introduces or can fix; real security-rejection coverage for FR-01.70 exists
in the codebase, just under-counted by the tool. Worth flagging upstream in
a future pass.

## Self-Review

1. **Spec Compliance** — PASS. All 3 sub-iterate ACs met: coverage
   reported before/after (Results table), derived-vs-hand-mapped counts
   stated separately (1093/103/1196, plus the manifest's own `tag_source`
   axis at 100% `covers_comment` both before and after), no test deleted
   or weakened. **Correction (Stage-1 spec review, 2026-09-07):** the
   diff is NOT "+371/-1" — git counts each of the 13 same-line
   trailing-comment appends on an `it()`/`test()`/`describe()` line as a
   line replacement (-1/+1), plus the one-digit docstring typo, plus
   campaign metadata files, for roughly +1122/-35 total. The AC-3 claim
   itself holds (independently re-verified by the reviewer): all 13
   trailing-comment declaration lines are byte-identical to base apart
   from the appended comment, and zero test bodies, titles, or
   assertions were removed anywhere in the diff — the prior stat just
   understated the deletion count in a way a `git diff --stat` reader
   would reasonably read as contradicting that claim.
2. **Error Handling** — N/A/PASS. Comment-only diff; zero runtime paths
   touched.
3. **Security Basics** — PASS. No secrets, no auth surface changed.
   FR-01.31/FR-01.70 (security-sensitive) tags verified against real
   rejection-path tests (see "Collector limitation" above for why some
   don't register in the manifest's own count).
4. **Test Quality** — PASS. Full `server` (3936 passed/5 skipped, 352
   files) and `client` (3882 passed, 421 files) vitest suites green,
   identical counts to before this run. `tsc --noEmit` clean on both
   packages.
5. **Performance Basics** — N/A/PASS. Comment-only; zero runtime impact.
6. **Naming & Structure** — PASS. `// @covers FR-XX.YY` matches this
   repo's pre-existing, exclusively-used convention; no new tag_source
   style introduced. CRLF line endings preserved (script auto-detected
   per-file EOL, verified: no LF/CRLF mixing introduced).
7. **Affected Boundaries (ADR-024)** — PASS. Producer = test source files
   carrying `@covers` comments; consumer = the `test_links` collector
   (`build_manifest`). Real round-trip probe run (not merely asserted):
   the actual pinned collector was imported and run in-memory against
   every changed file, producing zero `invalid_tags` and the SAME 12
   pre-existing orphans (no new ones) — this IS the round-trip probe for
   this boundary.

## Confidence Calibration

Not triggered: effective complexity is `small` (Step 2: `small`; Step 3.4
diff-driven re-check: `small`, unchanged, `risk_flags: []` — comment-only
diff across test files matches none of the diff-driven detectors), and
`touches_io_boundary` is not set. Self-Review above is the only review this
class of change requires per the sub-iterate runner's own contract.

## Consequences

WebUI bound-test traceability coverage rises from 15.75% to 31.97%; every
FR-01.NN capability now has at least one bound test (was 25/32). No product
source, spec text (beyond one docstring typo), or CI workflow touched. One
pre-existing tag-precision question (`project-actions-loader.test.ts`'s
FR-01.37 tags) and one collector limitation (`it.each` multi-line titles
invisible to the manifest) are disclosed as unowned follow-ons, not silently
dropped.

## Rejected alternatives

- Capping automated header-fallback to single-top-level-describe files only
  (glm's suggestion) — rejected: would have discarded ~700 legitimate,
  content-verified Mission-context tests; the actual over-tagging risk was
  addressed by targeted content sampling instead of a blanket structural cut.
- Auditing/correcting the pre-existing `FR-01.37` tags on
  `project-actions-loader.test.ts` in this same run — rejected: out of this
  unit's mandate (backfill untagged tests, not re-litigate existing bindings);
  disclosed instead as a follow-on.
- Fixing the `it.each` multi-line-title gap in the shared collector —
  rejected: that code lives in a different repo (`shipwright-compliance`
  plugin) this sub-iterate does not own; disclosed as a follow-on.
