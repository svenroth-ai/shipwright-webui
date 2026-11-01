# Mini-plan: V3 - subrunner panel answer, Agents window look, transcript in chat renderer (iterate-2026-11-01-v3-subrunner-answer-agents-window-chat)

Spec: campaign mission-desktop-style-v2, sub-iterate V3. Mockup `Spec/design/mission-desktop-style-v2/` Boards 4, 5, 6 (README rows 2, 9, 10, 11). FR-01.66 (Mission view). spec_impact: modify (UI behaviour of the Mission panel and Agents window changes).

## Acceptance criteria (derived from the scope; the unit spec said TBD)

- AC1 The subrunner panel never shows the CLI's "report was delivered to you as a message from <id> ... not repeated here" pointer: the reducer drops it from the card report, and the panel shows the agent's real answer (session-info answer, else the last assistant message of the agent's own transcript file, else the hand-back text the parent received, else the card report). A failed/killed/stopped agent keeps its notification text. When nothing real exists the panel says "No report was found for this subrunner."
- AC2 Agent hashes in the panel and in the Agents window's prose (prompt, answer, report) are clickable chips that open the Agents window on that agent; only ids / unique 8+ char prefixes of KNOWN agents become chips (unknown hash stays plain text). The panel offers "Open in Agents window" (agent known) and "Jump to message in chat" (a hand-back card from that agent exists).
- AC3 Agents list: no status dot for finished/failed/stopped agents (dot only for running, pulsing, still under prefers-reduced-motion); left pane light grey (#efeeec) with a 1px strong divider; rows 50px; text >= 13px (14px titles); titles #3d3833; the window head keeps only the summary + refresh + close.
- AC4 Transcript tab renders with the Mission chat's own components (`FeedCard`, `.mc-feed-*`, `parseSessionJsonl` + `deriveActivityFeed`) on a light token set, not BubbleTranscript. The first user record (when the file's start is in view) is a "Prompt from the session" card, never a human bubble; no right-hand bubble exists. System notes are dropped; "Unknown event"/"Thinking..." do not appear; no "No system messages" toggle. Header: "Showing the latest 200 of N events", "Load older", refresh only.
- AC5 Records "The coordinator sent a message while you were working: ..." inside subagent transcripts parse to a `handback` event with origin `coordinator` (framing + harness trailer removed) and render as a labelled "Coordinator message" card, not a human bubble.
- AC6 Read-only on ~/.claude (stateless transcript read unchanged); tokens only, no new motion; English UI; no composer / chat-* testids; files under 300 lines.

## Work

1. `parsers/handback.ts` coordinator origin; `HandbackCard` label/notice + `data-sender`.
2. `missionActivityFeedSubrunner.ts` drops the delivered pointer; `lib/subrunnerAnswer.ts`, `SubrunnerPanelHost` (data) + `SubrunnerPanel` (presentational).
3. `AgentLinkContext` + `lib/remarkAgentLinks.ts` + `MarkdownText` chip rendering (only inside a provider).
4. `lib/agentTranscriptFeed.ts` + `AgentTranscriptFeed` + `AgentDetail` TranscriptTab; `AgentsList` dot; `mission-agents.css`.
5. Tests (unit + M4 real-browser E2E extended).

## Alternative approach considered - rejected because X

Keep BubbleTranscript and only restyle it: it cannot reproduce the chat's tool lines, tables and cards, and the user explicitly asked for the SAME renderer as the chat.
