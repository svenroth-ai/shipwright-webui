# Mini plan: V9 mobile polish and accessibility guards

## Acceptance criteria (derived from the scope)
1. A contrast test parses the dark chat-card tokens and the light Agents-window tokens and fails below WCAG 2.2 AA (text 4.5:1, UI 3:1).
2. A guard fails on any `font-size` below 12px (literal or shared scale token) in `mission-*.css` and the Files & Terminal / tree / viewer sheets.
3. A guard allows motion only on the running dot, gates all other motion to `no-preference`, and requires the running dots to be still under `reduce`.
4. The keyboard focus ring is a visible 3px teal ring on the dark and the light Mission surfaces (no `outline:none` without a ring).
5. Status is always a text pill; a dot exists only for a running agent (component test).
6. Phone (<=767px): the Agents window is a full-screen sheet with list (56px rows) -> detail drill-down and a 44px Back; tap targets are 44px on a coarse pointer; Run-result card actions are full width 44px; tables scroll in their own frame; the file menu is a bottom sheet; the viewer wraps by default.
7. Follow-ups: (a) a hand-back only counts as an agent's final report when its origin is "subagent", and the Agents window Details tab and the chat report panel read "finished" from ONE helper; (c) the pane tab bar's tablist is a real grid box, not `display: contents`.
8. Fix every violation the guards find in V1-V8 code.

## Approach
- New tests: `mission-a11y.contrast.test.ts`, `mission-a11y.guards.test.ts`, `AgentsWindow.mobile.test.tsx`, E2E `V9-mobile-a11y-guards.spec.ts` (Pixel 5 touch).
- Fix: sub-12px sizes -> 12/12.5px; ungated transitions gated; the subrunner dot gets a reduce rule; `.mc-side-split` focus ring; `.mc-result-btn` coarse 44px; `--muted` in `.ag-window` and the running dot colour darkened to clear AA; `--focus` becomes a 3px ring (dark card, plus `mission-a11y.css` for the light surfaces).
- Agents window: `drilled` state + `data-view`; Back button; CSS phone sheet.

## Known limits / deviations
- The mobile header Expand button on the Mission tab is kept: it folds the mode switch and status row and is pinned by FR-01.38 e2e (V8 follow-up (b) not confirmed meaningless).
- Visual baselines affected only if a baselined screen renders one of the changed sizes (see result).

## External-Plan-Review-Findings (plan call: openai revise, glm revise; architecture call: openai approve, glm approve)
| Finding | Disposition |
|---|---|
| openai: motion contract contradictory (only the running dot vs gated to no-preference) | accepted-and-fixed: one rule - only the running dot animates continuously; one-shot entrance/hover transitions exist only under `no-preference` (the guard enforces both halves and that the dots are still under `reduce`) |
| openai: drill-down state needs defined reset/focus behaviour | accepted-and-fixed: `drilled` resets on every open (chosen agent -> detail, bar -> list), Back hidden with no agents, focus follows the drill (Back button in, selected row out); unit test covers the open/back transitions |
| openai: token parsing is not pair contrast | accepted-and-fixed: the contrast test enumerates real surface pairs (text on card/ground/tint/bubble/thead, pills over alpha-composited tints, focus ring + running dot at 3:1) parsed from the source CSS |
| openai: every outcome needs an assertion | accepted-and-fixed: real-browser Pixel 5 spec asserts table frame + no page overflow, 44px targets, full-screen sheet, 56px rows, bottom sheet, reduced-motion dot, 3px ring |
| glm: unbounded "fix every violation" / baseline risk | accepted-and-fixed: guards were run first; the inventory is 9 sub-12px declarations, 3 ungated motion rules, 1 dot without a reduce rule, 1 focus ring removal, 1 missing coarse target, 2 contrast pairs; baselines listed in the result |
| glm: follow-up (a) bundled | rejected-with-reason: it is a 3-line filter the campaign brief assigned to V9; it has its own unit test (agentTranscriptFeed.test.ts) |
| glm: hardware Back should pop the drill-down | rejected-with-reason: no modal in the app is wired to history; Escape closes the dialog (Radix) and the in-sheet Back covers the drill-down |
| glm: 44px via coarse pointer vs width inconsistent | rejected-with-reason: sizes follow `pointer: coarse` (the device), layout follows width; the e2e measures the effective box, not the declared value |
| glm: Pixel 5 flags / parse from source | accepted: the spec uses the Pixel 5 device (isMobile + hasTouch); no hex is re-declared in the tests |
