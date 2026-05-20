# Iterate Spec: inbox-awaiting-user

- **Run ID:** iterate-20260515-inbox-awaiting-user
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal

The Inbox surfaces a pending interaction only for an unanswered `AskUserQuestion`
tool_use. In an interactive Claude Code TUI session — which is what the embedded
terminal hosts — Claude usually asks "how should I proceed?" as **plain
assistant text** (a conversational question or a numbered option-menu printed by
a Shipwright skill), with no `tool_use` block. `inbox-derive.ts` is structurally
blind to those. Extend Inbox detection so a session whose latest turn is an
assistant message asking the user a question (text ending in `?` **or** a
numbered/lettered option list) is surfaced as a pending interaction that
auto-clears the moment the user replies.

## Acceptance Criteria

- [ ] AC-1: Given a session whose last conversational turn is an assistant text
      message ending with `?` and no `user` event after it, when the client GETs
      `/api/external/inbox`, then the response includes one item for that
      session with `kind: "text_question"` and the question text.
- [ ] AC-2: Given a session whose last assistant turn presents a numbered or
      lettered option list (≥2 enumerated lines, e.g. `1.`/`2.` or `**1.**`/
      `a)`) and no `user` event after it, when the client GETs the inbox, then
      it is surfaced as a `text_question` item even when the text does not end
      with `?`.
- [ ] AC-3: Given a `text_question` item is showing, when the user replies in
      the terminal (a `user` event is appended after the assistant turn), then
      the next inbox derivation no longer includes that item (auto-clear; no
      dismiss action).
- [ ] AC-4: Given a session whose last assistant event contains a `tool_use`
      block (Claude is mid-action) or whose last conversational event is a
      `user` message, when the inbox is derived, then NO `text_question` item is
      produced for it (precision guard — only genuine end-of-turn waits count).
- [ ] AC-5: Given a session with an unanswered `AskUserQuestion` tool_use, when
      the inbox is derived, then it is still surfaced exactly as today
      (`kind: "ask_tool"`) — existing behavior is preserved, not duplicated by a
      `text_question` row for the same turn.
- [ ] AC-6: Given a `text_question` item, when it renders on `/inbox`, then the
      card shows the question text and the project/task context, links through
      to TaskDetail, and shows no option chips and no dismiss button.
- [ ] AC-7: The sidebar Inbox badge count includes `text_question` items
      (passive notification that a session is waiting).

## Affected FRs

- **FR-01.04** (Pending interactions, cross-project): extend — the Inbox now
  also surfaces plain-text end-of-turn questions, not only `AskUserQuestion`.
- **FR-01.13** (Pending tool_use list GET): extend — `inbox-derive` additionally
  walks for an idle assistant turn that asks a question; response items gain a
  `kind` discriminant (`ask_tool` | `text_question`).

## Out of Scope

- Manual dismiss for `text_question` rows — they auto-clear when answered
  (user decision, this run). FR-01.14 / the dismiss endpoint stay AUQ-only.
- Permission prompts (`Bash`/`Edit`/`Write` tool_use awaiting approval) — still
  deliberately excluded from the allowlist; not part of "how should I proceed".
- Natural-language intent classification of questions — detection stays a
  cheap, deterministic heuristic (`?`-terminated or enumerated list).
- Desktop/OS notifications or sound — the sidebar badge is the only signal.
- Changing the `AskUserQuestion` detection path or its pending-window behavior.

## Design Notes

UI change is additive: `InboxCard` gains a `kind: "text_question"` branch —
same card chrome (amber left-strip, context pill, time-ago, click-through to
TaskDetail) but renders the detected question text in place of the AUQ
header/question/option-chips, and omits the dismiss/Answer button. No new
mockup; reuses existing Inbox visual tokens. Tier-2 design check (markdown
description) only.

## Affected Boundaries

n/a — no serialized format is read or written by this change. `inbox-derive`
remains a pure read of already-parsed JSONL events; no new file I/O, no env,
no config. The `touches_io_boundary` risk flag does not fire.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a |

## Confidence Calibration

- **Boundaries touched:** none (see Affected Boundaries — n/a).
- **Empirical probes run:** (populated before F0)
  - Probe: real JSONL scan of 8 recent sessions for AUQ resolution + plain-text
    question turns — DONE during Repo Scout (AUQ all resolved; 2/2/7 plain-text
    `?` turns found; AUQ tool_use shape verified, line 124→125, 105 s window).
  - Probe: detection function unit-tested against fixture JSONL covering each
    AC including the false-positive guards (AC-4) — to run in Build.
- **Edge cases NOT probed + why acceptable:** (populated in Build/Self-Review)
- **Confidence-pattern check:** no "are you confident?" yes-then-bug pattern
  has fired in this run.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `npx playwright test e2e/flows/<inbox-awaiting-user>.spec.ts`
  (run from `client/`, against the dev stack).
- **Evidence path:** `client/playwright-report/index.html`
- **Justification (only if surface=none):** n/a — Inbox is a UI surface.
