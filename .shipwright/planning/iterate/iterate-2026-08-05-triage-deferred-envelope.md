# Iterate Spec: triage-deferred-envelope

- **Run ID:** iterate-2026-08-05-triage-deferred-envelope
- **Type:** change
- **Complexity:** medium (escalated from the classifier's `small` — see below)
- **Risk flags:** touches_public_api
- **Status:** implemented
- **Triage card:** trg-f2214310 (moved from the monorepo, was trg-731cd03c
  there, on 2026-08-01)
- **Cross-repo gate:** monorepo P2.03 (`iterate-2026-08-01-triage-defer-lifecycle`,
  PR #539) confirmed DELIVERED on `origin/main`; `CONTRACT_VERSION = 2` confirmed
  live in `shared/scripts/lib/triage_contract.py`. Verified 2026-08-05 before
  this run started (see F12 summary for the exact evidence).

## Complexity escalation rationale

`classify_complexity.py` returned `small` (history-prior fallthrough, no scope
keyword matched, confidence 0.6). Escalating to `medium` on positive evidence
before Stage-2 Repo Scout, per the skill's "fall-through may inform how LOW to
go, never how HIGH" rule:

- `touches_public_api` — the wire shape read by `readAllItems()` gains two new
  fields that every consumer must agree on (`revisitAt`, `revisitDue`), and a
  parity test asserts byte-for-byte agreement with the monorepo's Python
  `read_all_items()` / `triage_cli.py list --json`.
- The change spans both npm workspaces (`server/` type + resolver + route
  validation, `client/` type + UI), each with its own test suite.
- New date/due-state computation logic (the revisit-expiry overlay) has real
  edge cases (malformed date, exact-due-day boundary, undated park) worth a
  Confidence Calibration pass rather than a small-tier drive-by.

## Goal

The monorepo's `triage_cli.py list --json` contract broke its shape (PR #539,
`CONTRACT_VERSION = 2`): a bare list of open items became an envelope
`{contractVersion, open, deferred}`, because a parked (deferred) triage entry
needed to become visible on every surface — operator decision of 2026-07-27.
The WebUI's own TS mirror of that contract (`readAllItems()` parity with
Python `read_all_items()`, plus a CLI-parity-tested projection) is now stale:
it does not carry `revisitAt` / `revisitDue`, and nothing in the WebUI's own
Triage tab shows a parked entry at all — it silently vanishes the moment an
operator clicks Snooze. This iterate:

1. Ports the revisit-expiry overlay into the WebUI's `readAllItems()` so it
   stays byte-for-byte parity with the monorepo's `read_all_items()` (every
   item gains `revisitAt: string | null` + `revisitDue: boolean`; an expired
   park auto-resolves back to `status: "triage"`, exactly like upstream).
2. Adds a TS projection (`triage-contract.ts`) that builds the same
   `{contractVersion: 2, open, deferred}` envelope as `triage_cli.py list
   --json`, and regenerates the committed parity fixture
   (`triage-union-cli-list.json`) from the REAL monorepo CLI so the parity
   gate in `triage-contract.test.ts` proves agreement, not merely asserts it.
3. Surfaces deferred (parked) entries in the WebUI Triage tab, in their own
   section, each showing its revisit date (or "no revisit date set") and its
   computed due state.
4. Extends the WebUI's own Snooze action with an optional revisit-date field,
   so an operator parking an item FROM the WebUI can opt into the same
   auto-return behavior the monorepo CLI's `defer` command already offers.
   Leaving it blank keeps today's WebUI Snooze behavior byte-identical
   (`revisitAt: null` forever ⇒ "parked-not-due" forever) — this is also
   exactly the upstream-permitted "no date" case the triage card calls out.

## Acceptance Criteria

- [x] **AC1** Every item `readAllItems()` (and its delivered-origin composer)
      resolves carries `revisitAt: string | null` and `revisitDue: boolean`,
      matching the monorepo's `read_all_items()` field-for-field on the
      regenerated fixtures (`triage-resolved.json`, `triage-recovery-resolved.json`,
      `triage-union-resolved.json`) — parity gates in `triage-store*.test.ts`
      stay green against the REGENERATED fixtures (run via
      `uv run server/scripts/regen-triage-fixtures.py` against the monorepo's
      current `triage.py`).
- [x] **AC2** A `snoozed` item whose `revisitAt` day has arrived (UTC,
      `today >= revisitAt`) resolves with `status: "triage"` and
      `revisitDue: true`, identically to upstream `resolve_revisit` — proven by
      a dedicated unit test with an injectable clock (no reliance on wall-clock
      timing).
- [x] **AC3** A `snoozed` item with no `revisitAt` (today's WebUI Snooze
      behavior, and the upstream-permitted no-reason/no-date park) resolves
      `revisitAt: null`, `revisitDue: false` forever — "parked-not-due" — and
      is never auto-resolved back to open.
- [x] **AC4** `server/src/core/triage-contract.ts` exports `buildTriageListing`,
      producing `{contractVersion: 2, open: TriageItem[], deferred: TriageItem[]}`
      where `open` = resolved items with `status === "triage"`, `deferred` =
      resolved items with `status === "snoozed"`, both `pendingDelivery`-enriched,
      `deferred` ordered by the same total order as upstream `sort_deferred`
      (soonest dated first, then undated, then severity, then id).
- [x] **AC5** `triage-contract.test.ts` deep-equals `buildTriageListing`'s output
      against a REGENERATED `triage-union-cli-list.json`, produced by running the
      REAL `triage_cli.py list --json` (via `regen-triage-fixtures.py`, updated
      for the new envelope shape) over fixture input that includes at least one
      dated-not-due, one due-today, and one undated `snoozed` entry.
- [x] **AC6** The WebUI Triage tab renders a "Deferred" section per project,
      below the open-items list, listing every `status === "snoozed"` item with
      its revisit date (or "No revisit date set") and a computed state label
      ("Parked" / "Parked — not due"), sorted client-side to match AC4's order.
      Hidden entirely when a project has zero deferred items (mirrors the
      existing empty-state pattern).
- [x] **AC7** The Snooze action in `TriageDetailModal` gains an optional
      "Revisit date" input. Submitting with a date sends it as `revisitAt` on
      the snooze request; the server validates it (`YYYY-MM-DD`, real calendar
      date) and rejects a malformed value with `400 invalid_revisitAt` — never
      silently drops it. A date that is today or in the past is rejected with
      a distinct `400 revisitAt_not_future` (it would resolve back to open on
      the very next read, defeating the point of parking it). Leaving it
      blank behaves exactly as today (no `revisitAt` sent, item parks with no
      date).
- [x] **AC8** `POST /api/triage/:projectId/dismiss` rejects a `revisitAt` in
      the body with `400 revisitAt_not_permitted` (park semantics only apply to
      a `snoozed` flip, mirroring the monorepo's `mark_status` validation) —
      proven by a route test.
- [x] **AC9** `server/src/types/triage.ts` and `client/src/lib/triageApi.ts`
      declare the identical field set including the two new fields —
      `triage-schema-sync.test.ts` (existing, unmodified) stays green as the
      drift guard.
- [x] **AC10** No file already at or over its bloat-baseline ceiling grows past
      its recorded `current` value in `shipwright_bloat_baseline.json`:
      `routes/triage.ts` (715), `triage-store.ts` (305),
      `TriageDetailModal.tsx` (375), `TriageDetailModal.test.tsx` (432),
      `TriagePage.tsx` (283 — zero headroom), `triage.test.ts` (902),
      `triage-write.test.ts` (373), `triage.real-lock.test.ts` (308). Every
      new test lands in a new file; `TriagePage.tsx` nets DOWN via a
      `PerProjectSection` extraction before the Deferred-section mount lands.
- [x] **AC11** `GET /api/triage/counts` reflects an item whose park just
      auto-expired (it is genuinely open again) — documented, not treated as
      a regression, and covered by an explicit test so a future reader doesn't
      mistake it for drift.

## Spec Impact

- **Classification:** MODIFY
- **ADD:** none
- **MODIFY:** FR-01.30 (WebUI Triage tab) — gains a Deferred section and an
  optional revisit-date on Snooze; the resolved-item shape gains two fields.
- **REMOVE:** none
- **Affected FRs:** FR-01.30

## Plan review corrections (opus-plan-reviewer, 2026-08-05, approve-with-changes)

Four must-fix items came back from the pre-build plan review; all four are
incorporated into Technical Approach / ACs below rather than left as a
separate TODO:

1. **Bloat baseline audit was wrong** (case-sensitive grep missed the
   Title-Case entries). The FULL baselined set is: `routes/triage.ts` (715),
   `triage-store.ts` (305), `TriageDetailModal.tsx` (375),
   `TriageDetailModal.test.tsx` (432), `TriagePage.tsx` (283 — **is**
   baselined, cannot grow at all), `triage.test.ts` (902),
   `triage-write.test.ts` (373), `triage.real-lock.test.ts` (308). Every new
   test in this iterate lands in a **new** file; `TriagePage.tsx` gets a net
   LOC reduction (extract `PerProjectSection` into its own component file)
   before the few lines needed to mount the Deferred section go back in.
2. **Overlay/cache ordering redesigned.** `resolveUnion` stays exactly as
   today — pure, no `now` parameter, unchanged signature, unchanged callers.
   The revisit-expiry overlay (`applyDeferOverlay(items, now)`, in
   `triage-defer.ts`) is applied ONCE, at the point each of `readAllItems`'s
   and `readAllItemsWithDeliveredOrigin`'s cache-fill computes its result
   (mirrors Python's `read_all_items`, which also applies it exactly once,
   never re-applied to an already-overlaid view). This keeps the existing
   "cache returns the same array reference within TTL" test intact (the
   overlay is baked into the cached value, not recomputed per call) and
   avoids the non-idempotency trap of re-running the overlay on
   already-flipped items. Tests that need to pin an exact `now` (the due-today
   boundary, AC2/AC3) call `applyDeferOverlay` directly — a pure function,
   no file I/O, no cache — never through `readAllItems`.
3. **Fixture dates are permanently stable, not calendar-relative.** The
   committed CLI-parity fixture inputs use a far-past date (permanently due)
   and a far-future date (permanently not due), never "today" — because
   `triage_cli.py list --json` reads the real wall clock with no `--now`
   override, so a "due today" case baked into a committed fixture would only
   be correct on the day it was regenerated and go red on every subsequent
   CI run. The exact-boundary case (`today >= revisitAt`) is covered ONLY by
   the injected-clock unit test in `triage-defer.test.ts`.
4. **`triage-enrich.test.ts`'s existing CLI-parity assertion (`expect(open).
   toEqual(expected.items)`) breaks** the moment the fixture becomes an
   envelope — that block moves to the new `triage-contract.test.ts` and reads
   `expected.open` / `expected.deferred`, not `expected.items`.

Also corrected: **the Deferred section is read-only in this iterate** (view
only — no Promote/Dismiss/Snooze). The spec's earlier out-of-scope note
claimed an operator "can still Dismiss" a parked item; that is false as of
today's code — `statusFlipRoute` 409s on `status !== "triage"` and
`TriageDetailModal.tsx` hides the entire action row outside that same
condition. Interactive actions on an already-deferred item are out of scope
(see Out of Scope), not a false parenthetical.

**Two more requirements added directly from the review, folded into AC7/AC8
below rather than restated here:** reject a non-future `revisitAt` (today or
past) with a distinct `400 revisitAt_not_future` — a same-day park would
immediately re-resolve to open on the very next read, which is confusing UX,
not a use case the date field exists to serve; and `GET /api/triage/counts`
will now include an item whose park just expired, which is correct
(an auto-reopened item is genuinely open again) and is called out explicitly
so it isn't mistaken for a bug during review.

**Explicitly NOT fixed, and explicitly out of scope** (see below): a
pre-existing, unrelated divergence the review surfaced — `resolveUnion`'s
Pass 2 overlays `ts`/`statusBy`/`statusReason`/`promotedTaskId` even when a
status event's `newStatus` fails the `STATUSES` validity check, where
Python's `read_all_items` skips the entire event (`continue`) on the same
condition. This iterate's `revisitAt` overlay is naturally insulated from it
(it only fires on the literal string `"snoozed"`, itself always a valid
status), so nothing here depends on fixing it, and fixing it has its own
unrelated blast radius. Filed as a follow-up triage card instead of fixed
inline or silently left for someone else to rediscover.

## Technical Approach

**New server modules** (keeps the two already-grandfathered bloat files —
`triage-store.ts` at 305, `routes/triage.ts` at 715 — from ratcheting):

- `core/triage-defer.ts` — TS port of `shared/scripts/lib/triage_defer.py`'s
  pure functions: `parseRevisitDate`, `isDue`, `applyRevisitExpiry`,
  `sortDeferred`, `utcToday(now?)`. Injectable clock throughout — no bare
  `new Date()` inside resolution logic, so tests never race the wall clock.
- `core/triage-contract.ts` — TS port of `shared/scripts/lib/triage_contract.py`:
  `CONTRACT_VERSION = 2`, `buildTriageListing(...)`.
- `core/triage-validation.ts` — extraction of the existing inline body
  validators (`parsePromoteBody`, `parseDismissSnoozeBody`, their interfaces
  and shared helpers) out of `routes/triage.ts`, netting that file DOWN before
  the `revisitAt` plumbing goes back in, so it never approaches its 715-line
  ratchet ceiling.

**`triage-store.ts`** — Pass 1 sets `revisitAt: null` defensively on every
appended base record (mirrors Python's tolerant-reader guard against a
hand-edited append acquiring park semantics); Pass 2 carries `revisitAt` from
a `snoozed` status event's raw payload (or `null` on any other status).
`resolveUnion` itself is UNCHANGED otherwise — no `now` parameter, still pure,
still the same two callers. `readAllItems`'s cache-fill step (and
`readAllItemsWithDeliveredOrigin`, which is not cached) each apply
`applyDeferOverlay(resolveUnion(...), new Date())` exactly once when
computing their result — mirroring where Python's `read_all_items` applies
`_defer.apply_revisit_expiry` (once, at the end, never re-applied). Also
extracts `parseRawLines` / `readRawLines` / `readLocalRawLinesSplit` into a
new `core/triage-raw.ts` (re-imported back where still needed) — a genuine
raw-JSONL-reading module boundary that also nets `triage-store.ts` down
before the Pass-1/Pass-2 additions land, keeping it at or under its 305-line
ratchet ceiling.

**`triage-write.ts`** — `AppendStatusEventArgs` gains an optional `revisitAt`;
`appendStatusEvent` includes the key on the emitted line only when the caller
supplied one (never emits `revisitAt: null` on a plain dismiss/promote —
matches the monorepo wire shape, where the field is simply absent).

**Client** — new `components/triage/DeferredTriageSection.tsx` (rendering) and
`lib/sortDeferred.ts` (the AC4/AC6 ordering, small and independently testable)
carry the new UI. `TriagePage.tsx` is baselined at exactly 283 (zero headroom),
so `PerProjectSection` (currently defined inline, ~115 lines) is extracted into
`components/triage/PerProjectTriageSection.tsx` first — a net reduction —
before the few lines that mount `<DeferredTriageSection>` go back in. A new
`components/triage/SnoozeRevisitField.tsx` (a single labeled date input) keeps
`TriageDetailModal.tsx` at its 375-line ceiling.

**Live GET /api/triage/:projectId wire shape is UNCHANGED** (`{items, origin}`,
all statuses, unfiltered) — additive fields only. The `{contractVersion, open,
deferred}` envelope is the monorepo CLI-parity artifact
(`triage-contract.ts` + its test), not a new shape for the WebUI's own HTTP
API. The WebUI's Deferred section is built client-side by filtering the
existing response, using the same items the server already sends. This keeps
every other consumer of that route (sidebar counts, campaign correlation, the
staleness banner) byte-compatible — no second endpoint, no versioned
Accept-header negotiation, nothing to migrate.

## Out of Scope

- **Changing the live `GET /api/triage/:projectId` response into the
  `{contractVersion, open, deferred}` shape.** See Technical Approach — that
  envelope is the monorepo CLI-parity artifact, not this repo's own versioned
  HTTP contract. Both client and server here deploy together; there is no
  cross-repo consumer of this endpoint to version against.
- **Any action on an already-deferred item — "unpark", re-Snooze with a new
  date, Dismiss, or Promote.** The Deferred section this iterate ships is
  READ-ONLY (revisit date + computed state only). Today's route already 409s
  any status flip once an item has left `status: "triage"`
  (`triage_item_not_in_triage_state`), and `TriageDetailModal` already hides
  its entire action row outside that same condition — so this is a scope
  boundary, not a workaround for an existing capability. The monorepo CLI
  added `unpark` in the same PR; the triage card does not ask the WebUI to
  grow a matching affordance, and doing so is a materially separate feature.
- **Editing the revisit date on an already-deferred item.** Same boundary as
  above — the card's "still offer the date field" is about the Snooze action
  (open → deferred), not a re-park/edit flow for an item already parked.
- **Fixing `resolveUnion`'s pre-existing unknown-`newStatus` divergence from
  Python** (surfaced by plan review; see "Plan review corrections" above).
  Real, but unrelated to this iterate's ACs and with its own blast radius —
  filed as a follow-up triage card instead.
- **Regenerating `triage-recovery-resolved.json`'s deliberately-corrupted
  input** to add a snoozed/malformed-revisitAt case. That fixture's whole
  purpose is record-boundary recovery parity (a different concern); AC1 still
  requires regenerating its OUTPUT because `revisitAt`/`revisitDue` now appear
  on every item, but the INPUT stays untouched.

## Confidence Calibration

- **Boundaries touched:** none classified `touches_io_boundary` (the
  `.shipwright/triage.jsonl` read/write path is an existing, already-covered
  boundary; this iterate adds fields to an established wire format rather than
  a new boundary). `touches_public_api` per the escalation rationale above.
- **Empirical probes run:**
  - Confirmed via `git show origin/main:shared/scripts/lib/triage_contract.py`
    (monorepo) that `CONTRACT_VERSION = 2` and `build_listing` is the real,
    currently-shipping shape — not read from documentation.
  - Confirmed via the monorepo's `.shipwright/agent_docs/iterates/
    test-results-worktree-evidence-recovery-manifest.json` that P2.03 =
    `iterate-2026-08-01-triage-defer-lifecycle`, delivered via PR #539, with a
    durable F5c summary reachable from `origin/main`.
  - Traced the WebUI's actual GET route (`routes/triage.ts`) to confirm it
    returns ALL statuses unfiltered today (not open-only), which is what makes
    the client-side-partition design in Technical Approach viable without a
    server wire-shape change.
- **Test Completeness Ledger:**

| # | Behavior | Disposition | Evidence |
|---|---|---|---|
| 1 | Every resolved item gains `revisitAt`/`revisitDue`, matching upstream `read_all_items` field-for-field | tested | `triage-defer.test.ts` (18 cases) + `triage-store.test.ts`/`.union.test.ts`/`.recovery.test.ts` parity gates vs regenerated fixtures |
| 2 | A due park (revisitAt in the past) auto-resolves to `status:"triage"`, `revisitDue:true` | tested | `triage-defer.test.ts` "resolves a due park back...", exact-boundary injected-clock case; `triage.revisit.test.ts` AC11 route-level |
| 3 | An undated park (parked-without-date) stays snoozed forever, `revisitDue` always false | tested | `triage-defer.test.ts` "undated park stays snoozed forever"; CLI-parity fixture's `trg-park-undated` case |
| 4 | `buildTriageListing` splits open (status:triage) from deferred (status:snoozed) | tested | `triage-contract.test.ts` "splits open... deferred..." |
| 5 | `buildTriageListing` matches the REAL `triage_cli.py list --json` envelope byte-for-byte | tested | `triage-contract.test.ts` CLI PARITY GATE, fixture regenerated via `regen-triage-fixtures.py` against the monorepo's actual `triage_cli.py` (verified content-identical to `origin/main` modulo CRLF) |
| 6 | Deferred section renders per-item revisit date / "No revisit date set" + state label, hidden when empty | tested | `DeferredTriageSection.test.tsx` (6 cases) |
| 7 | Deferred entries sort soonest-dated-first, then undated, then severity, then id | tested | `sortDeferred.test.ts` (client, 6 cases) + `triage-defer.test.ts` (server, 4 cases) |
| 8 | Snooze accepts a valid future `revisitAt` and persists it | tested | `triage.revisit.test.ts` AC7 |
| 9 | Snooze rejects a malformed `revisitAt` (`400 invalid_revisitAt`) | tested | `triage.revisit.test.ts` AC7 (garbage string + Feb-30) |
| 10 | Snooze rejects a non-future `revisitAt` (`400 revisitAt_not_future`) | tested | `triage.revisit.test.ts` AC7 |
| 11 | Snooze with no `revisitAt` behaves exactly as before (backward compat) | tested | `triage.revisit.test.ts` AC7 "leaving revisitAt out..." |
| 12 | Dismiss rejects any `revisitAt` (`400 revisitAt_not_permitted`), item left untouched | tested | `triage.revisit.test.ts` AC8 |
| 13 | `GET /api/triage/counts` includes an item whose park just auto-expired | tested | `triage.revisit.test.ts` AC11 |
| 14 | `appendStatusEvent` omits the `revisitAt` key when absent, includes it verbatim when supplied | tested | `triage-write.revisit.test.ts` (wire-byte assertions) |
| 15 | Server/client `TriageItem` field sets stay identical after the two new fields | tested | `triage-schema-sync.test.ts` (pre-existing, unmodified, re-run green) |
| 16 | `SnoozeRevisitField` renders value / calls onChange / respects disabled | tested | `SnoozeRevisitField.test.tsx` (3 cases) |
| 17 | No touched file exceeds its recorded bloat-baseline ceiling | tested | measured directly against `shipwright_bloat_baseline.json` for all 8 entries during Build; re-verified mechanically by the pre-commit anti-ratchet hook at F6 |

Counts: testable 17, tested 17, untestable 0, untested_testable 0. Enumeration basis: 11 ACs, expanded to 17 granular behaviors (several ACs cover more than one distinguishable behavior — e.g. AC7 covers 4 validation branches).
- **Confidence-pattern check:** asymptote — the parity gate is regenerated from
  the REAL monorepo CLI subprocess, not hand-authored, so agreement is proven
  against the actual producer, not a re-implementation of my own
  understanding of it. Breadth — dated-not-due, due-today (boundary), and
  undated parks are each covered by a distinct test case, not just the happy
  path.

## References

- Triage card: `.shipwright/triage.jsonl` id `trg-f2214310`
- Monorepo: `shared/scripts/lib/triage_contract.py`, `triage_defer.py`,
  `shared/scripts/tools/triage_cli.py`, `shared/scripts/triage.py::read_all_items`
- Monorepo delivery record: PR #539 (`iterate-2026-08-01-triage-defer-lifecycle`)
