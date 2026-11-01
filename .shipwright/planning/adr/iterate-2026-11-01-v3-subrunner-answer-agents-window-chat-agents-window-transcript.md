# Agents window transcript in the chat renderer; subrunner answer; agent-hash chips (V3)

Run: `iterate-2026-11-01-v3-subrunner-answer-agents-window-chat` (campaign mission-desktop-style-v2, unit V3). FR-01.66. Mockup Boards 4-6.

## Decision

Reuse the Mission chat's parser + feed reducer + `FeedCard` for the Agents window Transcript tab on a light token set (`.ag-feed`); resolve the subrunner panel's answer from the agent's own data, never the CLI's "delivered to you as a message" pointer; render agent hashes as chips through a context that is null outside the Agents window / panel; classify the coordinator's mid-run message as a hand-back origin in the parser.

## External-Plan-Review-Findings (glm: revise, openai: revise)

| # | Finding | Disposition |
|---|---|---|
| glm1 / openai1 | Failure notification must win for failed/killed agents; every candidate must be placeholder-checked | accepted-and-fixed: `pickSubrunnerAnswer` applies `isRealAnswer` to every source; killed/failed keeps the notification (unit-tested) |
| glm2 | "last assistant message" = last record with non-empty text | accepted-and-fixed: `lastAssistantMessage` (test with a trailing tool_use record) |
| glm3 / openai5 | Exclude code/links from linkification, no change outside a provider, ambiguous prefixes | accepted-and-fixed: remark plugin skips code/inlineCode/link; unique 8+ prefix of a known agent of THIS session only; test without provider |
| glm4 / openai6 | Exact coordinator framing, preserve unmatched content, no human bubble fallback | accepted-and-fixed: anchored header match; any other user record in a subagent file renders as a "Message to this agent" card, never a right bubble |
| glm5 / openai4 | Prompt only at true file start; count semantics | accepted-and-fixed: prompt only when neither the server tail cut nor the window cut hides the start; counts are message events before filtering (documented) |
| openai2 | Stale responses when switching agents | rejected-with-reason: query keys and `AgentDetail` are keyed by agentId, so a switch remounts |
| openai3 | FeedCard provider dependencies | accepted-and-verified: real-browser E2E renders tool lines, hand-back and subrunner cards in the window; no navigation callbacks mutate Mission state |
| glm6 | Single-use wrappers | rejected-with-reason: the panel data/presentation split keeps the panel unit-testable without a QueryClient |

## Architecture Review (external: glm approve, openai approve)

Both approve option A (reuse the chat renderer): it removes a parallel transcript renderer from this surface. glm low: a context may be larger than needed; kept because the hash resolver is needed by two surfaces (window and panel) and must be absent in the chat.

## External-Code-Review-Findings (glm: revise, openai: revise)

| Finding | Disposition |
|---|---|
| MarkdownLink returned before `useFileTarget` (hook order) | accepted-and-fixed |
| Explicit `[x](agent:unknown)` rendered a chip / reached `select` | accepted-and-fixed: `AgentChip` renders plain text unless the id is a known agent |
| Transcript fallback gated on a truthy but placeholder/blank `agent.answer` | accepted-and-fixed: `isRealAnswer` gates the fetch |
| remarkGfm array replaced `REMARK_PLUGINS` | accepted-and-fixed (spread); the const holds only remarkGfm |
| Coordinator trailer not stripped with trailing whitespace | accepted-and-fixed (`trim`) |
| Bidirectional prefix match for Jump to message | accepted-and-fixed: resolved through the known-agent index |
| Jump while another pane is open | rejected-with-reason: the subrunner panel IS the detail pane; closing it returns to the feed |
| Coordinator-as-first-record mislabelled prompt | rejected-with-reason: a coordinator record parses to kind handback, not user; unit-tested |

## Self-Review

1 Spec Compliance pass; 2 Error Handling pass (missing file / empty tail / unknown agent give honest empty states); 3 Security Basics pass (markdown only, agent: hrefs validated against known ids, read-only GET); 4 Test Quality pass; 5 Performance Basics pass (feed derived once per fetch, memoised, windowed to 200 events); 6 Naming & Structure pass (files under 300 lines); 7 Affected Boundaries pass (producer: CLI subagent JSONL incl. coordinator records, probed on real on-disk files; consumer: parser, reducer, DOM, E2E).
