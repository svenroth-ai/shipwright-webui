# webUI traceability retrofit — coverage delta (durable record)

> Handoff from the monorepo campaign `2026-07-15-test-traceability-layers` (anchor
> `trg-17aaaccd`; runbook `webui-retrofit-brief.md`). This is webui's analog of the monorepo's
> `TT8-coverage-delta.md`. Run: `iterate-2026-07-17-test-traceability-retrofit`.
> **Scope: data/tags + docs only — product source (server/src, client/src app code) is
> byte-stable; only test files received additive `// @covers FR-XX.YY` tags.**

## Headline

| Metric | Value |
|---|---|
| Test cases scanned (`server/src` + `client/src` + `client/e2e`) | 4815 |
| **Test cases tagged → FR (manifest bindings)** | **1038** (≈ 21.6 %) |
| Test **files** tagged | 116 |
| **FRs with ≥1 tagged test** | **24 / 29** survivor capabilities (post-#287 remap — see *Reconciliation*) |
| Bindings by layer | unit 1030 · e2e 8 · integration 0 |
| Real orphans (tag → removed/absent FR) | **0** |
| Untagged residue | see *Residue* (derived pre-#287) |

The tags were produced by **three deterministic, zero-human-review signals** (no LLM guessing,
no "review-later" backlog). Every tag is correct by construction — see *Signals*.

## Reconciliation with #287 (FR taxonomy regroup)

**This retrofit was built against the pre-#287 spec (66 granular FRs, with a per-FR source-file
column). While it was in flight, the planned iterate `iterate-2026-07-17-fr-taxonomy-regroup`
merged to `main` (#287)**, folding those 66 FRs into **29 capability rows** and moving the 37
folded IDs into a `## FR-Fold-Map` alias table (and dropping the per-FR file-list column the
co-location signal had used).

Empirically confirmed after merging #287: **22 of the 40 tagged FRs are folded**, and the
`test_links` collector is **not fold-aware**, so those tags produced **419 `fr_absent` orphans**
and `D-orphan` FAILED. Resolution (this run): every `@covers FR-<folded>` was rewritten to its
survivor via the spec's own fold-map — **419 remaps across 57 files**, deterministic, e.g.
`FR-01.44`(terminal-appearance)`→FR-01.28`(Embedded terminal), the five Mission FRs
`FR-01.54/55/56/57/67 → FR-01.66`. After the remap + manifest regen: **orphans = 0**, `D-orphan`
PASS, **1038 bindings preserved**, **24 / 29 survivor capabilities covered**. The granularity that
collapsed is exactly the granularity #287 deliberately folded — the tags now speak the current
taxonomy. Product source stayed byte-stable throughout.

**The detailed derivation below (signal counts, per-FR spot-checks, residue) is recorded as
originally computed against the pre-#287 spec** (the co-location prototype cannot re-run against
the current spec — it has no per-FR file lists); the reconciled totals above are authoritative.

## Provenance (reproducible)

- Shared engine: `backfill_test_links/1.0.0`; collector: `test_links/1.0.0` (schema v2);
  detector: `_group_d_traceability` (D-orphan / D-layer).
- Enabling config (**the key change**): `shipwright_compliance_config.json` →
  `traceability.test_roots = ["server/src","client/src","client/e2e"]` +
  `exclude_dirs = ["fixtures","__fixtures__"]`.
- Engine tags (signal `unique_commit`):
  `backfill_test_links.py --project-root . --test-root server/src --test-root client/src --test-root client/e2e`
  (split-convention **OFF** — see below).
- Co-location + self-listing tags (signal-e prototype, this repo):
  `.shipwright/compliance/tools/signal_e_colocation.py --project-root . --test-root …`
- Manifest regen:
  `update_compliance.py --project-root . --phase iterate` (needs `uv run --with jsonschema`).
- Manifest: `.shipwright/compliance/test-traceability.json`; RTM: `traceability-matrix.md`.

## Two collector-scope traps solved (framework findings)

The monorepo dogfood (TT8) warned about the collector scope twice; webui hit **both**, harder,
because its *entire* test corpus lives under non-conventional roots.

1. **Manifest blindness.** The `test_links` collector (and the backfill engine) default to
   conventional root dirs (`tests/`, `src/`, `e2e/`, …). webui is a monorepo with `server/` +
   `client/` workspaces and **no such dir at its root**, so the default scan bound **zero**
   webui tests — a written tag would be invisible to the manifest. **Fix:** the collector's
   per-repo opt-in `traceability.test_roots` (shipped by TT8's own follow-on) now points the
   scan at webui's real roots. This is the enabling change; without it the whole retrofit
   no-ops.

2. **`.worktrees/` prune.** The shared iterate skill mandates worktree isolation under
   `<repo>/.worktrees/<slug>/`. But the backfill engine's file walk prunes **any path
   containing `.worktrees`** (`backfill_scan._PRUNE_DIRS`, matched against full `path.parts`),
   so run from the mandated worktree it found **0 tests**. The monorepo dodged this only
   because TT8 ran from the repo root, not a worktree. **Fix (this run):** the iterate worktree
   was relocated out of `.worktrees/` (`git worktree move …/.worktrees/test-traceability-retrofit
   C:/01_Development/wt-traceability-retrofit`); the pointer in `.shipwright/iterate_active/`
   records the relocation. **Follow-on:** the shared engine should prune `.worktrees` by
   *descent* (like the collector's `os.walk`), not by ancestor `path.parts`, so the retrofit is
   runnable in-place. Filed as a monorepo handoff.

## Signals (all deterministic; zero human review)

| Signal | What it proves | Files | Cases |
|---|---|---:|---:|
| `unique_commit` (shared engine) | test's *introducing commit* names exactly one FR | 6 | 47 |
| **co-location** (signal-e) | test **imports** a source file the spec lists under exactly one FR | 105 | 972 |
| **self-listing** (signal-e) | the spec explicitly names **this test file** under exactly one FR | 5 | 20 |
| — total written | | 116 | 1039 |
| — manifest bindings | (−1 collector def-vs-node enumeration delta) | | **1038** |

**signal-e** is the "different way" the shipped engine lacks. Every co-location tag passed three
hard gates — the co-located source (a) is the *exclusive* owner of one FR in the spec, (b) exists
on disk, and (c) is *imported* by the test — so the tag records a truth (the test exercises that
FR's code), not a guess. Validated: 972/972 import-checked. Prototype:
`.shipwright/compliance/tools/signal_e_colocation.py`. **This belongs in the shared engine** so
every repo (adopt / retrofit) benefits and it is canonically tested — filed as a monorepo handoff.

**Split-convention left OFF.** webui's E2E specs use the `NN-` Playwright *execution-order*
prefix (`01-board-navigation.spec.ts`), **not** a Shipwright split id. With
`--repo-follows-split-convention` off, those specs correctly stayed advisory (they surfaced as
5 low-confidence fan-out proposals, not auto-writes). Turning it on would mis-attribute them.

## Residue — the honest accounting (NOT a review backlog)

506 files / 3776 cases remain untagged. **This is not rot, and it is deliberately *not* filed as
3776 triage cards** (no human will action that — a decision-drop). It breaks down as:

| Bucket | Files | Cases | Why unmappable *deterministically* |
|---|---:|---:|---|
| **Ambiguous** (co-located dir shared by >1 FR) | 483 | 3653 | Several FRs legitimately layer on the same code (e.g. **124 files** in mission/motion dirs claimed by `FR-01.64`+`FR-01.66`+`FR-01.67`, which share `useMissionLive.ts`, `narrator-transcript.ts`, motion CSS). No structural signal can *uniquely* attribute these. |
| **No structural signal** | 23 | 123 | E2E flows and cross-cutting tests the spec names under no single FR (feature-level, not file-level). |

**Root cause of the low base rate:** webui was *adopted*, so most tests predate per-commit
FR-gating; the engine's only auto-write signal (`unique_commit`) fires solely on single-FR
introducing commits (47 here). The shipped engine has **no zero-review path** past that — its
`--use-llm` leg only produces proposals that still need confirmation. signal-e closed most of
that gap deterministically; the ambiguous remainder is a **spec-granularity limitation** (the FR
model is coarser than the test suite), not test rot. Raising it further needs either finer FR→file
attribution in the spec, or an accepted "shared-infra test maps to multiple FRs" convention —
both design decisions, filed as a follow-on, *not* silently punted.

**Skip inventory (rolled up):** 19 `*.skip` occurrences across 15 files — almost all *conditional*
env-guards (`SYMLINKS_AVAILABLE`, "requires a registered project", "baseURL unreachable"), i.e.
legitimate runtime gates, not disabled coverage. One summary line, not 19 cards.

## Two-stage validation (Spec §11 R5) — do not overclaim

- **Stage 1 (candidates).** The backfill maps confidently-tagged tests and reports orphan
  *candidates*. webui had **0 real orphans**: no pre-existing `@FR` tags, so nothing pointed at a
  dead FR. Untagged staleness is a *review candidate*, never a hard failure — tagging is the
  precondition for strict detection.
- **Stage 2 (strict D-orphan) — live proof on webui.** To prove the detector *bites here* (not
  just on the monorepo), a throwaway test tagged `// @covers FR-01.99` (an absent FR) was added,
  the manifest regenerated, and `D-orphan` run:

  ```
  D-orphan: status=fail  severity=MEDIUM
    detail: test-tag defects — 1 confirmed (tag → removed/absent FR);
            e.g. client/src/__orphan_proof__.test.ts::… → FR-01.99
      - …__orphan_proof__.test.ts::… → FR-01.99 (fr_absent) [confirmed]
    suggested: /shipwright-iterate --type change "retarget or retire the orphaned test(s) for FR-01.99 …"
  ```

  The throwaway file was then deleted and the manifest regenerated — `D-orphan: status=pass`
  ("no test is tagged with a removed/absent FR"), orphans = 0, bindings stable at 1038. The
  detector is proven functional on webui; product source untouched.

## Five known session specs — required per-target disposition

Session `b2b8b521` (the isolated run that motivated this campaign) already rewrote four to the
current product and retired the fifth. Confirmed in this repo:

| Target (ADR) | Disposition | Evidence |
|---|---|---|
| `campaigns-board-lane.spec.ts` (ADR-065) | **already-fixed** | present + live; rewritten by `b2b8b521` |
| `36b-clipboard-name.spec.ts` | **already-fixed** | present + live |
| `48-tricky-char-titles.spec.ts` | **already-fixed** | present + live |
| `30-launch-copy.spec.ts` | **already-fixed** | present + live |
| `37b-bubble-lifecycle.spec.ts` (ADR-068-A1) | **already-fixed** | present + live |
| `77-scrollback-replay` (ADR-087) | **retired** | no `77-*.spec.ts` in `client/e2e/` (slot absent); scrollback now covered by `83-v0.8.7-scrollback-hygiene`, `85-replay-pushdown`, `v0-9-5/6-*replay*` |

None of the five is an orphan in the traceability sense: the five present specs carry **no `@FR`
tag** (so they are untagged review-candidates, not tagged-but-dead), and spec 77 was cleanly
removed. They are the *worked example* that the detector logic is sound; the live Stage-2 proof
above (synthetic `FR-01.99`) is the current demonstration that it fires.

## Follow-ons (handoffs — concrete, not vague)

1. **signal-e → shared engine** (monorepo). Add the co-location (import-verified exclusive-owner)
   + self-listing signals to `backfill_test_links`, so every repo gets deterministic coverage past
   `unique_commit`, canonically tested. Prototype: `.shipwright/compliance/tools/signal_e_colocation.py`.
2. **`.worktrees` prune by descent** (monorepo). Make `backfill_scan` prune `.worktrees` during
   the walk (not via ancestor `path.parts`) so the retrofit runs in the mandated iterate worktree
   without relocation.
3. **FR→file granularity** (webui spec). The 483 ambiguous files need finer FR→file attribution,
   or an accepted multi-FR-per-shared-file convention, before their coverage can be uniquely
   attributed. Design decision — not auto-resolvable.
4. **Anti-ratchet should exempt `@covers`** (monorepo). The mandated tags pushed 5
   grandfathered-large test files over their bloat baseline (`TriageDetailModal.test.tsx`,
   `useTerminalSocket.test.ts`, `actions-substitute.test.ts`, `pty-manager.test.ts`,
   `scrollback-store.test.ts`); their `current` was bumped, referencing this run_id (the
   existing-exception convention). The shared anti-ratchet hook should not count
   `// @covers FR` metadata lines toward the LOC ceiling, so future retrofits don't trip it.
5. **Fold-aware traceability tooling** (monorepo — the #287 collision root cause). The
   `test_links` collector + `D-orphan` read only the survivor FR-table rows, so a `@covers`
   tag on a folded ID is flagged `fr_absent` (this run: 419 such orphans until remapped). The
   collector/detector should resolve a tagged ID through `## FR-Fold-Map` to its survivor
   (identity for a survivor) before deciding orphanhood — so a retrofit's granular tags survive
   a later taxonomy fold instead of hard-breaking. Until then, tags MUST use survivor IDs.
