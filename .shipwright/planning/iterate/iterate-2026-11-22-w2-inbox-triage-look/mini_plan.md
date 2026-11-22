# Mini-plan: W2 Inbox in the Triage look

Run: iterate-2026-11-22-w2-inbox-triage-look. Complexity: medium (diff-driven re-check: medium, no upgrade).

## Goal
Restyle the existing Inbox (awaiting-reply entries only) to the approved mockups 01/02: filter bar chips, one card per project with a colour top edge, compact rows (orange AWAITING REPLY chip, first line, id+copy, age), hover/focus action "Answer in the terminal" in an empty zone that never moves the title (always visible on touch), click opens a light detail dialog with the full text. No behaviour change.

## Design
1. `inboxRowModel.ts` (pure): one shape for all 8 InboxItem kinds: chip (label/tone), filter bucket (awaiting | notices), one-line title (first line, markdown marks stripped), full text, render format (markdown | mono | plain), ask-part, whether it is answered in the terminal. `countByFilter` / `filterGroups` helpers.
2. `InboxRow.tsx`: row = Triage row classes (`triage-row`, `triage-row-in/-main/-actions/-meta`) + `.inbox-row` override of the action column width (one short button, kicks in at 48rem instead of 68rem). Reuses `TriageIdCopy` (extended with optional display/copy/testid props).
3. `InboxDetailDialog.tsx`: Radix dialog, same light sheet as `TriageDetailModal`; shows chip, task context, session id, full text (markdown only for text_question + lead_question via XSS-safe `MarkdownText`; mono `<pre>` for picker prompts), ask options (display-only), honesty line, lead-question answer form, "Open task" (the old whole-card click-through, now explicit) and "Answer in the terminal" (`.btn-primary`). Mounted as SIBLING of the row (portal event bubbling).
4. `InboxCard.tsx` composes row + dialog; `inboxItemKey` unchanged. Deleted: `InboxCardShell`, `InboxCard.AskTool/Waiting/CodexNotice`, `phaseMeta`. `InboxCard.LeadQuestion.tsx` becomes `LeadAnswerPanel` (the form, unchanged logic).
5. `InboxFilterBar.tsx` + page state: Open / Awaiting reply / Notices toggles with counts; a kind with no entries has no chip; a filter whose last entry leaves falls back to all.
6. CSS (`inbox-cards.css`): project card, filter chips, kind chips (mockup contrast colours), row override. No new motion; no animation, so reduced motion shows the final state by construction.

## Tests
Unit: model (all kinds, counts/filter), filter bar page test, updated InboxCard/InboxPage/terminalFallback/codex/phaseGate/LeadQuestion/Section tests, legibility fence. E2E: rewritten `inbox-triage-look.spec.ts` (hover action stays out of the layout, light dialog, filter, touch phone) + adjusted live-stack inbox specs. Visual baseline `inbox-populated` regenerated on Linux via the workflow.

## Risks
Behaviour change to flag: a lead question's answer form is now inside the dialog (one extra click); whole-row click no longer navigates (Open task does).

## Review dispositions (post-build)

External plan review (glm/openai: revise) - rejected-with-reason: the brief makes the dialog the home of full text and actions, a compact row has no room for the inline lead form; the wider 8-kind model is needed so every Inbox kind keeps a row; touch layout is covered by the phone e2e + screenshot.
External code review (glm approve, openai revise) - accepted-and-fixed: all AskUserQuestion parts shown in the dialog, focus returns to the row title on close, TriageIdCopy accessible name. Visual baseline: regenerated through the Linux workflow after push (not a Windows PNG).
Internal: opus-plan-reviewer mediums fixed (copy-id fence made explicit, sticky filter reset). code-reviewer mediums fixed (never-empty titles, full-id copy fallback).

## Confidence calibration (Step 3.8)

Boundary: untrusted server/JSONL text -> DOM. Probes: hostile img-onerror/script text in jsdom and in real Chromium (no execution, layout intact, no finding); empty / fence-only titles (finding, fixed, re-probed clean); clipboard-reject fallback selection (finding, fixed). Two consecutive clean probes after the fixes: asymptote reached. Not probed: RTL text, >10k-char lines (clamped by CSS, acceptable).
