# Mini-Plan: inbox-terminal-prompts

- **Run ID:** iterate-2026-05-18-inbox-terminal-prompts
- **Complexity:** medium · **Type:** feature

## Approach

Two phases, shipped in one iterate/PR. Phase 1 is small and independent;
Phase 2 is the substantive feature and reuses Phase 1's nav-state.

### Phase 1 — Terminal autofocus on Inbox click
Reuse the existing `pendingFocus` → `handleTerminalReady` → `terminalRef.focus()`
path (today only triggered by `coord.pendingLaunch`). Add a second trigger:
React-Router nav-state `{ focusTerminal: true }` set by the Inbox cards, read
once (ref-guarded) by `TaskDetailPage`.

### Phase 2 — `terminal_prompt` Inbox kind from the live terminal mirror
The JSONL cannot reveal a waiting `AskUserQuestion` picker (see spec Root Cause).
The pty-manager already keeps a per-task `@xterm/headless` mirror. Add a read
accessor, a pure detector that recognizes the picker by its stable footer
signature and extracts the visible picker block, and wire it as a third inbox
detection source. The block is shown raw, reusing the `text_question` card.

## File-by-file

**Phase 1 (client)**
- `client/src/pages/InboxPage.tsx` — 4 `navigate(\`/tasks/${id}\`)` calls →
  add `{ state: { focusTerminal: true } }` (AskToolCard + TextQuestionCard,
  click + keydown).
- `client/src/pages/TaskDetailPage.tsx` — import `useLocation`; ref-guarded
  effect reads `location.state.focusTerminal` → `setCenterTab("terminal")` +
  `setPendingFocus(true)`.

**Phase 2 (server)**
- `server/src/terminal/headless-mirror.ts` — NEW `getVisibleText(): string`
  (read active-buffer viewport rows as plain text).
- `server/src/terminal/pty-manager.ts` — NEW `peekTerminalText(taskId): string
  | null` (delegates to `entry.mirror.getVisibleText()`; null when no live
  mirror; never throws).
- `server/src/core/terminal-prompt-detect.ts` — NEW pure
  `extractTerminalPrompt(visibleText): string | null`. Footer signature
  (`Enter to select` + `Esc to cancel`/`Tab/Arrow keys`) in the bottom ~30
  lines → collect the block upward (blank-gap or ~20-line cap), trim, cap at
  `MAX_QUESTION_TEXT_LEN`. Else `null`.
- `server/src/external/routes.ts` — `GET /api/external/inbox`: per non-terminal
  task call `peekTerminalText` + `extractTerminalPrompt`; emit `terminal_prompt`
  item; extend the inline response union. Runs every poll (live state, outside
  the JSONL mtime cache). Precedence: `ask_tool` > `terminal_prompt` >
  `text_question`.
- `server/src/index.ts` — pass the shared `PtyManager` instance into the
  external-routes registration so the inbox handler can query it.
- `server/src/terminal/fixtures/askuserquestion-picker.log` — NEW captured
  picker byte-stream fixture.
- `server/src/core/terminal-prompt-detect.test.ts` — NEW unit test.

**Phase 2 (client)**
- `client/src/lib/externalApi.ts` — add `TerminalPromptInboxItem` to the
  `InboxItem` union (`kind: "terminal_prompt"`, `+ promptText: string`).
- `client/src/pages/InboxPage.tsx` — `InboxCard` dispatch + new
  `TerminalPromptCard` (reuses `TextQuestionCard` chrome; whole-card click uses
  the focusTerminal nav-state).

**Docs**
- `CLAUDE.md` — one-line note: inbox now also derives from the live terminal
  mirror (`terminal_prompt`).
- `CHANGELOG-unreleased.d/` — F4 drop files (Added + Changed).

## Test strategy
- **Unit (server vitest):** `extractTerminalPrompt` against the picker fixture
  (→ block), ordinary shell output (→ null), answered/collapsed picker (→ null),
  length-cap. Inbox route: `terminal_prompt` emitted when the mirror shows a
  picker (mock `peekTerminalText`); precedence rules (AC7).
- **Unit (client vitest):** `TaskDetailPage` focus effect fires on
  `focusTerminal` nav-state; `InboxPage` renders `TerminalPromptCard` for a
  `terminal_prompt` item.
- **E2E (Playwright):** `client/e2e/flows/inbox-terminal-prompts.spec.ts` —
  AC1 (click card → terminal focused) + AC3/AC6 (terminal_prompt card appears,
  shows text). Isolated server (temp `USERPROFILE`, `SHIPWRIGHT_NETWORK_PROFILE=local`).
- **Full suite** at F0 (medium + `touches_shared_infra`).

## Alternative considered
**Marker-only `terminal_prompt`** (card says "Claude is waiting" with no question
text). Rejected after user feedback: the headless mirror already yields decoded
cell text, so extracting the picker block is a simple text-region cut — barely
more code than a boolean, and far more useful (the user sees the question). The
brittleness (footer-signature dependency) is identical either way.

**In-place answering in the Inbox.** Rejected — see spec Out of Scope.
