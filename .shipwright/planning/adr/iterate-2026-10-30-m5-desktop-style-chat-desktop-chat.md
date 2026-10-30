# Mission desktop-app style chat and answered-question cards

Campaign mission-desktop-style, unit M5 (run iterate-2026-10-30-m5-desktop-style-chat).

## Decision
Restyle the existing curated activity feed in place (option 1) and extend the user-input card with per-question items from the tool_use input joined with the result line's top-level `toolUseResult.answers` (keyed by question text).

## Architecture Review
Brief options: (1) restyle in place + extend the card, (2) replace the feed with the raw BubbleTranscript renderer, (3) do nothing. External verdicts: glm approve, openai approve (no findings). Internal arms not applicable (below medium).

## External-Plan-Review-Findings
- tool_result lines becoming human bubbles: accepted-and-fixed (only typed text yields a user card; tested + E2E asserts exactly one bubble).
- duplicate question text / blank answers: accepted-and-fixed (first wins, blank = unanswered).
- multiSelect encoding: real fixture inspected (comma-joined labels, free text for Other); raw text always shown, options marked only when every part is a label.
- multiple tool_results per line: accepted-and-fixed (sidecar ignored, legacy display, tested).
- pending question must be hidden (openai high): rejected-with-reason, overruled-by-operator: the operator explicitly requires pending questions to keep the answer-in-terminal prompt.
- no-error-messages scope: rejected-with-reason, delivered by M1; failing-test cards stay per campaign constraint.

## Consequences
A rejected question and an answers map recording no answer disappear from the feed; real answers under non-matching keys fall back to the legacy single-answer block. Parser retains only the `answers` map.
