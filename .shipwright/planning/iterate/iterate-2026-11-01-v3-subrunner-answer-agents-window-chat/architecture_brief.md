# Architecture Brief: Agents window transcript, subrunner panel answer, agent hash chips

## The problem

The Agents window's Transcript tab shows a subagent's JSONL with the old bubble transcript (separate look from the Mission chat, error/system tiles, the parent's prompt as a human bubble). The subrunner side panel can show the CLI's "delivered to you as a message" pointer instead of the agent's report. Agent hashes in text are not clickable.

## What would newly, permanently exist

Nothing standing (no workflow, credential, job, write surface or service). Client-only: a feed-derivation wrapper for subagent transcripts, one React context for agent-hash chips, a presentational/data split of the subrunner panel, one stylesheet. Read-only on the existing stateless subagent transcript route.

## Options on the table

- **A:** Reuse the Mission chat's parser + feed reducer + card components for the transcript tab; add a context so markdown can render known agent hashes as chips; resolve the panel answer from session-info / the agent's own file / the hand-back card.
- **B:** Keep BubbleTranscript and restyle it.
- **C:** Do nothing.

## Constraints that are not negotiable

Read-only on `~/.claude` JSONL; no chat composer or chat-* surface (ADR-034); files under 300 lines; no hardcoded colours; reduced-motion shows the complete final state.
