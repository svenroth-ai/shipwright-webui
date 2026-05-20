# Iterate Spec: virtualized-slow-scroll-investigate

- **Run ID:** iterate-2026-05-02-virtualized-slow-scroll-investigate
- **Type:** bug (investigation + measurement-driven fix)
- **Complexity:** medium (override from classifier=trivial — see "Risk-flag override" below)
- **Status:** draft (Phase 1 / instrumentation)
- **Affected FRs:** FR-01.02 (Task detail / BubbleTranscript) — extension if Phase 3 fix lands
- **Predecessors:** ADR-062 (kept), ADR-063 [REVERTED], ADR-064 [REVERTED], ADR-065 (kept). This is the FIFTH attempt at the same bug.

## Goal

Identify and fix the residual SLOW-scroll-up jump on long virtualized
BubbleTranscript transcripts (>= 200 visible events). After ADR-065
landed (rapid-scroll mostly fixed), the user reports that **slow
scroll-up still jumps** — German: _"Er zieht den Code nach"_.

The investigation is **Playwright-first and measurement-driven** per the
load-bearing memory note `feedback_virtualized_scroll_measure_first.md`
and conventions.md Learnings: _"Side-effects can be load-bearing — measure
before optimising perf."_

Three of the four prior attempts at this bug failed because they reasoned
from code-reading; the only ones that landed (ADR-062, ADR-065) had
per-row instrumented data captured **before** any code change. This run
follows the same shape, with a Playwright probe spec replacing the
manual user-driven measurement loop so the user is OUT of the
per-iteration loop until Phase 4.

## Hard constraints (do NOT touch without measurement evidence)

1. ❌ `overflow-anchor` (ADR-063 [REVERTED] — disabling it made overall
   scroll worse).
2. ❌ `useTaskTranscript` polling cascade (ADR-064 [REVERTED] — the
   cascade is load-bearing as a scheduled re-measure for the
   virtualizer).
3. ❌ ADR-062 virtualizer config: `getItemKey`,
   `useAnimationFrameWithResizeObserver`, `overscan: 16`.
4. ❌ ADR-065 `filterEventsForRender`.

If the data forces a fix into one of these areas, the constraint is
re-opened with explicit data evidence. Default is "do not touch."

## Investigation protocol

### Phase 1 — Hypothesis-free instrumentation

Add a `window.__instr2` aggregating singleton + 2-second `[INSTR2-2s]`
periodic summary printer. Tag every line with
`[DEBUG-INSTRUMENTATION 2026-05-02 virtualized-slow-scroll-investigate]`
for trivial Phase-5 cleanup. Cover all four hypotheses:

- **H-A — estimate-vs-measure during slow scroll.** In `<VirtualBubbles>`
  per-row mount-time:
  `{viIdx, key, kind, measuredHeight, estimate: 96, delta, scrollTop, vi.start}`.
  Plus a 1 Hz snapshot of
  `virtualizer.getVirtualItems().map(v => ({index, key, start, size}))`.
- **H-B — polling cascade.** In `useTaskTranscript` log each poll
  `{ts, fingerprint, sameContent}` BEFORE `setResult`. In
  `BubbleTranscript` add render counters to the `useMemo` chain
  (`parseSessionJsonl`, `filtered`, `visible`, `visibleForRender`).
- **H-C — auto-scroll guard.** In `useAutoScroll` log every scroll
  event AND every executed/skipped programmatic re-pin:
  `{ts, source, dtSinceUserScroll, userDetached, distance, scrollTop, scrollHeight}`.
- **H-D — residual near-empty rows.** In the assistant branch of
  `renderBubble` log
  `{hasVisibleBubbleContent, isThinkingOnly, toolUses.length, measuredHeight}`
  when all-three-falsy.

### Phase 1.5 — Playwright probe spec

`client/e2e/flows/_slow-scroll-probe.spec.ts` (underscore prefix → not a
CI test; cleaned up or renamed in Phase 5).

The spec must:

1. Verify Hono :3847 + Vite :5173 are reachable; skip with a clear
   setup hint otherwise.
2. Open `http://localhost:5173/tasks/6cd07bd3-fa44-4ac2-9944-df07a2b59965`.
3. Wait until `window.__instr2` exists AND
   `[data-testid="bubble-list-virtual"]` is in the DOM with >= 100
   children mounted.
4. Capture baseline →
   `client/test-results/_slow-scroll/slow-scroll-baseline.json`.
5. Slow-scroll: 30 wheel ticks of `{deltaY: -100}` with 250 ms between
   (matches `ACTIVE_SCROLL_GUARD_MS`).
6. Capture screenshot every 200 ms during the scroll →
   `slow-scroll-frame-NN.png`.
7. After scroll: capture `window.__instr2` →
   `slow-scroll-after.json`.
8. Run `--headed --project=chromium`.

Artifact directory: `client/test-results/_slow-scroll/` (already
gitignored via `client/test-results/`).

### Phase 2 — Data analysis (no user roundtrip)

Answer from baseline + after JSON + screenshots:

- H-A: do mounts during slow scroll show heights ≫ or ≪ 96 px? Which
  kinds?
- H-B: does the polling cascade fire during the 7.5 s scroll window AND
  does its memo-invalidation correlate with frame-to-frame jumps?
- H-C: does `useAutoScroll` re-pin during slow scroll? At what cadence?
- H-D: are empty-assistant rows present in the visible window?
- Frame-diff: any frame pair shows content-shift > 5 px without a
  scroll-event correlate? (visual jump, NOT scroll-driven)

Iterate the probe spec — adjust scroll cadence, deltaY, sample times
— until the data clearly identifies the discriminator. **No user
involvement during this phase.**

### Phase 3 — Fix (only if data-validated)

Single fix per iterate. Hard constraints above still apply unless data
forces re-opening with explicit evidence. Re-gate user approval here
with the mini-plan-2 covering the data-validated fix.

### Phase 4 — User visual verification

ONE round-trip with user: restart Vite, user hard-refreshes test URL,
scrolls slowly once, says ja/nein. Push only after **ja**.

### Phase 5 — Cleanup

Remove all `[DEBUG-INSTRUMENTATION 2026-05-02 …]` markers. Decide:
probe spec stays as a regression guard (rename without underscore
prefix, commit) OR delete.

## Acceptance Criteria

_Provisional — Phase 2 data may refine these. AC1–AC4 are unconditional;
AC5 is conditional on a data-validated fix landing._

- [ ] **AC1 (Phase 1):** `window.__instr2` singleton + `[INSTR2-2s]`
  printer + per-row mount-time logging is in place, gated by
  `import.meta.env.DEV` AND a `localStorage` flag so the production
  bundle is unaffected.
- [ ] **AC2 (Phase 1.5):** `client/e2e/flows/_slow-scroll-probe.spec.ts`
  exists, is `test.skip()`-guarded when the dev servers are not
  reachable, and produces `slow-scroll-baseline.json`,
  `slow-scroll-after.json`, and `slow-scroll-frame-NN.png` artifacts.
- [ ] **AC3 (Phase 2):** A "Data analysis" section is appended to this
  spec (in place, not a separate file) summarising findings per
  hypothesis with explicit confidence (high / medium / low). Prior
  reverts overestimated; calibration matters here.
- [ ] **AC4 (Phase 5):** Every `[DEBUG-INSTRUMENTATION 2026-05-02 …]`
  marker is removed from the codebase. `window.__instr2` is gone.
- [ ] **AC5 (Phase 3, conditional):** If a data-validated fix lands,
  it ships with at least one regression test that asserts on the
  data-validated invariant (NOT visual flicker — that is untestable
  in jsdom per the conventions.md "browser-coordinated layout
  heuristics" learning). FR-01.02's existing AC list is extended.
- [ ] **AC6 (Phase 4, conditional on AC5):** User confirms via visual
  verification that slow-scroll-up no longer jumps on the test session.
  **Push to main only after this step.**
- [ ] **AC7 (always):** Hard constraints respected — no edits to
  `overflow-anchor`, `useTaskTranscript` polling cascade, ADR-062
  config, or ADR-065 `filterEventsForRender` without explicit data
  evidence in this spec's "Data analysis" section.

## Affected FRs

- **FR-01.02 Task detail (3-pane viewer)** — if Phase 3 lands, extend
  the existing acceptance criteria list (post-ADR-065) with a new
  bullet covering the slow-scroll invariant. Investigation alone is
  not an FR change.

## Out of Scope

- Reworking parser to recognise `bash hook` / `deferred-tools-delta`
  attachments as a distinct kind (deferred from ADR-065 → still
  deferred).
- Replacing TanStack Virtual with another library (out of scope).
- Reducing virtualizer `FALLBACK_ROW_PX` estimate without data.
- Bumping `VIRTUALIZE_THRESHOLD` from 200 (rejected by ADR-062 as
  symptom-narrowing, not cause-fixing).
- Touching the auto-scroll active-scroll-guard `ACTIVE_SCROLL_GUARD_MS`
  constant without H-C data evidence.

## Risk-flag override

The complexity classifier returned `trivial` (confidence 0.6). I'm
overriding to **medium** based on the following Repo-Scout findings:

1. Three of the four prior attempts at this exact bug were reverted
   same-day (ADR-063, ADR-064, plus an unnumbered mermaid hypothesis).
   Regression risk is high and asymmetric.
2. conventions.md "Learnings" carries an explicit, load-bearing rule:
   _"Side-effects can be load-bearing — measure before optimising
   perf. Do NOT iterate on hypothesis-from-code-reading; the rendering
   stack is too interlocked."_ This rule alone justifies the heavier
   process.
3. The fix scope is unknown until measurement is complete; that
   uncertainty itself argues for an iterate-spec + mini-plan + external
   review before any commit (medium phase matrix).

Mandatory review is preserved at medium.

## Design Notes

No design changes. Same UX surface, behavioral fix to the rendering
implementation. No mockup edits, no design-fidelity work.

## Data analysis (Phase 2)

Probe ran headed Chromium against the user's test session
(`6cd07bd3-fa44-4ac2-9944-df07a2b59965`, 426 JSONL lines, 911 KB) on
2026-05-02. 30 wheel ticks of `{deltaY: -100}` at 250 ms cadence (matches
`ACTIVE_SCROLL_GUARD_MS`). Captured: 55 mount events, 22 polls, 8
scroll/re-pin events, 12 1 Hz virtualizer snapshots, 32 frame
screenshots. Symptom REPRODUCED in headed Chromium — frames 16–22 show
multi-KB visual content shifts during steady wheel rate.

### H-A: estimate-vs-measure during slow scroll — HIGH CONFIDENCE, primary cause

| Metric | Value |
|---|---|
| Mean signed delta from `FALLBACK_ROW_PX` (96) | **+104.7 px** |
| Mean absolute delta | 151.6 px |
| Max absolute delta | **1743 px** (single row) |
| Mounts by kind | assistant: 49, user: 6 |
| Height bucket distribution | 50–99: 36, 100–199: 6, 200–499: 7, **500+: 6** |

The estimate is systematically too LOW — measured sizes skew strongly
positive. Worst-case incident (timeline-extracted from instr2
`mountLog` interleaved with `wheelLog`):

```
t=5786 ms  MOUNT viIdx=101 measuredHeight=914 estimate=96 delta=+818
t=5791 ms  WHEEL #16  (5 ms after the +818 px layout shift)
```

A single row mounted at 914 px against a 96 px reservation. Within 5 ms,
the next user wheel fires. Result: in one paint frame, content below
that row shifts by +818 px (because TanStack Virtual recomputes
`vi.start` for everything below). The user perceives this as the
already-visible content "trailing" the scroll — exactly the German
description _"Er zieht den Code nach"_. Frame-diff data confirms: PNG
byte sizes between frames 16–22 jump by 5–10 KB each (visual content
materially changing) while wheel rate is constant.

`virtualSnapshots` show `totalSize` jumping `14771 → 15563 px` (+792 px)
between snap 4 and snap 5 — confirming the size cascade from a single
late-measured row.

### H-B: polling cascade — MEDIUM-LOW CONFIDENCE, minor contributor

| Metric | Baseline | After scroll | Delta |
|---|---|---|---|
| `parseSessionJsonl` runs | 4 | 4 | 0 |
| `filtered` runs | 4 | 4 | 0 |
| `visible` runs | 4 | 4 | 0 |
| `visibleForRender` runs | 4 | 4 | 0 |
| `bubbleListRender` | 4 | 24 | +20 |
| `pollSetResult` (new content) | 2 | 2 | 0 |
| `pollFingerprintMatch` | 0 | 20 | +20 |

Twenty same-fingerprint polls fired during the 7.5 s scroll window. Each
re-rendered BubbleTranscript at the top level — but **all four
downstream useMemos held identity**. ADR-064's hypothesis was wrong on
this point: `content` is a string, and string deps under React's
`Object.is` comparison are value-equal, not reference-equal. Same-byte
content does not invalidate `parseSessionJsonl`'s memo.

The 20 BubbleTranscript renders DO re-run the inline `measureRef`
callback for each visible virtual row (function identity changes per
render → React calls each ref). That triggers `virtualizer.measureElement(el)`
20 times per row. RO bails early when sizes are unchanged, so this
adds CPU overhead but not new layout shifts. **Not the primary cause,
but cannot be ruled out as a noise floor.**

### H-C: auto-scroll guard — HIGH CONFIDENCE, not a contributor

| scrollLog source | Count |
|---|---|
| `programmatic-executed` | 2 (both at probe init, before wheel loop started) |
| `programmatic-skipped:not-growth` | 4 |
| `programmatic-skipped:far-from-prev-bottom` | 1 |
| `user` | 0 logged (the wheel events don't fire onScroll on the container directly when handled by browser-default; Playwright's `mouse.wheel` synthesis path) |
| `programmatic-skipped:userDetached` | 0 |

During the slow-scroll loop, every `useAutoScroll` re-pin attempt
correctly **skipped** (not-growth on shrink, far-from-prev-bottom when
user is mid-scroll). The `ACTIVE_SCROLL_GUARD_MS=250` is doing its job.
The two `programmatic-executed` entries fired BEFORE the wheel loop
began (initial layout settling). **Auto-scroll is not fighting the
virtualizer here.**

### H-D: empty-assistant rows — HIGH CONFIDENCE, not a contributor

`emptyAssistantLog` length: **0**. The reviewer's M1 deferred case from
ADR-065 (assistant events with no content, no tool_uses, not thinking)
does not occur in this session. The post-ADR-065 `filterEventsForRender`
combined with `hasVisibleBubbleContent` upstream filtering already
eliminates them.

### Discriminator

The dominant mechanism is **a single content kind (assistant rows with
markdown / code / vitest output) producing measurements 100–1700 px
larger than the 96 px estimate, mounting one-at-a-time as the
slow-scroll wheel cadence drips them into the overscan window, with each
mount producing a visible layout cascade that the next wheel event
arrives in time to interleave with.** The user perceives the cascade
as content trailing the scroll input.

ADR-065's null-row filter solved the NEGATIVE-delta case (rapid scroll
through 14 px placeholders → many small −82 px corrections per second).
This iterate identifies the surviving POSITIVE-delta case (slow scroll
through tall assistant rows → fewer but much larger +800 px corrections
per scroll event).

## Fix decision (Phase 3)

### Mini-plan-2

**Single fix proposal: persist TanStack Virtual measurements across
page lifetime via `localStorage`, keyed by `sessionUuid`. Rehydrate on
virtualizer creation via `initialMeasurementsCache`.**

**Why this fix:**

The data shows the cascade fires only on **first mount** of unseen
rows. TanStack Virtual already caches measurements across re-renders
(via ADR-062's `getItemKey`). What it does NOT do is persist that
cache across page reloads. The user's reported workflow is observing
existing tasks — they reload the same task multiple times. Each reload
produces a fresh empty cache, so the slow-scroll cascade fires every
visit.

Persisting the cache to localStorage means:
- First visit to a fresh long task: cascade fires once (acceptable per
  user feedback that says they noticed only AFTER ADR-065's rapid-scroll
  fix landed; first-visit slow-scroll has presumably always been there
  but is rare and brief).
- Subsequent visits: cache rehydrated → virtualizer's first-render sizes
  are correct → no cascade → smooth slow scroll-up.

**Why not the alternatives:**

- Tune `FALLBACK_ROW_PX` higher (96 → 200) — REJECTED. Mean is +105 px
  but variance is huge (50 to 1700 px). Higher estimate over-reserves
  for typical 60 px assistant rows, producing a SHRINK cascade in the
  other direction. Net: shifts the gap, doesn't close it.
- Per-kind estimate function — REJECTED for the same variance reason.
  `assistant` kind alone spans 50 to 1700 px depending on text content.
- Bump `overscan` from 16 → 32+ — REJECTED. ADR-062 already paid the
  DOM-mount cost once. More overscan delays the surprise to the next
  scroll, doesn't eliminate it.
- Pre-render plain mode for one paint frame to populate cache —
  REJECTED for v1 of fix. Renders 200+ rows twice on first visit, much
  larger code change. Reconsider as a follow-up if localStorage path
  doesn't resolve user's symptom.

**Hard constraints respected:**

- ❌ overflow-anchor — UNTOUCHED
- ❌ useTaskTranscript polling cascade — UNTOUCHED
- ❌ ADR-062 virtualizer config (getItemKey, RAF-RO, overscan: 16) —
  UNTOUCHED (we ADD `initialMeasurementsCache`, we do not change those)
- ❌ ADR-065 `filterEventsForRender` — UNTOUCHED

No hard constraint is being re-opened. The fix is purely additive.

**Files to touch:**

| File | Change | Risk |
|---|---|---|
| `client/src/components/external/BubbleTranscript.tsx` | New `useVirtualizerSizeCache(sessionUuid)` hook (or inline hook), passed as `initialMeasurementsCache` to `useVirtualizer`; measurement-tap on the existing `measureRef` to also write to our cache | medium |
| `client/src/lib/virtualizerSizeCache.ts` (NEW) | Pure module: `loadSizeCache(sessionUuid)`, `persistSizeCache(sessionUuid, map)`, schema versioning, hard cap (1000 entries / 10 KB per session), prune-on-write | low |
| `client/src/components/external/__tests__/virtualizerSizeCache.test.ts` (NEW) | Vitest unit tests: load/persist round-trip, schema mismatch ignored, cap enforcement, prune-on-write | low |
| `client/src/components/external/BubbleTranscript.tsx` (test seam) | Test for cache rehydration on prop change (sessionUuid switch clears cache) | low |

**Test strategy:**

- New pure-function tests for the cache module (jsdom-friendly).
- 1–2 component-level tests asserting the cache is read on mount and
  written on unmount (using `localStorage` in jsdom).
- The `_slow-scroll-probe.spec.ts` is repurposed as the regression
  guard: rename to `83-virtualized-slow-scroll-cache.spec.ts`,
  assert that on a SECOND visit (page reload) `mountLog.length` is
  near zero (because cache is rehydrated). This is the
  data-validated invariant.

**Rollback path:**

If user verification fails (Phase 4 → nein):
- Revert all changes via `git restore`. The instrumentation singleton
  + probe spec can stay on the branch for the next attempt.
- `localStorage` keys we wrote can be ignored (left harmless, prune-on-write
  caps growth).

**Confidence calibration:**

| Claim | Confidence |
|---|---|
| H-A is the dominant cause of the slow-scroll symptom | high |
| H-B/C/D are not primary contributors | high (H-D), high (H-C), medium-low (H-B; cannot rule out as noise floor) |
| LocalStorage cache rehydration eliminates the symptom on subsequent visits | medium-high (matches measured cause; first-visit symptom remains) |
| Fix lands without regression on the 640 unit-test baseline | medium (new code paths; tests should catch obvious issues) |
| Fix matches the user's reported workflow | high (they reload the same long task to reproduce) |

Prior reverts (ADR-063, ADR-064, mermaid hypothesis) all overestimated
their fix's impact. This proposal is calibrated NOT to claim
first-visit relief — only return-visit relief. If user's reproduction
involves repeated reloads, the fix should resolve it. If user can
reproduce on the very first visit to a fresh task, they may need to
report that separately so we can plan a pre-render-based follow-up.

**Awaiting user approval before Phase 3 build.**
