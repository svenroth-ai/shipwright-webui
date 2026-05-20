# Iterate Spec: inbox-terminal-prompts

- **Run ID:** iterate-2026-05-18-inbox-terminal-prompts
- **Type:** feature
- **Complexity:** medium
- **Status:** implemented

## Goal
Make the Inbox a working answer-queue for embedded-terminal sessions: (1) clicking
an Inbox card lands with the terminal focused so the user types the answer
immediately; (2) waiting `AskUserQuestion` picker prompts — which never appear in
the JSONL and so are invisible to the current Inbox — are surfaced as a new
`terminal_prompt` row read from the live `@xterm/headless` mirror.

## Root Cause (Phase 2)
Empirically confirmed against task `234f6579-…`'s JSONL: Claude Code journals a
tool-call turn only after the tool returns. For `AskUserQuestion` "returns" =
"user answered", so the tool_use + tool_result land together, after the answer.
A *waiting* picker is never an unpaired tool_use in the JSONL — `deriveInbox`
(path A) cannot see it, and `detectAwaitingUserQuestion` (path B) bails because
the latest conversational event is the previous answered tool_result. The only
data source that reflects a live picker is the terminal output itself.

## Acceptance Criteria
- [x] **AC1** Given a pending Inbox card, when the user clicks it, then they land on
  `/tasks/:id` with the Terminal tab active AND the xterm terminal focused
  (`.xterm-helper-textarea` is `document.activeElement`) — no extra click needed.
- [x] **AC2** Given a task opened NOT from the Inbox (no `focusTerminal` nav-state),
  when TaskDetail mounts, then the terminal is not auto-focused (unchanged behavior).
- [x] **AC3** Given a task whose live embedded-terminal mirror shows an
  `AskUserQuestion` picker (footer signature present), when the client GETs
  `/api/external/inbox`, then the response includes an item with
  `kind: "terminal_prompt"` carrying `taskId`, `sessionUuid`, `taskTitle`,
  `promptText`, `bestEffort: true`.
- [x] **AC4** Given a task whose terminal shows normal output or an already-answered
  picker (no footer signature), when the inbox is derived, then no
  `terminal_prompt` item is produced for it.
- [x] **AC5** `extractTerminalPrompt(visibleText)` returns the trimmed picker block
  (capped at `MAX_QUESTION_TEXT_LEN`) when the footer signature is present in the
  bottom region, and `null` otherwise.
- [x] **AC6** Given a `terminal_prompt` item, when the Inbox renders, then a card
  shows `promptText` as escaped plain text (`pre-wrap`, line-clamped), with no
  buttons; a whole-card click navigates with the `focusTerminal` nav-state (AC1).
- [x] **AC7** Precedence per task: a pending `ask_tool` (path A) suppresses
  `terminal_prompt`; a `terminal_prompt` suppresses `text_question`.

## Spec Impact
- **Classification:** MODIFY
- **ADD:** none
- **MODIFY:**
  - **FR-01.04** (Pending interactions) — Inbox gains a `terminal_prompt` row kind;
    a card click now lands with the terminal focused. New `(E)` ACs.
  - **FR-01.13** (Pending tool_use list) — `GET /inbox` response gains a
    `terminal_prompt` kind derived from the live terminal mirror (a third
    detection source besides tool_use and text_question). New `(E)` ACs.
  - **FR-01.02** (Task detail / 3-pane viewer) — TaskDetail honors a
    `focusTerminal` navigation intent. New `(E)` AC.
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope
- In-place answering inside the Inbox (typing the answer in the Inbox card) —
  rejected: writer-role contention, blind send to an unseen pty, best-effort
  staleness; would need a separate ADR. The Inbox stays read-only.
- Navigate-and-prefill of the terminal — rejected as pointless (you can type
  directly once focused).
- Structured decomposition of picker options (individually clickable etc.) —
  the picker block is shown raw, not parsed into a model.
- Detection for sessions launched in the user's own external terminal — no
  observation channel exists (no pty, no mirror). Inherent limit.

## Design Notes
{Filled during Design Check.}
- The `terminal_prompt` card reuses the existing `TextQuestionCard` chrome:
  amber left strip, context pill (phase / task title), time-ago, "AWAITING YOUR
  REPLY" label, `promptText` rendered as escaped plain text with `white-space:
  pre-wrap` + `-webkit-line-clamp`. Read-only — no buttons. Whole-card click is
  the only affordance.

## Affected Boundaries
n/a — no serialized file format is produced or consumed. The new
`terminal_prompt` kind is an additive HTTP-JSON response variant on
`/api/external/inbox` (covered by `touches_public_api`, not a file IO boundary);
no env / config / state file is read or written by this change.

## Confidence Calibration
- **Boundaries touched:** none — no serialized file format is produced or
  consumed (see Affected Boundaries). The `/inbox` `terminal_prompt` variant
  is an additive HTTP-JSON field, covered by route integration tests.
- **Empirical probes run:**
  - `extractTerminalPrompt` vs the real AskUserQuestion-picker fixture →
    picker block extracted; preamble above the rule does NOT leak (7 tests).
  - vs ordinary shell output / empty viewport → `null`.
  - vs a stale picker (footer no longer the bottom-most line) → `null`
    (gemini-2 zombie-prompt guard).
  - vs an alternate footer separator (`|` vs `·`) → still extracts (openai-5).
  - length cap → result ≤ `MAX_QUESTION_TEXT_LEN`.
  - real `@xterm/headless` mirror: write picker → `getVisibleText()` →
    `extractTerminalPrompt` finds it; disposed mirror → `""` (4 tests, openai-4).
  - inbox route: `terminal_prompt` emitted from a mocked live mirror;
    `ask_tool` suppresses it; `terminal_prompt` supersedes `text_question`;
    no `peekTerminalText` wired → no `terminal_prompt` (5 route tests, openai-8).
  - client: `WaitingReplyCard` renders `promptText` escaped (XSS probe:
    `<img onerror>` not parsed); `focusTerminal` nav-state carried to
    `/tasks/:id`; TaskDetailPage focuses on nav-state, not on a plain open.
  - F0.5 web E2E: real stack — Inbox card click → TaskDetail → Terminal tab
    active → `.xterm-helper-textarea` is `document.activeElement` (AC1).
- **Edge cases NOT probed + why acceptable:**
  - Picker taller than the viewport (top truncated) — footer + options +
    question still captured; clicking shows the full picker in the real
    terminal.
  - Footer wrapped across 3+ lines on an extremely narrow terminal — yields
    `null` (graceful: no `terminal_prompt`); real terminals are ≥80 cols.
  - Concurrent mirror disposal mid-read — `peekTerminalText` is synchronous
    (no await between `entries.get` and `getVisibleText`); `getVisibleText`
    is disposed-guarded + try/catch. No race window.
- **Confidence-pattern check:** no "are you confident?"-yes-then-bug pattern
  fired. The pre-build external review reshaped the detector (footer-bottom-most
  guard, conservative bounds); the post-build external code review (openai-1
  silent-catch → logged, openai-3 test strengthened) was a second empirical pass.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts client/e2e/flows/inbox-terminal-prompts.spec.ts` against an isolated server (temp `USERPROFILE`, `SHIPWRIGHT_NETWORK_PROFILE=local`).
- **Evidence path:** `client/playwright-report/index.html` + `.shipwright/runs/iterate-2026-05-18-inbox-terminal-prompts/surface_verification.json`
- **Justification (surface≠none):** n/a
