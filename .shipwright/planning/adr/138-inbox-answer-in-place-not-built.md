# ADR — Answering Claude's mid-run question from the Inbox: spiked, measured, NOT built

- **Run-ID:** iterate-2026-07-22-inbox-answer-spike-decision
- **Date:** 2026-07-22
- **Section:** Iterate — decision record (no code change)
- **Triage:** `trg-4c020c34` (supersedes `trg-475219a0`, `trg-28af7d90`)
- **Complexity:** small · **change_type:** change · **spec_impact:** none
- **Prereq shipped:** A19 honest terminal fallback — `#278`, FR-01.63

## Context

When Claude stops mid-run to ask something (`AskUserQuestion`), the Inbox
surfaces the question and offers "Answer in the terminal" (A19, `#278`). The
deferred half — answering *without leaving the Inbox* — was parked at
`trg-4c020c34` with an explicit instruction: **the first task is a 5-minute
spike, not an ADR.** Claude renders its options numbered `1. 2. 3.`; if the TUI
accepts a numeric hotkey the write becomes stateless and deterministic and the
feature collapses from "hard and risky" to "small and safe".

Two rationales were explicitly ruled OUT of bounds before the work started, and
both remain ruled out by this ADR:

- **The architecture fence is NOT the reason.** `TerminalKeyBar.tsx` already
  sends Esc / Tab / arrows / Ctrl-C / Enter into a live Claude TUI over the same
  `socket.send({type:"data",payload})` writer frame as the user's own
  keystrokes; `useAutoLaunch.ts` does likewise. Rule 1 / DO-NOT #17 govern
  **spawning** (the pty target must be a whitelisted shell, never `claude`), not
  keystrokes into an existing pty. Any future reviewer reaching for the fence
  argument here is falsifying it in one grep — do not restore it.
- **"The transcript carries which option is selected" is false.** The options
  are structured in the JSONL; the TUI cursor position is ephemeral screen state
  and is never persisted.

## Empirical basis (spike, real `claude` v2.1.217 driven through a real pty)

Method: `@lydell/node-pty` spawn, prompt forced an `AskUserQuestion`, screen
reconstructed with `@xterm/headless` (the same mirror primitive as ADR-088 —
a raw byte tail is NOT a screen under `CLAUDE_CODE_NO_FLICKER` partial redraws).

| Shape | Pressing a digit | Verdict |
|---|---|---|
| 1 question, `multiSelect:false` | **commits instantly**, no Enter (`… → BRAVOWORD`) | reliable, 1 byte |
| 1 question, `multiSelect:true` | **toggles** a checkbox; UI stays open; needs a separate Submit | NOT one click |
| 2+ questions (the "tabs") | answers current Q, **auto-advances**, then a **review screen** (`1. Submit answers / 2. Cancel`) | a sequence, not a byte |

Structural findings:

1. **Digit ↔ option mapping is exact.** Options render `1..N` in payload order.
   The TUI appends its OWN entries *after* them (`Type something.`,
   `Chat about this`), so digit `N` = `options[N-1]` for real options only.
   Digits are 1–9; a 10th option has no hotkey.
2. **Multi-question renders a tab bar** (`← ☐ Color ☐ Animal ✔ Submit →`) and a
   different footer (`Tab/Arrow keys to navigate`) than the single-question case
   (`↑/↓ to navigate`).
3. **The blind-write hazard is real and silent — reproduced by accident.** In one
   run a subsequent prompt was typed into a still-open multiSelect UI and its
   digits silently toggled checkboxes. A mistimed digit does not error: it flips
   a checkbox, or lands as stray text in the composer.
4. `CLAUDE_CODE_CHILD_SESSION` suppressed JSONL entirely in the spike sessions,
   so "confirm the answer landed via `tool_result`" needs a no-transcript path.

## Channel research (documentation, not speculation)

There is **no supported programmatic channel** for an external observer to
answer `AskUserQuestion` in a session it does not host:

| Channel | Verdict |
|---|---|
| Hooks | No hook fires for `AskUserQuestion`. `PostToolUse` can only rewrite an *existing* result; the tool blocks awaiting input, so there is none. |
| `--input-format stream-json` | Output-only; no published input schema, no tool-result injection. |
| Local IPC / socket / control file | None exists. |
| Agent view / `claude attach` | Anthropic's own answer — but it works by **hosting the session**. No third-party API. |
| Agent SDK `canUseTool` | Fully structured and reliable for every shape — **requires spawning and owning the Claude process.** |

## Decision

**Do not build the Inbox write-path.** The Inbox keeps A19's honest
"Answer in the terminal" hand-off.

Reasoning, in the order that actually decided it:

1. **It is not reliable for all cases.** Two of the three question shapes cannot
   be answered by one click. A button that half-answers — leaving the session
   parked on a review screen or a toggled checkbox — is worse than no button,
   because the failure is silent and the operator has no way to see it from the
   Inbox.
2. **Making it reliable requires screen-scraping the TUI as a state oracle.** We
   *could* close the loop with the existing `headless-mirror.ts`: read the
   screen, confirm the expected UI, send, confirm the transition, abort to the
   terminal on mismatch. Rejected — that couples us to Claude's *rendered
   layout*, which is not an API, changes across versions, and drifts silently.
   The drift lands exactly on the #1 named risk: a wrong write into a live
   session.
3. **The one architecture that makes this fully reliable is the one we
   deliberately do not have** (webui hosting sessions via the Agent SDK). That is
   a separate, larger decision about the external-launch model — not a
   side-effect of an Inbox feature.

**Chesterton-Fence:** A19's guard `client/src/pages/inbox/inbox-no-writepath.test.ts`
stays **exactly as shipped**. This ADR is now its recorded rationale: the guard
holds because there is no reliable channel, *not* because of rule 1.

**Re-Review-Date:** 2027-01-31, or earlier on either trigger —
(a) Claude Code exposes a documented API/IPC for answering a session it hosts
for us, or (b) we decide independently that Command Center should host sessions.

## Consequences

- No code change. No new surface, no spec/FR change, no baseline moves.
- `trg-4c020c34` is dismissed as decided (not deferred) and points here.
- The spike is recorded so the next person does not re-run it. If the question
  reopens, the cheap part is already done: the digit mapping, the three shapes,
  and the channel research above.
- **YAGNI:** the capability was wanted, was specced twice, and still does not pay
  for its failure mode. Recording *why* is the deliverable.
