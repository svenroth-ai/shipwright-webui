/*
 * event-test-counts-executed.test.ts — the D4 ratchet: the recorded `tests`
 * block, read through `tests-gate.ts`'s epoch-aware predicate, must always
 * resolve to a genuine pass for every in-scope `work_completed` event.
 *
 * ORIGIN (iterate-2026-07-21-compliance-audit-reconcile, Group D4)
 * ------------------------------------------------------------
 * `write-symlink-guard.test.ts` probes whether the host can create a file
 * symlink and degrades to `it.skip` when it cannot — Windows without Developer
 * Mode. F5 recorded `total` INCLUDING that skip, so every run on such a host
 * wrote `passed = total - 1`. The compliance audit's D4 reads `passed < total`
 * as "this FR was last touched in a FAILING build", so seven unrelated FRs were
 * reported as landing in a red build that never happened — the suite was green
 * (measured at the time of the fix: client 2912/2912, server 2890 passed +
 * 1 skipped, 0 failed).
 *
 * A skipped test is not a failure. This project's original convention (from
 * CONVENTION_EPOCH_MS, 2026-07-21) was therefore:
 *
 *     tests.total   = tests that RAN (passed + failed)
 *     tests.passed  = of those, how many passed
 *     tests.skipped = tests that did NOT run (skipped / todo), reported apart
 *
 * REVERSAL (iterate-2026-08-08-tests-total-skip-contract, RunID same)
 * ------------------------------------------------------------------
 * The monorepo that actually WRITES these events (`record_event.py` /
 * `tests_block.py`, P2.05, already shipped) uses the OPPOSITE convention:
 * `total` = tests COLLECTED (passed + failed + skipped), invariant
 * `passed + skipped <= total`. It is the sole writer for every
 * Shipwright-managed project, not just this one — so this project adopts its
 * convention going forward rather than keep diverging from its only producer
 * (see the run's `## Decision` section; consulted per operator instruction).
 *
 * Both rules are judged by exactly ONE gate now: `tests-gate.ts`'s
 * `deriveTestsGate(tests, ts)`, gated by `REVERSAL_EPOCH_MS`
 * (2026-08-08T00:00:00Z) layered on this file's `CONVENTION_EPOCH_MS`. Before
 * the reversal: OLD rule (`passed === total`); at/after: NEW rule (`passed +
 * skipped === total`). Permanent, not a migration shim — see `tests-gate.ts`'s
 * header for why an epoch, not a permanent "either convention" check, is
 * required (a genuine old-convention failure can numerically coincide with a
 * genuine new-convention pass).
 *
 * This test is the ratchet — conventions.md alone would not have stopped the
 * original drift (the producer is the agent writing the F5 block), so the
 * rule needs a gate that fails the suite, not a paragraph nobody re-reads.
 *
 * SCOPE — events recorded from CONVENTION_EPOCH forward. The epoch is about
 * ENFORCEMENT (the convention starts with the run that introduced it), not
 * about which records were fixed: every shortfall sharing the verified cause —
 * short by exactly 1 AND recorded after the symlink test landed (2026-07-11
 * 13:12 UTC) — was corrected by append-only `event_amended` rows, 30 in total,
 * whether or not any check could see it. D4 reads only an FR's LATEST covering
 * event via `affected_frs`, so several wrong records were invisible to it; they
 * were corrected anyway rather than left to resurface.
 *
 * THREE records are deliberately left as-recorded, and must not be "tidied"
 * later without new evidence:
 *   - `evt-c65151e1` (2026-05-17, 1939/1940) — predates the symlink test.
 *   - `evt-f5bbbde2` (1915/1916) — the run that ADDED the test; its own event
 *     was recorded before the test could skip.
 *   - `evt-e5ff8fd4` (2026-07-15, 13/17) — short by 4, an unverified cause;
 *     it is the e2e-pty harness, whose failures are environmental.
 * Back-dating one blanket explanation onto these would be a guess, which is the
 * error this whole reconciliation was correcting.
 *
 * AMENDING A `tests` BLOCK — RESTATE IT WHOLE. `events_amend.apply_amendments`
 * merges SHALLOWLY (`{**target, **fields}`), so a `fields.tests` REPLACES the
 * block rather than patching it. The first cut of this reconciliation dropped
 * `e2e_run` from 28 records (6 of them `true`) exactly that way; `e2e_run` is
 * live — `test_evidence.py` classifies a work event's layer as "mixed" from it,
 * so the next regen would silently have re-labelled them "unit". Caught by
 * review, not by any gate. Copy the original block, then correct it.
 *
 * TWO of the historical amendments predate this reversal and are read under
 * the OLD rule by `ts`, exactly as recorded: `evt-c4e54fde` (amending
 * `evt-8bddddb0`, 2026-08-03) and `evt-2d0b9be9` (amending `evt-bf10f231`,
 * 2026-08-05) both corrected a then-nonconforming `skipped`-carrying record
 * back to the OLD convention (`passed === total`, dropping/zeroing the
 * shortfall `skipped` would have caused). They are not reinterpreted by the
 * reversal — the reversal changes what NEW events mean, never what an already
 * -amended historical event was corrected to mean.
 *
 * FORWARD RULE: `effectiveEvents()` keeps the TARGET's OWN `ts` on overlay (an
 * amendment's `ts` is discarded), so a FUTURE amendment of a pre-reversal
 * event's `tests` must still be written in the OLD shape (doubt review, LOW).
 *
 * INTEGRITY, independent of the pass/fail verdict: `total` can never be less
 * than `passed` under EITHER convention (external plan review, deepseek) — a
 * `passed` count exceeding what was recorded as `total` is malformed no matter
 * which convention produced the record. `total >= passed + skipped` is
 * additionally required POST-reversal only (where `total` = collected, so
 * passed+skipped can never legitimately exceed it) — pre-reversal, `skipped`
 * is tracked APART from `total` by design (the real historical shape is
 * `passed:4390, total:4390, skipped:1`, where `passed + skipped > total` is
 * correct, not a defect), so that half of the check would misfire if applied
 * unconditionally.
 *
 * WHAT THIS GUARD CANNOT CATCH. It compares `passed`/`total`/`skipped` inside
 * one record; it has no independent measurement to check them against. A
 * producer that writes the COLLECTED count into `total` alone (no `skipped`)
 * still passes post-reversal while hiding nothing — that is the new
 * convention working as intended. A producer that writes the same COLLECTED
 * count into `total` PRE-reversal, with no `skipped`, would misread as
 * genuinely green (it is — pre-reversal with no skipped, collected count and
 * executed count coincide only when nothing was skipped, which is the
 * unambiguous case).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseJsonlRecords } from "../core/jsonl-records.js";
import { deriveTestsGate, REVERSAL_EPOCH_MS } from "../core/tests-gate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../");
const eventsPath = path.join(repoRoot, "shipwright_events.jsonl");

/**
 * The convention starts with the run that introduced it. Events at or after
 * this instant must satisfy the invariant; earlier ones are out of scope (see
 * the header). Anchored to the amendment batch that corrected the seven.
 *
 * Compared as an INSTANT, not lexically: 70 records in this log carry `+02:00`
 * rather than `Z`, so string ordering and chronological ordering are not the
 * same relation. (No record currently sorts differently either way, but the
 * assumption has already been false once in this file's history.)
 */
const CONVENTION_EPOCH_MS = Date.parse("2026-07-21T00:00:00Z");

interface TestsBlock {
  passed?: unknown;
  total?: unknown;
  skipped?: unknown;
}

interface EventRecord {
  id?: unknown;
  ts?: unknown;
  type?: unknown;
  adr_id?: unknown;
  amends?: unknown;
  fields?: Record<string, unknown>;
  tests?: unknown;
}

/**
 * Effective events: `event_amended` rows overlay their target, as every
 * compliance consumer sees them (shared `events_amend.apply_amendments`).
 *
 * LAST AMENDMENT WINS PER TARGET — deliberately, and it mirrors the shared
 * implementation exactly (`amendments[amends] = fields` replaces, it does not
 * deep-merge). DO NOT "fix" this into a cumulative merge: that would make this
 * guard read a different effective log than the audit does. The convention is
 * that a second amendment RESTATES everything it wants to keep — the
 * 2026-06-29 amendment of `evt-2646f4da` re-lists `FR-01.01` alongside the
 * `FR-01.42` it adds, precisely because the earlier overlay is discarded.
 */
function effectiveEvents(): EventRecord[] {
  // Read the log the way the audit does — via the tolerant record reader, NOT a
  // per-line `JSON.parse`. `merge=union` on an append-only log can put two
  // records on one physical line (the whole reason `jsonl-records.ts` exists),
  // and a plain parse drops BOTH, which would make an offending record
  // invisible to this guard while the audit still judged it.
  const rows = parseJsonlRecords(fs.readFileSync(eventsPath, "utf-8"))
    .records as EventRecord[];
  const amendments = new Map<unknown, Record<string, unknown>>();
  for (const row of rows) {
    if (row.type === "event_amended") amendments.set(row.amends, row.fields ?? {});
  }
  return rows
    .filter((row) => row.type !== "event_amended")
    .map((row) => (amendments.has(row.id) ? { ...row, ...amendments.get(row.id) } : row));
}

describe("recorded test counts obey their era's convention (D4 ratchet)", () => {
  const inScope = effectiveEvents().filter(
    (e) =>
      e.type === "work_completed" &&
      typeof e.ts === "string" &&
      Number.isFinite(Date.parse(e.ts)) &&
      Date.parse(e.ts) >= CONVENTION_EPOCH_MS &&
      typeof e.tests === "object" &&
      e.tests !== null,
  );

  it("has events in scope to check (the guard cannot pass vacuously)", () => {
    expect(inScope.length).toBeGreaterThan(0);
  });

  /**
   * Well-formedness is asserted, never used as a filter. Skipping records whose
   * `passed` / `total` are not numbers would let a broken producer evade the
   * invariant simply by writing `"2890"` or omitting a field — the offender
   * would vanish from the list instead of failing the gate.
   */
  it("records a well-formed tests block", () => {
    const malformed = inScope
      .map((e) => ({ e, t: e.tests as TestsBlock }))
      .filter(
        ({ t }) =>
          !Number.isInteger(t.passed) ||
          !Number.isInteger(t.total) ||
          (t.passed as number) < 0 ||
          (t.total as number) < 0,
      )
      .map(
        ({ e, t }) =>
          `${String(e.adr_id)} (${String(e.id)}): passed=${JSON.stringify(t.passed)} ` +
          `total=${JSON.stringify(t.total)}`,
      );

    expect(
      malformed,
      "a `tests` block must carry `passed` and `total` as non-negative integers — " +
        "a string or missing count is a broken producer, not an exemption.",
    ).toEqual([]);
  });

  /**
   * The generalized D4 invariant, epoch-gated via `tests-gate.ts`: EVERY
   * in-scope event must resolve to a genuine `pass`. Pre-reversal this is
   * exactly the original `passed === total` check; post-reversal it is
   * `passed + skipped === total`. A finalized run is never legitimately
   * anything but green (F0 gates on it), so `"fail"`/`"unknown"` here is
   * always a real producer defect, not a false positive to special-case.
   */
  it("resolves to a genuine pass for every in-scope event (epoch-aware D4)", () => {
    const offenders = inScope
      .map((e) => ({ e, t: e.tests as TestsBlock, gate: deriveTestsGate(e.tests as TestsBlock, e.ts as string) }))
      .filter(({ gate }) => gate !== "pass")
      .map(
        ({ e, t, gate }) =>
          `${String(e.adr_id)} (${String(e.id)}, ${String(e.ts)}): ${String(t.passed)}/${String(t.total)}` +
          `${t.skipped !== undefined ? ` skipped=${String(t.skipped)}` : ""} -> ${gate}`,
      );

    expect(
      offenders,
      "every in-scope event must resolve to a genuine pass under its epoch's convention. " +
        "A skipped test belongs in `tests.skipped`, not in the shortfall — see this file's " +
        "header. If a test genuinely FAILED, the run should not have been finalized at all " +
        "(F0 gates on a green suite).",
    ).toEqual([]);
  });

  it("keeps any skipped count a non-negative integer (convention-independent)", () => {
    const bad = inScope
      .map((e) => ({ e, t: e.tests as TestsBlock }))
      .filter(
        ({ t }) =>
          t.skipped !== undefined &&
          (!Number.isInteger(t.skipped) || (t.skipped as number) < 0),
      )
      .map(({ e, t }) => `${String(e.adr_id)}: skipped=${JSON.stringify(t.skipped)}`);

    expect(bad, "`tests.skipped` must be a non-negative integer when present").toEqual([]);
  });

  /**
   * Convention-independent integrity: `total` can never be less than `passed`
   * — malformed under EITHER convention, external plan review (deepseek).
   */
  it("never records passed > total, under either convention", () => {
    const offenders = inScope
      .map((e) => ({ e, t: e.tests as TestsBlock }))
      .filter(({ t }) => (t.passed as number) > (t.total as number))
      .map(({ e, t }) => `${String(e.adr_id)} (${String(e.id)}): ${String(t.passed)}/${String(t.total)}`);

    expect(offenders, "`passed` must never exceed `total`, regardless of convention").toEqual([]);
  });

  /**
   * POST-reversal only: `total` = collected, so `passed + skipped` can never
   * legitimately exceed it. Pre-reversal `skipped` is tracked APART from
   * `total` by design — the real historical shape is
   * `passed:4390, total:4390, skipped:1`, where `passed + skipped > total` is
   * correct, not a defect — so this check would misfire if applied
   * unconditionally (see this file's header).
   */
  it("post-reversal: never records passed + skipped > total", () => {
    const offenders = inScope
      .filter((e) => Date.parse(e.ts as string) >= REVERSAL_EPOCH_MS)
      .map((e) => ({ e, t: e.tests as TestsBlock }))
      .filter(({ t }) => (t.passed as number) + ((t.skipped as number) || 0) > (t.total as number))
      .map(
        ({ e, t }) =>
          `${String(e.adr_id)} (${String(e.id)}): ${String(t.passed)}+${String(t.skipped)}/${String(t.total)}`,
      );

    expect(
      offenders,
      "post-reversal, `total` counts everything collected — `passed + skipped` exceeding it " +
        "means `total` was not the collected count",
    ).toEqual([]);
  });
});
