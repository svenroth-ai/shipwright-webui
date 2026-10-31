# Architecture Brief: Mission chat - subagent hand-back, Run result card, subrunner row

## The problem

In the Mission chat a subagent's final report is delivered by the CLI as a user-role transcript record, so it renders as if the human typed it. The end of a run shows five separate bare "Open tests / requirement / decisions / review / commit" lines that look like loose links. A delegated subagent's card looks the same as those evidence lines.

## What would newly, permanently exist

Nothing standing (no workflow, credential, job, write surface or service). This changes machinery that already exists: the client-side transcript parser (one more event kind, `handback`), the Mission feed reducer/renderer (one more card kind, a render-time grouping of evidence cards, a subrunner row), and one stylesheet. Read-only; nothing is written anywhere.

## Options on the table

- **A:** Detect the hand-back in the existing parser as a new event kind, carry it through the feed as its own card kind, group the evidence cards at render time into one card.
- **B:** Leave the parser alone; reclassify user entries inside the Mission feed reducer only.
- **C:** Do nothing.

## Constraints that are not negotiable

Read-only on `~/.claude` JSONL; no chat composer or chat-* surface (ADR-034); files under 300 lines, `session-parser.ts` may not grow past its bloat baseline.
