# Triage lanes with rows (iterate-2026-11-12-triage-lanes-rows)

Type: CHANGE (FR-01.30), complexity medium. Run id: iterate-2026-11-12-triage-lanes-rows.

## Request (operator, German, paraphrased)
Replace the three-cards-side-by-side Triage list by per-project dark lanes (task-board look) with one row per item.
The row shows the full title; severity ("kritikalitaet") sits LEFT of the triage id, no colored dots (only projects
have colors). The explanation stays in the opened item (detail dialog). The triage id must be copyable straight from
the list (selectable text + a small copy button), because the operator pastes ids to agents. The edit pencil sits beside
the action buttons. The project name is easy to read. Projects can be put in the user's own order via a handle left of the
project name.

## Acceptance criteria (FR-01.30)
1. Each project is a dark lane of rows; full title readable; no cards.
2. Severity and id left of the title; id selectable with one click; copy button copies exactly the id; neither opens the dialog.
3. Row actions (incl. pencil) appear on hover/focus; always visible on touch/phone.
4. Project lanes reorderable by drag handle or arrow keys; order persisted (localStorage view, additive `projectOrder`).

## Spec Impact
- Classification: modify (FR-01.30 Triage tab: list presentation + ordering).
- MODIFY: FR-01.30 — list is lanes of rows; ids copyable; project lanes orderable.

## Out of Scope
Server/API changes; detail dialog; filters/sort/group menus; ordering for non-project groupings.

## Affected Boundaries
localStorage `shipwright:triage-view:v1` gains optional `projectOrder: string[]` (additive, same version; absent => []).
Producer: serializeView. Consumer: parseView (drops non-strings, dedups, caps 50).

## Confidence Calibration
- Boundaries touched: the saved-view JSON (above).
- Empirical probes run: real-browser Playwright (isolated stack): hover reveal, clipboard readText == id, dblclick selects the whole id, keyboard + mouse-drag lane reorder, reorder survives reload; screenshot reviewed.
- Test Completeness Ledger: see F5 block.
- Confidence-pattern check: asymptote = reorder with a project filter active (full-order move keeps hidden projects); coverage = parked lane, collapsed lanes, non-project grouping (no handle).
