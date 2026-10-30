# Iterate: Standalone view (hide Triage + Ship's Log) — iterate-2026-10-30-hide-shipwright-views

Type: FEATURE · Complexity: medium · Spec impact: MODIFY (FR-01.03)

## Why
Standalone mode (iterate-2026-10-29) left Triage and Ship's Log visible; for a
repo without `.shipwright/` they are empty. The operator wants to switch them off
globally from Settings, with a short explanation of what is hidden. README must
also present Standalone mode just before "Develop or contribute", not near the top.

## Acceptance criteria
- AC-1 Settings has a card "Standalone view" with one checkbox (default OFF) and a plain-language explanation of what it hides. Stored per browser (localStorage, like the terminal preferences); same-tab and cross-tab consumers update live.
- AC-2 When ON: the sidebar has no Triage item, the command palette offers no Triage destination, and the campaign card's "promoted from triage" link is not rendered.
- AC-3 When ON: `/triage` and `/projects/:id/log` redirect to the task board (`/`); opening a project (project card, palette) lands on the board scoped to that project instead of its Ship's Log.
- AC-4 When OFF everything behaves exactly as before.
- AC-5 The setting is purely presentational: it does not change what is written to any repo (that stays the per-project `standalone` flag).
- AC-6 README: the Standalone section sits directly before "Develop or contribute"; the in-page anchors still resolve. README + guide §5.4 describe the new setting.

## Out of scope / limits
- Per browser, not per project and not synced to the server.
- Inbox, Diagnostics and Org stay visible.
- Server routes are untouched (hiding is UI-only; direct API reads still work).

## Tests
`standaloneView.test.ts` (store+hook), `StandaloneViewCard.test.tsx`, sidebar/palette/redirect/openProjectLog tests, E2E `108-standalone-view.spec.ts`.
