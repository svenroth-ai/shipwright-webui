# Mini-plan: V2 - hand-back card, Run result card, subrunner row (iterate-2026-10-31-v2-handback-result-subrunner-cards)

Spec: campaign mission-desktop-style-v2, sub-iterate V2. Mockup `Spec/design/mission-desktop-style-v2/` Board 2+3 (README rows 5, 6, 7). FR-01.66 (Mission view). spec_impact: modify (UI behaviour of the Mission feed changes).

## Acceptance criteria (derived from the scope; the spec said TBD)

- AC1 A user-role record whose text STARTS with "Another Claude session sent a message", or STARTS with the `<agent-message from="...">` envelope (optionally after that one header line), or STARTS with `[Subagent hand-back]` parses to `kind: "handback"`, never `user`. Mid-text quotes of these markers stay ordinary user messages (recorded deviation from the scope wording "contains": real CLI records always open with the header or the envelope, and anchoring stops a human message that merely quotes a hand-back from being labelled "not a message from you" and cut short). Sender id, origin (subagent/session) and the dedented report are extracted; the English framing and the trailing "other Claude session" paragraph are dropped. tool_result content never triggers it.
- AC2 The Mission feed renders it as a LEFT `.mc-handback` card: yellow (warn) left border, tag "Subagent report" / "Other session", title of the dispatching subagent when known, an 8-char sender chip (a button that opens the Agents window when the agent is openable), the report as markdown, and the fixed notice "Reply from a subagent, not a message from you." (other session: "Message from another session, not from you."). No `user` bubble, no human reply card. BubbleTranscript renders the same card.
- AC3 The "Open tests/requirement/decisions/review/commit" evidence lines fold into ONE `.mc-result` "Run result" card: per row a text status pill (Passing/Failing/Recorded/Passed/...; never colour alone), a statement and one action button named Tests/Requirement/Decision/Review/Commit (accessible name stays "Open <artifact>"); the commit/PR delivery is the last row. A card with narration, commands, output or a question is NOT folded (nothing is lost) and keeps its own link.
- AC4 A subagent dispatch renders as a distinct `.mc-sub` row: agent icon chip, title, meta "Subagent . <type> . finished in N min" (running / failed / killed / stopped spelled out in words), action "Report" (done/failed) or "View" (running, only when the agent is openable). Tool lines stay grey and small.
- AC5 `session-parser.ts` does not grow (842 -> 775 lines); the extraction is cohesive (`parsers/handback.ts`, `parsers/skill-body.ts`).
- AC6 Only tokens (no hardcoded colours), >=12px text, 36/44px targets, no new motion; UI strings English; no composer / chat-* testids.

## Work

1. `parsers/skill-body.ts` (moved out), `parsers/handback.ts` (new detector), `HandbackEvent` in `session-parser.ts`.
2. Feed: `ActivityCard` gains kind `handback` + fields; `missionActivityFeedHandback.ts`; subrunner type + end time; `missionActivityFeedResult.ts` grouping (render-time only).
3. UI: `HandbackCard`, `RunResultCard`, `SubrunnerRow`, `FeedCard`/`MissionActivityFeed` wiring, `TranscriptRow` handback branch, `mission-result.css`.
4. Tests: parser/detector, reducer, grouping, components, CSS fence, real-browser E2E (V2 spec) + existing subrunner spec adjusted.

## Alternative approach considered - rejected because X

Reclassifying only inside the feed reducer: BubbleTranscript, the narrator and every other parser consumer would keep showing the hand-back as the human's message (and the narrator would say "You said: Another Claude session ..."). One parser kind fixes all consumers.
