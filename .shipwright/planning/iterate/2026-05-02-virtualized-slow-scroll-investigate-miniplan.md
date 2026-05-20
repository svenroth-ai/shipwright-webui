# Mini-Plan: virtualized-slow-scroll-investigate

- **Run ID:** iterate-2026-05-02-virtualized-slow-scroll-investigate
- **Spec:** [`2026-05-02-virtualized-slow-scroll-investigate.md`](./2026-05-02-virtualized-slow-scroll-investigate.md)
- **Scope:** Phase 1 (instrumentation) + Phase 1.5 (Playwright probe).
  Phase 3 (fix) gets its own mini-plan-2 once Phase 2 data lands.

## Files to touch — Phase 1 (instrumentation)

| File | Purpose | Risk |
|---|---|---|
| `client/src/components/external/BubbleTranscript.tsx` | Per-row mount-time `{viIdx, key, kind, measuredHeight, ...}` log + 1 Hz `getVirtualItems()` snapshot + memo-render counters (H-A, H-B, H-D) | medium — heaviest file in scope; tagged DEBUG markers |
| `client/src/hooks/useTaskTranscript.ts` | Per-poll `{ts, fingerprint, sameContent}` log before `setResult` (H-B) | low |
| `client/src/hooks/useAutoScroll.ts` | Scroll-event + programmatic-re-pin log (H-C) | low |
| `client/src/instr2.ts` (NEW) | `window.__instr2` singleton + `[INSTR2-2s]` printer; `import.meta.env.DEV` + `localStorage('webui.instr2')` gated | low — new file, prod-bundle inert |

## Files to touch — Phase 1.5 (Playwright probe)

| File | Purpose | Risk |
|---|---|---|
| `client/e2e/flows/_slow-scroll-probe.spec.ts` (NEW) | Headed Playwright probe, 30 wheel ticks @ 250 ms cadence, capture artifacts under `client/test-results/_slow-scroll/` | low — underscore prefix avoids CI pickup; gitignored artifacts |

## Build sequence

1. **NEW** `client/src/instr2.ts` — singleton + printer. Gated by
   `import.meta.env.DEV && localStorage.getItem('webui.instr2') === '1'`
   so the production bundle is fully inert.
2. **EDIT** `BubbleTranscript.tsx` — add `useEffect` mount-time log in
   the inner `<VirtualBubbles>` row component, plus a 1 Hz snapshot of
   `virtualizer.getVirtualItems()`. Add memo render-counters to the
   four `useMemo` chains. All gated by the `instr2.enabled` flag.
3. **EDIT** `useTaskTranscript.ts` — log each poll's
   `{ts, fingerprint, sameContent}` BEFORE `setResult`.
4. **EDIT** `useAutoScroll.ts` — log every scroll event AND every
   programmatic re-pin path with the diagnostic envelope.
5. **NEW** `client/e2e/flows/_slow-scroll-probe.spec.ts` — probe spec
   that produces baseline + after JSON + frame screenshots. Check the
   user's Hono :3847 + Vite :5173 are running; `test.skip()` with a
   clear hint otherwise.
6. **RUN** `cd client && npx playwright test e2e/flows/_slow-scroll-probe.spec.ts --headed --project=chromium`.
   If headed Chromium fails to reproduce the symptom, fall back to
   `--project=chromium --browser=chrome` channel; if still no
   reproduction, accept user-driven measurement (one-time roundtrip).

## Test strategy

- **No new Vitest tests in Phase 1.** Instrumentation is debug code,
  not feature code. Adding tests for `console.log` shape would be
  noise.
- **No regression test asserting on the bug yet.** Visual flicker
  isn't testable without a real browser per conventions.md
  "browser-coordinated layout heuristics" learning. The probe spec
  serves as the data-capture mechanism, not a pass/fail gate.
- **Existing 640 unit tests + lint + typecheck must stay green.**
  All instrumentation paths are no-ops behind the `instr2.enabled`
  gate.

## Rollback

Phase 1 + 1.5 are pure-additive: a new file (`instr2.ts`) + a new
probe spec + DEBUG-tagged additions to three existing files. Revert
is a single `git restore` of those files plus `git rm` of the new
ones if needed.

## Mini-plan-2 placeholder (Phase 3)

To be written after Phase 2 data analysis. Will cover:
- Which hypothesis the data validated (with confidence).
- Single fix proposal touching the smallest scope possible.
- Whether any hard constraint is being re-opened with explicit data
  evidence (and which one, with the data points cited).
- Test strategy for the regression test (assertion on the
  data-validated invariant, NOT visual flicker).
- External LLM review before commit (medium-auto path).

## Why Phase 3 is gated separately

The user's prompt explicitly approved Phase 1 + 1.5 + 2. Phase 3 is a
fresh decision that depends on data we don't have yet. The
iterate-skill's User Approval Gate (medium+ before build) applies to
any code change that lands; the instrumentation is short-lived and
removed before commit, so the gate naturally sits at the Phase 3
boundary, not at the Phase 1 boundary.
