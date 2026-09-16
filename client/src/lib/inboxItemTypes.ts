/*
 * inboxItemTypes.ts — the InboxItem discriminated union, split out of
 * externalApi.ts (grandfathered at the bloat ceiling,
 * shipwright_bloat_baseline.json) rather than growing that file further.
 * Re-exported from externalApi.ts so existing import sites are unaffected.
 */
import type { LeadQuestionInboxItem } from "./leadQuestionApi";

/**
 * A pending Inbox interaction. Discriminated union on `kind` (iterate
 * 2026-05-15 inbox-awaiting-user):
 *  - `ask_tool` — an unanswered `AskUserQuestion` (or other allowlisted)
 *    tool_use, dismissable.
 *  - `text_question` — a plain-text end-of-turn question Claude printed in
 *    the terminal with no tool_use block. Carries only the detected text;
 *    auto-clears on the next user reply (no dismiss action).
 *  - `terminal_prompt` — a waiting picker detected in the live terminal
 *    mirror; read-only, auto-clears once answered.
 *  - `lead_question` (`./leadQuestionApi.ts`) — WRITTEN, not derived; no
 *    `bestEffort` (hence the base/common split below).
 *  - `codex_watcher` (Codex Light AC6) — an ephemeral notice from
 *    `CodexTaskWatcher` (nudge sent, delivery error, unresolved
 *    no_oracle self-check, failed launch confirmation). Informational —
 *    no reply is required.
 *  - `codex_approval` (Codex Light §5.3) — a pending Codex approval dialog
 *    detected in the live terminal; read-only, auto-clears once answered
 *    — same shape/semantics as `terminal_prompt`, just Codex's own prompt
 *    text instead of a Claude `AskUserQuestion` picker.
 *  - `codex_error` (Codex Light §5.3) — a Codex-reported structured error
 *    (turn abort, rate limit, etc.) detected in the live terminal.
 *    Informational — no reply is required.
 */
export interface InboxItemBase {
  taskId: string;
  sessionUuid: string;
  taskTitle: string;
}
interface InboxItemCommon extends InboxItemBase {
  bestEffort: true;
}

export interface AskToolInboxItem extends InboxItemCommon {
  kind: "ask_tool";
  toolUseId: string;
  toolName: string;
  input: unknown;
}

export interface TextQuestionInboxItem extends InboxItemCommon {
  kind: "text_question";
  /** uuid of the trailing turn's last assistant event — stable id. */
  questionId: string;
  /** Detected question text, server-capped at 2000 chars. */
  questionText: string;
}

/**
 * iterate-2026-05-18-inbox-terminal-prompts — a waiting AskUserQuestion
 * picker detected in the LIVE embedded-terminal mirror. A waiting picker
 * never appears in the JSONL (Claude Code journals a tool turn only after
 * it returns), so this is derived from the terminal viewport, not the
 * transcript. Read-only; auto-clears once the picker is answered.
 */
export interface TerminalPromptInboxItem extends InboxItemCommon {
  kind: "terminal_prompt";
  /** Visible picker block (question + options + footer), capped at 2000. */
  promptText: string;
}

/** Codex Light AC6 — mirrors the server's `codex_watcher` AggregatedEntry
 *  kind (`server/src/external/inbox/_codex.ts`). */
export interface CodexWatcherInboxItem extends InboxItemCommon {
  kind: "codex_watcher";
  noticeKind:
    | "nudge_sent"
    | "delivery_error"
    | "no_oracle_unresolved"
    | "launch_confirmation_failed";
  detail: string;
}

/** Codex Light §5.3 — mirrors the server's `codex_approval` AggregatedEntry
 *  kind. Same read-only, terminal-answered semantics as `terminal_prompt`. */
export interface CodexApprovalInboxItem extends InboxItemCommon {
  kind: "codex_approval";
  promptText: string;
}

/** Codex Light §5.3 — mirrors the server's `codex_error` AggregatedEntry
 *  kind. Informational — no reply is required. */
export interface CodexErrorInboxItem extends InboxItemCommon {
  kind: "codex_error";
  errorText: string;
}

export type InboxItem =
  | AskToolInboxItem
  | TextQuestionInboxItem
  | TerminalPromptInboxItem
  | LeadQuestionInboxItem
  | CodexWatcherInboxItem
  | CodexApprovalInboxItem
  | CodexErrorInboxItem;
