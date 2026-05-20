# Code Review — iterate-20260515-inbox-awaiting-user

- **Mode:** external code review (openrouter: openai + gemini) over the
  finalized inbox-only diff (`--mode code`), 2026-05-15.
- **Diff scope:** 7 inbox files (inbox-derive{,.test}, external/routes{,.test},
  externalApi, InboxPage{,.test}) + e2e spec. Triage changes excluded.

## Findings triage

### #1 — OpenAI HIGH (bug) — REJECTED (premise empirically falsified)

Claim: `detectAwaitingUserQuestion()` could surface a `text_question` for an
assistant turn that carries a `tool_result` block, because "tool_result is
often emitted as an assistant event".

Empirical probe (real JSONL — `d5b4466a` + `e7113f6b`, 950 events):
- `tool_result` blocks in **assistant** events: **0**
- `tool_result` blocks in **user** events: **218**
- non-text / non-tool_use blocks in assistant events: only `thinking` (148×)

The premise is false — `tool_result` is exclusively a user-role block in
Claude Code JSONL. Moreover OpenAI's suggested fix ("require the trailing
assistant turn contain only text blocks") would REGRESS: assistant events
legitimately carry `thinking` blocks (148 observed); a text-only gate would
false-negative every question turn preceded by a thinking block.
`assistantHasToolUse()` + `assistantTextBlocks()` (extract text, ignore the
rest) is the correct design. No change.

### #2 — OpenAI MEDIUM (spec) — FIXED

The InboxPage test "ask_tool and text_question coexist in one session"
codified a state the server cannot produce (AC-5 precedence: a pending
tool_use suppresses the text question for that session). Reframed to two
SEPARATE sessions — proves the `InboxCard` dispatcher handles a mixed
aggregate inbox without asserting an impossible single-session state.

### #3 — OpenAI MEDIUM (test) — FIXED

E2E only exercised the `?`-terminated path; AC-2 (numbered/lettered list
without `?`) had unit coverage but no e2e. Added a second e2e test seeding
a 3-item numbered option list with no trailing `?`.

### #4 — OpenAI MEDIUM (test) — FIXED

No test asserted AC-7 (sidebar Inbox badge count includes `text_question`
items). Added `MainLayout.test.tsx` case wiring a mixed ask_tool +
text_question inbox and asserting the badge renders count "2".

## Gemini

Response returned truncated/garbled (mid-sentence, no structured findings).
Not actionable; OpenAI's structured review carried the triage.

## Outcome

ship — 1 finding rejected with empirical evidence, 3 fixed. All inbox unit
suites + 2 e2e tests green post-fix.
