# Mini-plan - M4 Agents window (campaign mission-desktop-style)

Goal: a bottom bar in the Mission chat ("<n> agents running", active only) opens a modal Agents window:
Active / Finished sections as a who-started-whom tree, per agent prompt + answer + read-only Transcript.
The chat subrunner card opens the SAME agent detail. Data: M2 session-info (no timer) + new read-only
subagent-transcript route.

## Acceptance criteria
- AC1 Bar: `agents-bar` renders "<n> agents running" (singular for 1) only when >=1 agent has state running; hidden at 0.
- AC2 Window: Radix Dialog (focus trap, Esc, backdrop close) with sections Active and Finished; finished = completed/failed/killed/stopped/finished-stale.
- AC3 Tree: indent by tree depth from parentAgentId; a root whose parent is in the other section names it ("started by X"); parent cycles cannot loop.
- AC4 Detail: prompt (from parent) and answer (returned to parent); a running agent shows "Still running" instead of an answer; killed/stopped shown as bad-tone status.
- AC5 Transcript tab: GET /api/external/tasks/:id/subagents/:agentId/transcript, rendered through BubbleTranscript; fetched only while the tab is open; read-only (no textarea/composer/chat-* testid).
- AC6 Route safety: agentId must match [A-Za-z0-9]{1,64} (400 otherwise); file path realpath-resolved and must equal <uuid>/subagents/agent-<id>.jsonl under the project dir (symlink escape -> missing); open once and check the HANDLE is a regular file; positional tail read <= 4 MiB cut on newline boundaries; read-only, stateless.
- AC7 Card link: a resolved/failed subrunner card's report button and a running card's "View agent" open the same window on that agent; if the agent is unknown to session-info the legacy SubrunnerPanel still opens (failed cards keep working).
- AC8 Feed reducer: task-notification status killed resolves the card as failed; stopped resolves it as done (neutral, not red), because a turn-limit pause of a SendMessage-continued agent also reports stopped. Both set subrunnerEndStatus so the card's button names the outcome ("(killed)" / "(stopped)"); a later completed clears it. (Amended at campaign 3f-bis after the Stage-1 review: the original text said stopped -> failed. The Agents window detail keeps both in the bad tone per AC4 — it shows the agent's own last state.)
- AC9 Cost: no polling timer; session-info reuses useSessionInfo (same cache key as the sidebar); refetch on window open + manual Refresh.
- AC10 Plain iterate and campaign session (depth-2 reviewers) both work; Shipwright cards (commit/PR/stop-hook/gate) untouched.
- AC11 Files < 300 lines; motion only under prefers-reduced-motion: no-preference (resting state = final state); touch targets 44px on coarse pointers.
- AC12 Real-browser E2E (Playwright) proves bar -> window -> tree -> detail -> transcript, and card -> same detail.

## Work
server: core/session-info/subagent-transcript.ts + route in external/session-info/routes.ts + tests.
client: lib/agentsTree.ts, hooks/useMissionAgents.ts + useSubagentTranscript.ts, mission/Agents{Dock,Window,List,Detail}.tsx,
styles/mission-agents.css, MissionActivityFeed(+Card) footer/canOpenAgent, MissionBody wiring, missionActivityFeedSubrunner killed/stopped.
