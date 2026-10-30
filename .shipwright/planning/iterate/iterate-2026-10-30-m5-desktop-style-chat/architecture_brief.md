# Architecture brief - M5 Desktop-app style chat

Problem: the Mission chat is a curated card timeline with per-kind avatar icons and boxed cards, and an answered AskUserQuestion shows
only the first question's text with a terse answer line. Users expect the Claude desktop app look: agent text left, human messages in a right bubble,
tool calls as quiet lines, and a Q&A card per question showing which option was chosen.
Data: the session JSONL already holds the question list (tool_use input) and, on the result line, a top-level toolUseResult.answers map keyed by question text.

Options:
1. Restyle the existing feed in place (CSS + FeedCard) and extend the existing user-input card with per-question items parsed from tool_use + toolUseResult.
2. Replace the feed with the raw BubbleTranscript renderer used by the Terminal/transcript tab and drop the curated Shipwright cards.
3. Do nothing new; keep the timeline and the first-question-only Q&A display.
