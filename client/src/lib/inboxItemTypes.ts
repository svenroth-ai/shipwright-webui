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

export type InboxItem =
  | AskToolInboxItem
  | TextQuestionInboxItem
  | TerminalPromptInboxItem
  | LeadQuestionInboxItem;
