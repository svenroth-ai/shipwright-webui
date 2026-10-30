# Architecture brief - M4 Agents window

Problem: in the Mission tab, a user watching a session cannot see which subagents are running, who started whom,
what prompt each was given, what it answered, or read its transcript; the chat's subrunner card only shows a one-shot report.
Data already exists: the session-info endpoint lists subagents (parent, depth, status, prompt, answer).

Options:
1. Modal window (bottom-bar chip opens it) with a two-pane tree + detail, fetching each agent's JSONL tail from a new read-only route.
2. Extend the existing right-side SubrunnerPanel/info sidebar with an agents list and no modal.
3. Do nothing new; link subrunner cards to the raw JSONL file in the existing viewer.
