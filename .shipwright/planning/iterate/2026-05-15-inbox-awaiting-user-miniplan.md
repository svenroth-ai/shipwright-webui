# Mini-Plan: inbox-awaiting-user

- **Run ID:** iterate-20260515-inbox-awaiting-user
- **Spec:** `.shipwright/planning/iterate/2026-05-15-inbox-awaiting-user.md`

## Approach (chosen)

Add a second, deterministic detection path to the Inbox alongside the existing
`AskUserQuestion` tool_use path. A session is "awaiting user" via plain text
when its **latest conversational turn** is an assistant message that ended the
turn (no `tool_use` block, no `user` event after it) and whose trailing text
looks like a request for input — ends with `?` **or** contains an enumerated
option list. The two paths are naturally mutually exclusive: a pending AUQ
means the last assistant event carries a `tool_use`, which the text path
rejects.

Detection is content-only (pure function over already-parsed JSONL events) so
the existing mtime-keyed derive cache invalidates it for free.

## Work breakdown

### Server
1. `core/inbox-derive.ts` — new exported `detectAwaitingUserQuestion(events)`:
   - Walk events from the end, skipping non-conversational kinds
     (`attachment`, `system`, `file-history-snapshot`, `ai-title`,
     `custom-title`, `agent-name`, `permission-mode`, `queue-operation`,
     `last-prompt`, `unknown`).
   - First conversational event is `user` → return `null`.
   - It is `assistant` → collect the trailing assistant turn (consecutive
     assistant events back to the last `user`). If any carries a `tool_use`
     block → return `null` (mid-action / AUQ handled by `deriveInbox`).
     Otherwise concatenate `text` blocks; test the last non-empty text with
     `looksLikeQuestion()`.
   - `looksLikeQuestion(text)` = trimmed ends with `?` **OR** ≥2 lines match
     a numbered/lettered list pattern (`^\s*(?:[-*]\s*)?(?:\*\*)?\d+[.)]` or
     `^\s*[a-z][.)]\s`).
   - Return `{ id: assistantEvent.uuid, questionText }` (id = the JSONL event
     uuid — stable synthetic id; no dismiss machinery needed).
2. `external/routes.ts` — `/api/external/inbox`:
   - `AggregatedEntry` + `InboxDeriveCacheEntry.entries` gain
     `kind: "ask_tool" | "text_question"` and `questionText?: string`.
   - Cold path: after `deriveInbox`, if `result.pending` is empty for the
     session, also run `detectAwaitingUserQuestion`; on a hit push a
     `text_question` entry (and cache it). AUQ entries get `kind: "ask_tool"`.
   - Warm path: reconstruct `out` rows including `kind`/`questionText`.
   - `pendingToolUseIds` persistence stays AUQ-only (text questions are
     recomputed each derive — self-clearing, no dismissed set).

### Client
3. `lib/externalApi.ts` — `InboxItem` gains `kind: "ask_tool" | "text_question"`
   and `questionText?: string`. Text-question items carry `toolName: ""`,
   `input: null`, `toolUseId` = synthetic uuid.
4. `pages/InboxPage.tsx` — `InboxCard` branches on `item.kind`:
   - `text_question` → render `questionText` (`white-space: pre-wrap`, line-
     clamped) so numbered menus keep their layout; no option chips, no
     Answer/dismiss button; keep card chrome + click-through to TaskDetail.
   - `ask_tool` → unchanged.
5. Sidebar Inbox badge: verify `inboxCount` already counts all items (expected
   no code change — AC-7 is a verification, not an edit).

### Tests
6. `core/inbox-derive.test.ts` — unit tests for `detectAwaitingUserQuestion`
   per AC-1..5, incl. false-positive guards (AC-4: trailing `tool_use`;
   trailing `user`; non-question text).
7. Inbox route test — assert `kind` discriminant on both entry types.
8. `pages/InboxPage.test.tsx` — render a `text_question` item: question text
   shown, no chips, no dismiss.
9. `client/e2e/flows/inbox-awaiting-user.spec.ts` — author + run (F0.5
   surface=web): seed a fixture JSONL whose last turn is a text question →
   `/inbox` shows the card → append a user reply → card clears.

### Spec / docs
10. `spec.md` FR-01.04 + FR-01.13 — extend descriptions + append `(E)` ACs.
11. `architecture.md` Data Flow — extend the `inbox-derive.ts` sentence.

## Test strategy

TDD: RED unit tests for `detectAwaitingUserQuestion` first (fixture event
arrays per AC), then implement. Full client + server unit suites at F0.
E2E authored and executed against the dev stack at F0.5 (surface=web).

## Files (~8 + 4 test/spec)

`server/src/core/inbox-derive.ts`, `server/src/external/routes.ts`,
`client/src/lib/externalApi.ts`, `client/src/pages/InboxPage.tsx`,
`server/src/core/inbox-derive.test.ts`, inbox route test,
`client/src/pages/InboxPage.test.tsx`,
`client/e2e/flows/inbox-awaiting-user.spec.ts`,
`.shipwright/planning/01-adopted/spec.md`,
`.shipwright/agent_docs/architecture.md`.

## Alternatives considered

- **B — every idle session is "awaiting user"** (last assistant turn ended,
  no question-shape test). Rejected: floods the Inbox with every
  launched-but-not-closed task; the user explicitly chose Conservative.
- **C — only widen the tool allowlist / no plain-text path.** Rejected:
  plain-text questions have no `tool_use` block at all, so this catches
  nothing of the reported problem.

## Risks

- False positives — an assistant turn that ends with a rhetorical `?` or a
  numbered list that is a *report*, not a prompt. Bounded by the precision
  guard (must be the genuine latest turn, turn-ended, unanswered) and the
  Inbox's explicit "best-effort" labeling. Self-clears on the next user turn.

## External review triage (openrouter: openai + gemini, 16 findings)

All findings folded into the build; key decisions:

1. **(OpenAI#8 HIGH-ish) Proper discriminated union.** `InboxItem` becomes
   `AskToolInboxItem | TextQuestionInboxItem` keyed on `kind`. `text_question`
   carries `questionId` + `questionText` only — NO fake `toolName:""` /
   `input:null`. No AUQ-field leakage.
2. **(OpenAI#3 + Gemini mid-list) End-anchored heuristic.** Run detection on
   the assembled trailing-turn text, examining the last ~8 non-empty lines:
   flag on a `?`-line or a list-item run; **disqualify if substantial prose
   (> ~80 non-list chars) follows the signal** — kills the "list mid-report,
   turn ends with 'The report is complete.'" false positive while still
   catching a short closer ("Let me know.").
3. **(OpenAI#4 + Gemini regex) Tolerant regexes.** `?`-end allows trailing
   quotes / `**` / `)` / emoji (`/\?["'»”’*`)\]\s\p{Emoji}]*$/u`); list-item
   matches `1.` `2)` `**1.**` `a)` `b.`.
4. **(Gemini code-block) Strip code.** Fenced ```` ``` ```` blocks + inline
   backtick spans are stripped before the heuristic — avoids SQL `?` /
   ternary false positives.
5. **(OpenAI#5) Centralized precedence.** A single `inbox-derive.ts` function
   returns `{ pending, textQuestion }` with `textQuestion` already suppressed
   when `pending` is non-empty. The route does not re-implement the policy.
6. **(OpenAI#6) Allowlist, not denylist.** "Conversational" = `kind` is
   `user` or `assistant`; everything else is skipped. Drift-proof vs new
   event kinds. Tested with interleaved metadata events.
7. **(OpenAI#7) Narrow mid-action guard.** Only the **last** assistant event
   is checked for a `tool_use` block (a tool_use is always followed by a
   `user` tool_result, so it cannot precede trailing text within one turn).
8. **(OpenAI#2) Identity.** `questionId` = uuid of the **last** assistant
   event of the trailing turn. Documented + tested for multi-event turns.
9. **(OpenAI#9) Auto-clear semantics.** The last conversational event being
   `user` of ANY kind (real message OR tool_result) → no row. Tested both.
10. **(OpenAI#11 + Gemini security) `questionText` hardening.** Capped at
    2000 chars server-side; rendered as escaped plain-text React children
    (`white-space: pre-wrap`, line-clamped) — never markdown/HTML.
    Adversarial test (`<script>`, huge multiline text).
11. **(OpenAI#1) Consumer sweep.** Grep all inbox-item consumers (badge,
    mocks, fixtures, tests) before finalizing — branch on `kind`.
12. **(OpenAI#10 + Gemini cache) No cache migration.** `inboxDeriveCache` is
    an in-memory module `Map`, flushed on every server restart/deploy — no
    disk-persisted legacy entries exist. Noted in Self-Review.
