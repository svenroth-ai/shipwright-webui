# Iterate Spec: triage-polish-r3

- **Run ID:** iterate-2026-11-09-triage-polish-r3
- **Type:** change
- **Complexity:** medium (the keyword classifier said large because of the word "redesign"; this is operator-approved polish of one feature with no new architecture, so it is overridden to medium and disclosed)
- **Status:** draft

## Goal
Third polish round on the Triage page after operator review of #586/#587: clearer help texts, calmer card and dialog, readable filter strip, multi-column list.

## Acceptance Criteria
- [ ] Help: the third section reads "What Fix now does"; severity pills have no help marker; unknown or project-specific sources use the generic text (no `req3*` or `tooling` entries); GitHub security and failing-PR-check texts differ; wording checked by an Opus reviewer for a tech-savvy non-developer.
- [ ] The Triage project dropdown shows no task counts.
- [ ] Open cards in a group use 1 / 2 / 3 columns by width.
- [ ] Detail dialog: title, card-identical pills, explained findings, secondary fields folded away, Edit as a bottom button.
- [ ] The active-filter strip sits on a solid light surface.
- [ ] Card contrast and project pill follow the mockup and the Board's accessibility.
- [ ] Reset view is first in the filter menu.

## Spec Impact
- **Classification:** modify — FR-01.30: AC36 and AC40 changed, seven ACs added.

## Out of Scope
- Server, schema, link logic, Fix-now behaviour. What the actions do does not change.

## Design Notes
Mockup `.shipwright/designs/triage-redesign-proposal.html` (card, `.afl` strip, `.ph` project pill, `.src` source). Source help is generic by design: sources are free text and differ per customer project.

## Affected Boundaries
None (client-only; no serialized format changes).

## Confidence Calibration
- **Boundaries touched:** none (client rendering + static text).
- **Empirical probes run:** real-browser specs for grid columns, dialog, strip, menu order; unit tests for the help catalogue and doc sync.
- **Test Completeness Ledger:** see F5.
- **Confidence-pattern check:** pending.

## Verification (medium+)
- **Surface:** web
- **Runner command:** Playwright specs via the isolated stack (see F0.5)
- **Evidence path:** scratchpad JSON staged at F5
