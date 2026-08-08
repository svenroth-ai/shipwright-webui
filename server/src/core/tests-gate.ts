/*
 * tests-gate.ts — the ONE place a `work_completed` run's recorded test counts
 * turn into a pass/fail/unknown verdict (iterate-2026-08-08-tests-total-skip-contract).
 *
 * Two repos disagree about what `tests.total` means: this project's D4
 * ratchet (`event-test-counts-executed.test.ts`) historically required
 * `total` = tests that EXECUTED (passed + failed), `skipped` tracked apart;
 * the monorepo that actually WRITES these events (`record_event.py` /
 * `tests_block.py`, P2.05, already shipped) uses the opposite: `total` =
 * tests COLLECTED (passed + failed + skipped). Decision: this project adopts
 * the monorepo's convention going forward (see the iterate spec's
 * `## Decision` section) — it is the sole writer for every Shipwright-managed
 * project, not just this one.
 *
 * REVERSAL_EPOCH_MS is a SECOND cutover, layered on the ratchet's existing
 * first one (`CONVENTION_EPOCH_MS`, 2026-07-21): events dated before it keep
 * being read under the OLD rule (`passed === total`, `skipped` ignored for
 * the verdict); events at/after it use the NEW rule (`passed + skipped ===
 * total`). Both branches are PERMANENT — old events are immutable and must
 * keep reading correctly forever, this is not a migration shim to delete
 * later.
 *
 * WHY AN EPOCH, NOT A PERMANENT "EITHER CONVENTION" CHECK. A pure
 * `passed === total || passed + skipped === total` cannot distinguish an
 * OLD-convention run that has a genuine failure whose count happens to equal
 * its `skipped` value (`passed:99, total:100, skipped:1` meant "1 real
 * failure, 1 separately-tracked skip" under the old rule) from a NEW
 * -convention genuinely green run with the identical numbers (100 collected,
 * 0 failures). Caught by external plan review (openai, both the plan pass
 * and the architecture pass) — verified: this project's own Iron Law means a
 * real failure was never actually finalized under the old rule, so the
 * collision has never occurred in this log, but the ratchet's job is to hold
 * even for an event this project did not itself write, so the ambiguity is a
 * real soundness gap, not a cosmetic one. The epoch removes it structurally:
 * an event is judged by exactly ONE rule, never both.
 */

export interface TestsLike {
  passed: number | null;
  total: number | null;
  skipped?: number | null;
}

export type GateState = "pass" | "fail" | "unknown";

/**
 * This run's landing instant — the second reversal. Mirrors D4's own
 * `CONVENTION_EPOCH_MS` pattern exactly (compared as an instant via
 * `Date.parse`, not lexically — this log carries a mix of `Z` and `+02:00`
 * suffixes, which do not sort the same way as strings).
 */
export const REVERSAL_EPOCH_MS = Date.parse("2026-08-08T00:00:00Z");

/** A non-negative integer, else `null` — rejects a negative/float/NaN value
 *  rather than letting it participate in the arithmetic (a negative
 *  `skipped` could otherwise forge a `pass` out of a real shortfall). */
function normalizedCount(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
}

/** An explicit UTC/offset suffix (`Z` or `±HH:MM`/`±HHMM`) — bare
 *  `Date.parse` treats an offset-LESS date-time string as host-LOCAL time
 *  (ECMA-262 Date Time String Format), which would make the epoch verdict
 *  depend on the machine running the check rather than the event itself
 *  (doubt review, LOW-MEDIUM: `"2026-08-08T01:00:00"` parses `pass` in UTC
 *  and `fail` in Europe/Zurich for the same event). This log's real `ts`
 *  values always carry one; an offset-less string is treated the same as an
 *  unparseable one, below. */
function hasExplicitOffset(ts: string): boolean {
  return /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(ts);
}

/**
 * `pass` / `fail` / `unknown` for one run's recorded tests. `unknown` when
 * `total`/`passed` is absent, non-integer, negative, or `total <= 0` — the
 * honest "nothing citable" signal, never a guess. A missing/unparseable/
 * offset-less `ts` defaults to the OLD (pre-epoch) rule — the stricter,
 * already-battle-tested one — so an ambiguous timestamp degrades toward
 * caution, never a false `pass`.
 */
export function deriveTestsGate(tests: TestsLike | null, ts: string | null): GateState {
  if (tests == null) return "unknown";
  const passed = normalizedCount(tests.passed);
  const total = normalizedCount(tests.total);
  if (passed == null || total == null || total <= 0) return "unknown";

  const tsMs = ts && hasExplicitOffset(ts) ? Date.parse(ts) : NaN;
  const isPostReversal = Number.isFinite(tsMs) && tsMs >= REVERSAL_EPOCH_MS;

  if (isPostReversal) {
    const skip = normalizedCount(tests.skipped) ?? 0;
    // `executed = total - skip`. A run where EVERY collected test was
    // skipped (`executed <= 0`) satisfies `passed + skip === total`
    // vacuously (0 + total === total) without a single test having run — the
    // same "nothing citable" gap `total <= 0` above exists to catch, reopened
    // one level down by the reversal (code review, MEDIUM: a false ALL CLEAR
    // is the one thing this predicate must never produce).
    if (total - skip <= 0) return "unknown";
    return passed + skip === total ? "pass" : "fail";
  }
  return passed === total ? "pass" : "fail";
}
