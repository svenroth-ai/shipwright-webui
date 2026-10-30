# Mini-plan - M5 Desktop-app style Mission chat (campaign mission-desktop-style)

Goal: restyle the Mission chat (activity feed) like the Claude desktop app and render answered
AskUserQuestion calls cleanly. Read-only display (ADR-034). All Shipwright cards stay.

## Acceptance criteria
- AC1 Layout: no avatar/timeline-node icons (`.mc-feed-node` gone, spine gone); agent text left on the bare ground (computed background transparent, border 0); human messages (`kind:"user"`) right-aligned in a rounded bubble (radius >= 12px, opaque tinted background).
- AC2 Tool calls render as small grey lines (command toggle + chips lose their boxes); the "N commands" expand behaviour is unchanged.
- AC3 Answered AskUserQuestion: one card per answered question (header, question, options with descriptions), the chosen option highlighted (`data-chosen="true"`, check mark, sr-only "(selected)"). Source: tool_use input joined with the result line's top-level `toolUseResult.answers`, keyed by question text; `toolUseResult` is trusted only when the line carries exactly one tool_result.
- AC4 'Other': a single-select answer matching no option label is shown as the selected free-text answer (`mission-ask-other`), no option highlighted. multiSelect: raw answer text always shown; options marked only when every comma-separated part is a label (real encoding verified: comma-joined labels, free text for Other). A user note (annotations[question].notes) is shown. Real answers under keys matching no question keep the whole call on the legacy display (no answer is ever lost).
- AC5 A rejected question (tool_result is_error, toolUseResult a string) is removed from the feed. Genuinely pending questions keep the existing prompt + "Answer in terminal" CTA. Questions without a recorded answer in a multi-question call are not shown as answered; with no answers map at all the legacy single-answer display applies.
- AC6 Shipwright features unchanged and still covered: commit/PR card, stop-hook, phase/gate/decision cards, failing-test pill + excerpt, subrunner cards (open agent window / View agent), agents dock, session-start divider. Verified by the existing 74 mission Playwright tests + vitest.
- AC7 Read-only: no textarea/input/composer in the feed, no chat-* testid.
- AC8 Legibility: new card text keeps WCAG AA contrast against its real ground (asserted in E2E; tokens only, no hardcoded text colours). No new motion; files < 300 lines; session-parser.ts net-zero lines (bloat ceiling).
- AC9 Real-browser E2E (Playwright, real JSONL fixtures): chosen option, Other answer, rejected question, pending question, layout geometry, contrast.

## Work
client: lib/missionAskItems.ts (+test), session-parser UserEvent.toolUseResult, missionActivityFeed{Types,Turn,Resolve},
mission/MissionAskCards.tsx (+test), MissionActivityFeed(+Card, CardParts, FeedIcons trimmed), styles/mission-chat.css,
mission-operation.css (node/spine/user rules removed), e2e/flows/M5-mission-desktop-chat.spec.ts.
