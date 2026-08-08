# Iterate Spec: triage-filters-sort-parked

- **Run ID:** iterate-2026-08-08-triage-filters-sort-parked
- **Type:** feature
- **Complexity:** medium
- **Status:** implemented

## Goal
The Triage tab is a flat, source-grouped list that no longer scales (~28
open items in the monorepo, ~8 here) and has no way to hide what the
operator has decided not to do now. This iterate adds view-only filters
(Priority / Domain / Complexity), a two-level sort (Domain / Name /
Modified, each independently ascending or descending), removes the
per-item-source group heading entirely (domain stays visible per-card,
unchanged), and gives the parked/deferred lifecycle (monorepo P2.03) its
own filter with the two named exceptions the operator specified: a due
park must survive every active filter, and a dateless park must survive
the Parked filter's default-hidden state.

## Acceptance Criteria
- [x] AC1 (agent+user): Given the operator excludes "P3" from the Priority
  filter, when the open-items list renders, then no item with
  `suggestedPriority === "P3"` appears in it, except an item that is a
  named exception (AC8).
- [x] AC2 (agent+user): Given the operator narrows the Domain filter to a
  single domain, when the open-items list renders, then only items whose
  `suggestedDomain` matches appear, except a named exception (AC8).
- [x] AC3 (agent): Given no `TriageItem` in this codebase carries a
  complexity field yet (confirmed by Repo Scout — `suggestedComplexity`
  does not exist on the server or client type), when the Complexity
  filter renders, then it offers exactly the values `small` / `medium` /
  `large` / `Unset` — visible and clickable, never hidden or disabled
  pending real data, per the operator's explicit 2026-08-07 decision —
  every currently-loaded item classifies as `Unset`, and deselecting
  `Unset` hides every item currently on screen except a named exception
  (AC8) (there is nothing else for it to match yet — this is the
  "correct but mostly-empty" state the operator asked for).
- [x] AC4 (agent+user): Given the operator sets primary sort = Name
  ascending and secondary sort = Modified descending, when the open-items
  list renders, then items are ordered by `title` (`localeCompare` with
  pinned options — `{sensitivity:"base", numeric:true}` — so ordering
  does not vary by runtime ICU locale), ascending, with `ts` (descending)
  breaking ties, a trailing `id`-ascending comparator breaking any
  remaining tie (mirrors the existing `sortDeferred` total-order pattern
  in `server/src/core/triage-defer.ts`, so "the first N" never depends on
  fetch/insertion order), and reversing either direction reverses that
  axis independently of the other. Picking the same key for both levels
  is allowed (the second level is then a no-op, harmless) — not guarded.
- [x] AC5 (agent+user): Given the active filters exclude at least one item
  that would otherwise be visible, when a section renders, then a "N
  hidden by filter" line is visible with `N` equal to the excluded count
  — never silently absent, and never conflated with "nothing is open."
  This holds even when EVERY item in a project is filtered out: the
  section still renders (gated on the project's unfiltered item count,
  not the filtered count) showing the project heading + the hidden-count
  line, never a bare `null`. If every project's items are entirely
  filtered out, the page shows an explicit "N hidden by the active
  filters — clear filters to see them" state, distinct from the
  genuine-zero-items empty state ("No triage items pending. ✓"), which
  stays keyed off the unfiltered server counts and must never fire when
  items exist but are filtered.
- [x] AC6 (agent+user): Given the open-items list renders, then there is
  no heading derived from `source` / producing run — items render as one
  continuous, sorted list (no source sub-grouping), and each card still
  shows its domain via the existing `suggestedPriority` / `suggestedDomain`
  inline text (unchanged from today; `SourceBadge` also stays on the
  card, so the source is not lost, only demoted from a heading).
- [x] AC7 (agent+user): Given the Parked filter is in its default (off)
  state and a project has one or more `snoozed` items hidden by that
  default (dated, not yet due) — regardless of whether any OTHER parked
  item in that project is visible via the AC9 exception — when the
  Triage tab renders, then those items do not appear, but a hint line
  naming the total hidden-parked count appears (summing both
  Parked-default suppression and Priority/Domain/Complexity suppression
  within the Deferred section into one number — the hint reads "N parked
  items hidden by the current view", not filter-cause-specific wording)
  so their existence is never silently lost. This hint renders whenever
  the hidden count is greater than zero, independent of how many parked
  items ARE visible (a project with 1 dateless-visible + 3 dated-hidden
  parks must still show the hint for the 3). **The hint is intentionally
  NOT gated on the Parked toggle's own state** — external plan review
  (deepseek, 2026-08-08) read the cause-agnostic wording as a bug and
  proposed restricting the hint to "Parked filter off only"; that would
  silently drop the case where Parked is ON but Priority/Domain/
  Complexity still hides some parked items, which is exactly the
  failure this AC exists to prevent. Rejected; recorded in the ADR.
- [x] AC8 (agent+user): Given an item's park has just come due
  (`revisitDue === true`, computed upstream — the client never
  recomputes the date), when the open-items list renders, then the item
  appears regardless of the active Priority / Domain / Complexity
  filters, is visually marked ("Returned") so the operator can tell it
  returned from a park rather than assume it always matched, and is
  **excluded from the "N hidden by filter" count** (it was not hidden —
  it bypassed the filter, and counting it as hidden while also rendering
  it would misinform the operator). **The bypass has no time limit** —
  `revisitDue` is recomputed `true` on every read for as long as the item
  stays `status: "snoozed"` server-side (nothing auto-clears it), so a
  returned park stays un-filterable until the operator acts on it
  (Promote / Dismiss / re-Snooze). This is intentional, not a decay bug:
  the requirement is that a returned park "stops being background" and
  "cannot be scrolled past" — an expiring bypass would silently
  reintroduce exactly the drop-on-the-floor failure parking exists to
  prevent. Documented here so a future change does not "fix" it into a
  time-boxed bypass by accident.
- [x] AC9 (agent+user): Given a `snoozed` item has no revisit date
  (`revisitAt === null`) and the Parked filter is in its default (off)
  state, when the Triage tab renders, then that item still appears in the
  Deferred section (bypassing the Parked-off default specifically — it
  still respects the Priority / Domain / Complexity filters like any
  other item, and if excluded by one of those it counts toward AC7's
  hidden count like any other parked item).
- [x] AC10 (agent): Given two items whose `originalTs` (append time) and
  `ts` (server-resolved latest-status-event time, or append time if
  never re-statused) differ, when sorting by Modified, then ordering
  follows `ts` — never `originalTs`.

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.30 (Triage Tab + Promote bridge) — adds filter/sort/
  parked-filter acceptance criteria; no new FR (this is a FOLD — polish
  of an existing capability, not a new one — per the MINT-vs-FOLD gate).
- **REMOVE:** none
- **NONE justification:** n/a (classification is not solely `none`)

## Out of Scope
- No change to what `.shipwright/triage.jsonl` / the outbox records, to
  the server-side `TriageItem` contract (`server/src/types/triage.ts`),
  or to the Python producer side (operator constraint, verbatim).
- No new server-visible complexity field — see Design Notes for how AC3
  stays forward-compatible without one.
- Filter/sort selections do not persist across page reloads or
  navigation (in-memory view state only) — not requested; noted as
  possible future work, not built here.
- Severity is not a sort key (the operator specified exactly Domain /
  Name / Modified) — the existing severity badge stays visible on cards
  but no longer drives default ordering.
- The Deferred section stays read-only (no Promote/Dismiss/Snooze there)
  — unchanged from `iterate-2026-08-05-triage-deferred-envelope`.
- Ride-along `.shipwright/.cache/*.claim` accumulation: investigated,
  root cause lives entirely in the shared `shipwright` monorepo (not
  vendored here) — filed as a separate card there, not built in this
  iterate. See Design Notes.

## Design Notes
**Flat list, not domain-grouped sections (operator decision, 2026-08-08
interview).** The pre-spec interview asked whether Domain should stay a
permanent section-heading axis (sort only reorders within/between
sections) or whether the list should flatten entirely with domain shown
per-card instead. The operator chose the flat list — every card already
renders `→ {suggestedPriority} / {suggestedDomain}` today
(`TriageItemCard.tsx`), so no new UI is needed to keep domain visible;
only the grouping/heading mechanism is removed.

**Complexity filter forward-compatibility (no contract change).**
`suggestedComplexity` does not exist on `TriageItem` today, client or
server, and the schema-sync drift guard
(`server/src/types/triage-schema-sync.test.ts`) fails the build if the
client interface declares a field the server interface doesn't. Adding
it to either `TriageItem` interface is therefore both a contract change
(out of scope) and a guard-breaker. The client instead reads it through
a **locally-scoped, widened type** in the new filter/sort module —
`TriageItem & { suggestedComplexity?: TriageComplexityHint }` — which
touches neither `interface TriageItem` block the sync test parses.
Verified during internal plan review (not merely asserted): the
intersection type compiles under this repo's `client/tsconfig.json`
(`exactOptionalPropertyTypes` is not set), the sync guard parses only
the `interface TriageItem` brace block so a type alias elsewhere is
invisible to it, and the forward-compat claim holds at the wire level —
`resolveUnion` (`server/src/core/triage-store.ts:125-129`) copies every
key off the raw `append` event verbatim (minus `event`) before the
client ever sees it, so an unrecognized producer field genuinely
survives the round trip **except** the handful of fields `resolveUnion`
deliberately overwrites itself (e.g. `revisitAt` is force-set, line 135
— not a blind passthrough). Today every item resolves to `"Unset"` (the
field is absent from every wire payload); if a future Leadwright
producer starts emitting `suggestedComplexity` under that exact name,
the filter picks it up with no further client change — a future
producer-side addition still needs `regen-triage-fixtures.py` re-run for
the parity fixtures, which is expected, not a gap. If a different field
name ships, a small follow-up is still needed — this is a best-effort
forward-compat measure, not a guarantee spanning an unpublished
contract. A unit test asserts an unrecognized wire key survives
`resolveUnion` unchanged, so the shim's premise stays test-covered, not
just commented. Test fixtures for the shim are typed as the widened
alias, not as bare `TriageItem` — object literals typed as `TriageItem`
directly would trip excess-property checking on the extra field.

**The Complexity filter stays visible today, deliberately.** Internal
plan review raised — reasonably, given the domain has exactly one
reachable value right now — whether the control should stay hidden
until a real value appears. **Rejected**: the operator's 2026-08-07
decision is explicit and direct — "treat 'unset' as an explicit, visible
value rather than hiding the control" — precisely so the filter is
already in place, and already exercised, the day a producer starts
setting it. Hiding it would satisfy today's UX cleanliness at the cost
of the operator's actual stated intent.

**Two named exceptions to "Parked defaults to hidden" (operator design
note) — and how they interact, corrected during internal plan review.**
AC8 and AC9 exist because hiding parked items by default (AC7) would
otherwise silently drop the two cases parking must never drop. The first
plan draft handled each in isolation and broke at their intersection —
folded in now:
- AC8 (due): the upstream `applyDeferOverlay` already flips a due
  park's `status` back to `"triage"` before the client ever sees it, so
  the item is mechanically already in the open list — but it can still
  be filtered OUT by Priority/Domain/Complexity like a coincidence, so
  the open-list selector has an explicit
  `item.revisitDue || matchesFilters(item)` bypass, not an emergent one,
  and **excludes bypassed items from its own hidden-count** (they were
  shown, not hidden — see AC8's "excluded from the count" clause). The
  bypass is unconditional and does not expire (AC8).
- AC9 (dateless): a `snoozed` item with `revisitAt === null` never
  becomes due (there is no date to arrive), so without a standing
  exception it would be hidden by the Parked-off default forever. The
  Deferred-section selector has an explicit
  `(showParked || item.revisitAt === null) && matchesFilters(item)`
  bypass — dateless items still respect the attribute filters.
- **The visibility gate for a whole section must key off the
  UNFILTERED item count, never the filtered/visible count.** The first
  plan draft's `if (openItems.length === 0 && deferredItems.length ===
  0) return null` (`PerProjectTriageSection.tsx:84-86` today) would,
  once `openItems`/`deferredItems` become the FILTERED arrays, make a
  project whose items are all filtered out render nothing at all — no
  heading, no hidden-count line — which is exactly the failure AC5/AC7
  forbid. The gate now checks the project's raw (pre-filter) item
  counts; visible-vs-hidden is decided separately, inside a section that
  always renders when raw items exist. The same correction applies at
  page scope: `TriagePage.tsx`'s empty-state gate
  (`totalTriage === 0 && totalDeferred === 0`, sourced from the
  unfiltered `/api/triage/counts` endpoint) must stay keyed off those
  server counts, never off what's currently visible — otherwise
  "everything is filtered out" would render the same "No triage items
  pending. ✓" copy as "nothing is open," which is precisely the
  false-negative this board has already been burned by once (stale
  checkout making closed cards look open). A fully-filtered page instead
  shows its own explicit hidden-by-filters state.
- **Count semantics — one convention, stated once.** Any heading whose
  visible count can differ from its underlying total renders
  `Visible (of Total)` (e.g. `Deferred (1 of 4)`) rather than a bare
  number, so the three counts that can appear on one screen (page-level
  server-sourced total, per-project visible-open, Deferred visible) are
  never mistaken for the same denominator.

Both bypasses are named constants/comments at the call site (per the
operator's instruction to make them explicit in code, not emergent) and
each has a dedicated unit test plus an E2E assertion, including the
interaction cases: every item in a project filtered out (section still
renders with the hidden-count line); a mixed Deferred set (dateless
visible + dated hidden, hint still renders); a due-parked item under an
excluding filter (present, marked, NOT counted as hidden); sort
stability under input permutation.

**Ride-along investigated, not built.** `.shipwright/.cache/stop-triage-
inbox-*.claim` files accumulate because `aggregate_triage_on_stop.py`
(shared monorepo, `shared/scripts/hooks/`) only unlinks its claim file on
the **failure** path (`finally` block, `ok is False`); the success path
— the overwhelming majority — never cleans up, and the generic
`claim_once()` primitive it calls (`shared/scripts/lib/event_once.py`)
has no TTL sweep either. Neither file exists in `shipwright-webui` (no
vendored copy) — the fix belongs in the shared monorepo. Per the
operator's instruction, this card stays a note; a separate card will be
filed against `shipwright` (`shared/scripts/lib/event_once.py` and/or
`shared/scripts/hooks/aggregate_triage_on_stop.py`).

## Design Check (Tier 2 — medium + UI)
`.shipwright/designs/visual-guidelines.md` read; no
`chrome-definition.md` exists in this repo (degraded — noted in
`shipwright_test_results.json.degraded[]` at F0). Tokens reused, no new
ones introduced: `--muted` (the two bare-on-photo hidden-count lines —
`PerProjectTriageSection.tsx`'s and `DeferredTriageSection.tsx`'s —
matching the flipping token the existing on-photo headings already use,
per `on-photo-legibility.test.ts`; NOT the legacy `--color-muted` alias,
which is computed once at `:root` and does not flip white on-photo —
`--color-muted` stays correct only for the pre-existing in-card spans
that sit on an opaque surface), `bg-info-tint`/`text-info`/`--info-line`
(the new "Returned" badge — same trio `DeferredTriageSection.tsx`
already uses for its "Parked" state chip, so a returned-from-park item
reads as visually related to parking, not a new color language),
`bg-inset`/`--color-border` (filter chips, matching `SourceBadge`'s
resting/unselected style; a selected chip inverts to
`--color-primary`-on-tint, matching the existing selected-state pattern
used elsewhere in the app's chip family — no bespoke selected style).

```
TriagePage
├── PageHead ("Triage")
├── TriageFilterSortBar                         (new)
│   ├── TriageFilterGroup: Priority              (P0–P3 chips)
│   ├── TriageFilterGroup: Domain                (chips, dynamic options)
│   ├── TriageFilterGroup: Complexity             (small/medium/large/Unset chips)
│   ├── TriageFilterGroup: Parked                (single toggle chip, default off)
│   ├── TriageSortLevel: Primary                  (key dropdown + asc/desc icon-button)
│   └── TriageSortLevel: Secondary                (key dropdown + asc/desc icon-button)
├── [all-filtered-out state]                      (text line, only when every project's
│                                                   items are filtered to zero)
└── PerProjectTriageSection[]
    ├── h2: project name (color dot + name, unchanged) + "(visible of total)"
    ├── [stale-checkout banner]                    (unchanged)
    ├── ["N hidden by filter" line]                 (new — rides bare on the
    │                                                deck-golden photo like the
    │                                                h2 above it, so it uses the
    │                                                flipping `--muted` token,
    │                                                NOT the legacy --color-muted
    │                                                alias — on-photo-legibility)
    ├── TriageItemCard[]                            (flat, no source heading;
    │                                                 "Returned" badge added when
    │                                                 item.revisitDue — info-tint,
    │                                                 sits beside SeverityBadge)
    └── DeferredTriageSection
        ├── h3: "Deferred (visible of total)"        (unchanged shape, new count form)
        ├── [deferred item buttons]                   (unchanged markup; the
        │                                                id/revisit-date spans
        │                                                inside them correctly
        │                                                keep --color-muted —
        │                                                they sit on the opaque
        │                                                card surface, not bare)
        └── ["N parked items hidden by the current view"] (new — bare on the
                                                            photo like the h3
                                                            above it, so also
                                                            --muted, not
                                                            --color-muted —
                                                            same rule as the
                                                            line above)
```

No new screen, no new route, no new modal. `TriageFilterSortBar` sits
between `PageHead` and the project list, inside the existing
`.page-container density-surface` wrapper (unchanged layout shell) —
matches the placement of comparable list-level controls elsewhere in
the app (e.g. `DensityToggle` in `PageHead`'s `actions` slot for board
density). Filter chips reuse the existing chip visual language rather
than introducing checkboxes/dropdowns, since every other "pick which
values" control in this app (severity, phase, status) is already a chip
— sort levels are the one new control shape (key dropdown + direction
toggle), since nothing existing in this app does two-level sort.

## Affected Boundaries
n/a — no serialized-format producer/consumer pair is added or changed.
The client reads existing wire fields (`suggestedPriority`,
`suggestedDomain`, `ts`, `revisitAt`, `revisitDue`) plus one
defensively-optional field (`suggestedComplexity`) that is not yet
produced by anything. `touches_io_boundary` does not fire (confirmed at
Repo Scout: no `.env*`/`hooks.json`/`*_config.json`/`*_state.json` touched,
no `parse_env`/`json.dump(s)?`/`yaml.*` producer/consumer keyword hit).

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-08-triage-filters-sort-parked/architecture_brief.md`
- **Verdicts:** deepseek=revise · openai=revise
- **Smallest thing that would do (per reviewers):** openai — everything
  except the Complexity filter (build it only once complexity is a real,
  contract-backed field). deepseek — everything except the Parked
  toggle (keep the Deferred section always visible, no hide-by-default,
  let sort push it down instead).
- **Findings:**
  - openai (medium, proportionality): a Complexity filter whose only
    reachable value is `Unset` is a permanent control + local schema
    escape hatch that buys no present capability and precommits a
    future producer to an uncontracted field name. — **Rejected, not
    fixed.** This is the same proposal (in a stronger form — omit
    entirely rather than disable) that internal Opus plan review raised
    and that was already rejected in Design Notes: the operator's
    2026-08-07 decision is direct and explicit ("treat 'unset' as an
    explicit, visible value rather than hiding the control") and names
    the reason (a planned future Leadwright producer). The reviewer
    wasn't wrong about the trade-off in the abstract — it correctly
    identifies the field-name precommitment risk — but the operator
    made this call with information the review process doesn't have.
  - deepseek (high, simpler-alternative): drop the Parked toggle
    entirely; keep the Deferred section always visible (no
    hide-by-default), since it's already separate and read-only, and
    let sort push parked items down instead. — **Rejected, not fixed.**
    This directly contradicts the operator's explicit requirement:
    "the default view should hide parked items - that is the entire
    point of parking them." Always-visible-Deferred is precisely the
    status quo the operator asked to change.
- **Reconciliation:** Both `revise` verdicts converge on the same shape
  of finding — "the smallest thing is smaller than what was planned" —
  applied to the two parts of the spec that came from the operator's own
  direct, dated decisions rather than from engineering judgment calls.
  Neither is a `reject` (which would mandate stopping to ask), and both
  are resolved the same way: the operator's explicit instruction stands.
  **Process note, not a plan defect:** the architecture brief (per its
  template's own rule) deliberately excludes rejection-rationale for
  alternatives an author considered — correctly. But it also omitted the
  operator's own hard product requirements ("parked hidden by default is
  the entire point," "Complexity must stay visible, not hidden") as
  **non-negotiable constraints**, which the template's "Constraints that
  are not negotiable" section exists for. Framed as constraints instead
  of left implicit, both reviewers would very likely have reasoned
  differently. Noted here so the next iterate's brief authoring includes
  operator-mandated requirements in that section, not just engineering
  ones.

## Confidence Calibration
- **Boundaries touched:** none (see Affected Boundaries) — no round-trip
  probe applies; the calibration below is asymptote/coverage-only,
  driven by the review cascade rather than a producer→file→consumer
  probe series.
- **Empirical probes run** (each a "what would this miss?" question,
  answered by spawning a fresh-context reviewer or writing a targeted
  test, never by self-attestation — see `confidence-anti-patterns.md`):
  1. *"Does the allFilteredOut banner's Clear-filters button actually
     reveal what it counts as hidden?"* — round-2 code-reviewer traced
     it by hand and found NEW-1 (medium): Parked-default-hidden deferred
     items were counted toward "hidden by the active filters" even
     though `clearFilters()` cannot reveal them (`showParked` stays
     `false` in `DEFAULT_FILTER_STATE`). **Finding — fixed**: the
     aggregate now re-selects deferred items with `showParked` forced
     `true` so only attribute-filter-caused hiding counts; a regression
     test pins the exact reachable state (zero open items, only a
     dated-not-due park) and asserts the banner stays absent.
  2. *"Is the locale actually pinned, or only the comparison options?"*
     — external code-review cascade (deepseek/openrouter) caught that
     `LOCALE_COMPARE_OPTIONS` pinned `sensitivity`/`numeric` but the
     `localeCompare` calls still passed `undefined` for the locale
     argument itself, leaving AC4's "never varies by runtime ICU
     locale" promise half-kept. **Finding — fixed**: both calls now pass
     `"und"` (BCP 47 root/undetermined locale) explicitly; a spy-based
     test asserts every `localeCompare` invocation during a sort
     receives `"und"` as its second argument, not `undefined`.
  3. *"Does the bar actually wire the per-level aria-labels through, or
     only the leaf component in isolation?"* — round-2 code-reviewer
     found the `TriageSortLevel` unit test proved composition worked but
     nothing exercised `TriageFilterSortBar`'s own wiring. **Finding —
     fixed**: added a bar-level test asserting the rendered `aria-label`
     values, not just the leaf component's.
  4. *"Would the all-filtered-out test's denominator invariant
     (`openItems.length + deferredItems.length`, never
     `allItems.length`) survive a regression, or does every fixture item
     happen to make the two equal?"* — round-2 code-reviewer traced the
     fixture and found every item was `status: "triage"`, making the
     wrong denominator invisible. **Finding — fixed**: fixture now
     includes a `dismissed` item so a regression to `allItems.length`
     would make the assertions red.
  5. *Asymptote check* — after fixing probe 2 (the last probe to find
     anything), a follow-up spy-based test targeting that exact
     dimension (every `localeCompare` call across a full two-level sort)
     found nothing further, and a third code-reviewer pass over the
     full accumulated fix set found only one narrow, already-accepted,
     non-blocking residual (see below) and explicitly reported the
     finding chain as converged. Exhausted per the asymptote heuristic:
     the marginal probe returned no new finding.
- **Test Completeness Ledger** — every testable behavior this diff
  introduces or changes, `tested` (evidence) or `untestable` (closed
  reason code); 0 testable-but-untested:

  | Behavior | Status | Evidence |
  |---|---|---|
  | Exclude-set filter semantics (Priority/Domain/Complexity: chip starts active, click excludes) | tested | `triageFilterSort.test.ts`, `TriageFilterSortBar.test.tsx` AC1/AC2/AC3 |
  | Two-level sort, primary+secondary independently asc/desc, over Domain/Name/Modified | tested | `triageFilterSort.test.ts` AC4 (incl. secondary-reversed-independently case), `TriageSortLevel.test.tsx` |
  | Sort locale pinned to root/undetermined (`"und"`), not runtime-default ICU | tested | `triageFilterSort.test.ts` locale-spy test (external-review-driven, probe 2 above) |
  | Modified-sort uses latest-status-event `ts`, never `originalTs` (AC10) | tested | `triageFilterSort.test.ts`, `server/src/core/triage-store.union.test.ts` (`resolveUnion` `ts` resolution) |
  | Source-derived group subtitle dropped; flat list with Domain heading; 2-line detail excerpt retained | tested | `PerProjectTriageSection.test.tsx`, `TriagePage.test.tsx` ("no source-derived group heading") |
  | Hidden-count indicator whenever filtering hides an item (per-project + page-level aggregate) | tested | `PerProjectTriageSection.test.tsx`, `DeferredTriageSection.test.tsx` AC7, `TriagePage.test.tsx` AC5 |
  | Page-level all-filtered-out vs. genuine-empty distinction; denominator excludes promoted/dismissed items | tested | `TriagePage.test.tsx` AC5 (+ dismissed-item fence, probe 4) |
  | Clear-filters button resets `filters` only, never `sort`; does not affect Parked-suppressed items | tested | `useTriageViewState.test.ts`, `TriagePage.test.tsx` AC5 + NEW-1 regression (probe 1) |
  | Parked filter: own independent toggle, default hidden | tested | `useTriageViewState.test.ts`, `TriageFilterSortBar.test.tsx` |
  | AC8 — a due parked item survives every active filter and is not counted as hidden | tested | `PerProjectTriageSection.test.tsx` AC8 |
  | AC9 — a dateless park stays visible permanently, independent of the Parked toggle | tested | `PerProjectTriageSection.test.tsx` AC9 |
  | Complexity filter: forward-compat shim, unrecognized wire values normalize to `"unset"`, `unset` is a first-class filterable value | tested | `triageFilterSort.test.ts` `getComplexity`, `server/src/core/triage-store.union.test.ts` `resolveUnion` passthrough |
  | On-photo legibility: Deferred heading + AC7 hint use flipping `--ink`/`--muted`, not the legacy alias | tested | `on-photo-legibility.test.ts` (regex-isolated fence, not a whole-file ban) |
  | Sort-level controls distinguishable to assistive tech (WCAG 2.5.3 Label in Name) | tested | `TriageSortLevel.test.tsx`, `TriageFilterSortBar.test.tsx` (probe 3) |
  | Selected-chip color token (`--color-primary`-on-tint, matching the Design Check) | tested | `TriageFilterGroup.test.tsx` |
  | Real-browser rendering: filter bar layout, chip/sort control interaction, on-photo contrast as actually painted | untestable | `requires-manual-visual-judgment` — covered by the E2E spec (Step 11a, `client/e2e/flows/triage-filters-sort-parked.spec.ts`) + browser-verify, not a unit assertion; authored and run at Task #9, structurally after this review cascade per SKILL.md's own step ordering (Step 8 precedes Step 11a/11b) |
- **Confidence-pattern check:**
  - *Asymptote (depth):* satisfied — see probe 5 above; the last probe
    (locale-spy, targeting the exact dimension the prior probe found a
    bug in) found nothing, and the final code-reviewer pass confirmed
    convergence.
  - *Coverage (breadth):* every testable behavior in the ledger above is
    `tested`; the one `untestable` entry carries the closed-vocabulary
    reason `requires-manual-visual-judgment` and names its actual
    coverage mechanism (E2E + browser-verify) rather than being an
    "acceptable to skip" note.
  - *No self-attestation:* every fix in this iterate was re-verified by
    a fresh-context reviewer (three code-reviewer rounds, one external
    cascade round) rather than accepted on the implementer's own
    "looks right to me" — the anti-pattern this phase exists to
    structurally rule out.

## Verification (medium+)
- **Surface:** web
- **Runner command:** Playwright E2E against the dev stack (`client/e2e/flows/triage-filters-sort-parked.spec.ts`), executed via the F0.5 `surface_verification.py` orchestrator.
- **Evidence path:** `shipwright_test_results.json` → `iterate_latest.surface_verification`
- **Justification (only if surface=none):** n/a
