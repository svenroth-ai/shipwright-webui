# Iterate Spec: triage-page-redesign

- **Run ID:** iterate-2026-11-08-triage-page-redesign
- **Type:** change
- **Complexity:** medium
- **Status:** draft (operator approved the HTML proposal and decisions A-D on 2026-11-08)

## Goal
Make the Triage page consistent with the Board (toolbar, filters, project filter, density), remember the operator's
view across reloads, and make every card actionable and understandable: primary action on the card, quick metadata
edit, snooze on card and modal, and plain-language help for source and audit-check codes.

Approved design: `.shipwright/designs/triage-redesign-proposal.html` (incl. modal). Delivered in TWO PRs by decision
(the one-iterate-one-PR rule): this run is PR 1 (client only); PR 2 = Fix-now task link + "In progress" tile/card
(server, additive field on the task).

## Acceptance Criteria
- [ ] Filter, sort, group-by and collapsed groups on the Triage page survive a reload and navigation; an unreadable or
      outdated saved view falls back to the defaults without an error.
- [ ] The Triage header uses the Board's controls: the same project dropdown (shared with the Board's project choice),
      a filter funnel menu (nothing ticked = show all, ticked = show only those) and Sort/Group menus; active filters
      show as removable chips with a "Clear filters" link and a count "Showing N of M".
- [ ] Every sort level has its own ascending/descending switch; sort keys are Severity, Priority, Modified and Name.
- [ ] Items can be grouped by None, Project, Severity, Source or Priority, and each group can be collapsed.
- [ ] The summary tiles read Open, Critical + High, Parked (the "Needs attention" label is gone); search appears only
      when there are more than 12 open items.
- [ ] Each card shows the primary action (Fix now, or Start campaign on campaign items), Promote, a Snooze menu
      (tomorrow, 1 week, 1 month, pick a date, no date) and Dismiss; Snooze is no longer a button with a hidden form.
- [ ] The detail modal offers the same Snooze menu; its Reason field stays for Dismiss and Snooze.
- [ ] On a card and in the modal the operator can edit title and severity in place; priority, domain and complexity
      are shown read-only (priority follows severity).
- [ ] Bundled compliance and phase-quality cards list each audit check on its own line, each with a "?" help.
- [ ] Source labels, severities and every known audit-check code have a plain English help text (what it is, why it is
      here, what to do); a test fails when a known code has no text.
- [ ] Cards stay solid white (no white-on-white), the page scroll stays below the title bar, and the layout works at
      phone width.

**Pre-build AC record (Step 2a):** frozen in `ac-record.jsonl` (changed existing criteria: filter semantics, sort keys,
Snooze placement).

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.30 (Triage tab). Folded, not minted: the earlier 2026-08-08 filter/sort criteria change from
  "exclude" to "pick what to show"; sort keys and the Snooze placement change.
- **REMOVE:** none

## Out of Scope
- Fix-now remembers its task, "In progress" tile and card state (PR 2, server + shared type, additive).
- Editing domain / priority / complexity (needs an extension of the amend event in the shared triage tooling, other repo).
- Server API changes of any kind in this PR.

## Design Notes
- Tokens only (`no-hardcoded-colors`), motion via tokens, `.on-photo` solid cards, standard buttons (rule 26),
  scroll belongs to the route (rule 27), `PageHead` stays; files under 300 lines (page and filter bar are split).
- Board parity: `ProjectFilterDropdown` + `useProjectFilter` (shared), funnel menu modelled on `BoardStatusFilter`.
- Filter state is NOT shared with the Board; only the project choice is.
- Filter model flips from exclude-sets to include-sets (decision B). Kept bypasses: a returned park always shows,
  a dateless park stays visible.
- Persistence: `localStorage` key `shipwright:triage-view:v1`, versioned, validated on read, every access in try/catch.
- Help texts live in one English text file; explanations are the approved drafts from the proposal.

## Affected Boundaries
| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `useTriageViewState` (localStorage write) | `useTriageViewState` (read on mount) | JSON `{v, filters, sort, groupBy, collapsed}` |

## Confidence Calibration
- **Boundaries touched:** saved view (browser localStorage JSON, key `shipwright:triage-view:v1`). Server wire formats untouched.
- **Empirical probes run:**
  - Saved-view round trip serialize -> parse: identical state back (`triageViewStorage.test.ts`).
  - Corrupt JSON, wrong type, old/unknown version, unknown filter/sort/group values, sets-as-non-arrays, oversized collapsed list: each falls back to defaults or drops only the bad value, never throws, never "shows nothing" (`triageViewStorage.test.ts`, `useTriageViewState.test.ts`).
  - Real browser (isolated stack, chromium): set filter + grouping, reload, same view and chip; clear restores everything (`triage-redesign.spec.ts`).
  - Real triage log scanned for every check code in use; every code has a help entry (`triageHelpText.test.ts`).
  - Cross-project id collision and the two park bypasses exercised together in the pipeline (`triageBoardModel.test.ts`).
- **Test Completeness Ledger:**
  - FR-01.30 include-set filter + chips + empty-vs-filtered distinction: `triageFilterSort.test.ts`, `TriagePage.test.tsx` — covered.
  - Sort per level + grouping + collapse: `triageFilterSort.test.ts`, `triageGrouping.test.ts`, `useTriageViewState.test.ts`, E2E group persistence — covered.
  - Saved view: `triageViewStorage.test.ts`, `useTriageViewState.test.ts`, E2E reload — covered.
  - Board-style header + tiles + search > 12: `TriagePage.test.tsx` (tiles, search threshold), visual baseline not regenerated (see risk below).
  - Card/dialog actions incl. Snooze menu: `TriageItemCard.test.tsx`, `PendingDelivery.test.tsx`, `TriageDetailModal*.test.tsx`, E2E snooze/fix-now/dismiss-gating.
  - Quick edit title + severity: `TriageQuickEdit` through `triage-redesign.spec.ts` (real amend route) — covered.
  - Per-check help: `triageFindings.test.ts`, `triageHelpText.test.ts`, card findings test — covered.
  - Phone containment (edit form, Snooze popover inside dialog/viewport): E2E phone case — covered.
- **Confidence-pattern check:** no `catch`-and-continue masking, no test asserting on a mock's own return, the E2E asserts the server-written result (renamed title appears after a real amend); one initially failing E2E (`invalid_triageId`) was a fixture-id error in the spec, not a product defect. Known untested: the Linux visual baseline for `/triage` (chrome-a05 visual spec) is not regenerated here — baselines are Linux-only; the CI visual gate decides. Help-text explanations are drafted prose, not verified against the compliance `group_*.py` sources.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `cd client && node e2e/isolated-stack.mjs --project=chromium e2e/flows/triage-redesign.spec.ts` (plus the touched triage/mobile specs on chromium + mobile-chromium)
- **Evidence path:** `.shipwright/planning/iterate/iterate-2026-11-08-triage-page-redesign/f05-evidence.json`

## Internal Plan Review
- **Ran:** yes (opus-plan-reviewer, fresh context)
- **Summary:** plan sound for a client-only PR; the aggregated list silently drops polling ownership, per-project drift/load/error states and per-item project identity, and the filter flip is only safe if the two park bypasses stay in their own selectors.
- **Findings:** 4 high + 6 medium + 2 low, all accepted and integrated as binding decisions 1-13 in the mini-plan (polling, per-project strip, project identity, filter vs. parked, parked section, saved-view hydration, project dropdown fallback, search, quick-edit gate, snooze presets, parser fixtures, help catalog, housekeeping).

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-11-08-triage-page-redesign/architecture_brief.md`
- **Verdicts:** glm=approve · openai=revise
- **Smallest thing that would do (per reviewers):** glm: option A as scoped, collapsed state optional; openai: option B (keep per-project sections, add persistence, help texts and card actions; defer grouping, collapse and multi-level sort).
- **Findings:** glm low: collapsed persistence fragile -> accepted-and-fixed (stored with its groupBy, reset on change); glm low: keep the help-coverage test -> kept. openai medium: configurable grouping is disproportionate for about five items -> rejected-with-reason.
- **Reconciliation:** the plan had considered keeping per-project sections. The operator explicitly asked for grouping switchable between none, project and severity and approved the HTML design with it, and grouping by severity or source across projects needs one aggregated list, so option A stays. Multi-level sort is kept because the operator asked for direction per level.

## Architecture Review (internal arm)
- **Verdict:** approve (fresh-context reviewer, saw only brief + spec). Smallest thing: option B as strict minimum, but accepts A as already narrowed (client only, server work in PR 2). Low notes accepted: build persistence + help texts first; single source for the code catalog; unknown values inside a valid saved payload are dropped (never "show nothing"); confirm the existing amend route covers title/severity (it does: title, detail, severity).
