/*
 * Inbox derivation — surfaces pending interactions from the session JSONL.
 *
 * Input:  parsed events (from session-parser) + the set of tool names we
 *         consider "user-blocking" (allowlist).
 * Output: tool_use ids whose matching tool_result has NOT yet appeared,
 *         filtered by the allowlist. These are surfaced to the user as
 *         inbox entries ("Waiting for you to answer in your chat client").
 *
 * Rationale for allowlist (GPT MAJOR 8): plain long-running tools like
 * `Bash` open-ended commands aren't user-blocking — they finish on their
 * own. Only a narrow set is: AskUserQuestion + plugin-registered ones.
 *
 * Labelled "best-effort" in the UI per round-3 integration: tool_use
 * without matching tool_result is a heuristic, not a semantic contract.
 *
 * Persisted state lives in the SdkSessionsStore per task:
 *   - `pendingToolUseIds` — currently unresolved ids
 *   - `dismissedToolUseIds` — user clicked "Dismiss" on a false positive
 *   - `lastProcessedByteOffset` — incremental marker (unused in v1
 *      because deriveInbox reparses from top; kept as the field the
 *      Sub-iterate 1 fastpath will use)
 */

import type { ParsedSessionEvent } from "./session-parser.js";
import { extractToolResults, extractToolUses } from "./session-parser.js";

export const DEFAULT_USER_BLOCKING_TOOLS = new Set<string>(["AskUserQuestion"]);

export interface DeriveInboxArgs {
  events: ParsedSessionEvent[];
  allowlist?: Set<string>;
  /** Ids the user explicitly dismissed; never resurface. */
  dismissed?: Set<string>;
}

export interface InboxEntry {
  toolUseId: string;
  toolName: string;
  input: unknown;
  /** Assistant event index in `events`. */
  atAssistantEvent: number;
}

export interface DeriveInboxResult {
  pending: InboxEntry[];
  /** All tool_use ids (blocking + non-blocking) seen; diagnostics only. */
  allToolUseIds: string[];
  /** Resolved ids (had matching tool_result). Useful to shrink the store. */
  resolvedToolUseIds: string[];
}

export function deriveInbox(args: DeriveInboxArgs): DeriveInboxResult {
  const allowlist = args.allowlist ?? DEFAULT_USER_BLOCKING_TOOLS;
  const dismissed = args.dismissed ?? new Set<string>();
  const uses = extractToolUses(args.events);
  const results = extractToolResults(args.events);
  const resolvedIds = new Set(results.map((r) => r.toolUseId));

  const pending: InboxEntry[] = [];
  for (const u of uses) {
    if (resolvedIds.has(u.id)) continue;
    if (dismissed.has(u.id)) continue;
    if (!allowlist.has(u.name)) continue;
    pending.push({
      toolUseId: u.id,
      toolName: u.name,
      input: u.input,
      atAssistantEvent: u.atAssistantEvent,
    });
  }

  return {
    pending,
    allToolUseIds: uses.map((u) => u.id),
    resolvedToolUseIds: Array.from(resolvedIds),
  };
}

// ---------- plain-text "awaiting user" detection (iterate-2026-05-15) ----------
//
// `deriveInbox` only sees structured `AskUserQuestion` tool_use blocks. In an
// interactive Claude Code TUI session — exactly what the embedded terminal
// hosts — Claude usually asks "how should I proceed?" as plain assistant text
// at the end of a turn (a conversational question or a numbered option-menu),
// with no tool_use block at all. `detectAwaitingUserQuestion` surfaces those:
// a session whose LATEST conversational turn is a turn-ended assistant message
// (no trailing tool_use, no user reply after it) whose text reads as a request
// for input. Detection is content-only — pure over already-parsed events — so
// the route's mtime-keyed derive cache invalidates it for free.

/** Max chars of detected question text surfaced to the inbox (length cap). */
export const MAX_QUESTION_TEXT_LEN = 2000;

export interface TextQuestion {
  /** uuid of the LAST assistant event of the trailing turn — stable id. */
  questionId: string;
  /** Detected question text, capped at MAX_QUESTION_TEXT_LEN. */
  questionText: string;
  /** Index in `events` of that last assistant event. */
  atAssistantEvent: number;
}

export interface DeriveSessionInboxResult extends DeriveInboxResult {
  /**
   * Set when the session's latest turn is an unanswered plain-text question
   * AND no tool_use is pending (a pending tool_use always wins — see
   * `deriveSessionInbox`).
   */
  textQuestion: TextQuestion | null;
}

/** Allowlist (not denylist) — only user/assistant events bound a "turn". */
function isConversational(e: ParsedSessionEvent): boolean {
  return e.kind === "user" || e.kind === "assistant";
}

function assistantHasToolUse(e: ParsedSessionEvent): boolean {
  if (e.kind !== "assistant" || !Array.isArray(e.content)) return false;
  return e.content.some(
    (b) =>
      b != null &&
      typeof b === "object" &&
      (b as { type?: unknown }).type === "tool_use",
  );
}

function assistantTextBlocks(e: ParsedSessionEvent): string[] {
  if (e.kind !== "assistant" || !Array.isArray(e.content)) return [];
  const out: string[] = [];
  for (const b of e.content) {
    if (b != null && typeof b === "object") {
      const bb = b as { type?: unknown; text?: unknown };
      if (bb.type === "text" && typeof bb.text === "string") out.push(bb.text);
    }
  }
  return out;
}

/** Drop fenced ```code``` blocks + inline `code` spans before the heuristic. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

const LIST_ITEM_RE = /^(?:[-*]\s+)?(?:\*\*|__)?\s*(?:\d{1,3}|[a-zA-Z])[.)]/;

function isListItem(line: string): boolean {
  return LIST_ITEM_RE.test(line);
}

function endsWithQuestionMark(line: string): boolean {
  // Strip trailing decoration (whitespace, quotes, markdown emphasis, closing
  // brackets, pictographic emoji) before testing — LLM output often closes a
  // question with `?**`, `?"`, `? 🤔`, etc.
  const cleaned = line.replace(
    /[\s"'«»“”‘’*_`~)\]}>\p{Extended_Pictographic}]+$/u,
    "",
  );
  return cleaned.endsWith("?");
}

/** A non-list prose line longer than this, sitting AFTER an enumerated list,
 *  marks the turn as a report rather than a menu awaiting a choice. Short
 *  closers ("Let me know.", "Your call.") stay under it; a full declarative
 *  sentence does not. */
const SUBSTANTIAL_PROSE_LEN = 40;

/**
 * True when the assembled assistant-turn text reads as a request for the
 * user's input — its tail ends with a question mark or an enumerated option
 * list. End-anchored:
 *  - a `?`-terminated line is a strong signal and wins outright;
 *  - an enumerated list is a weaker signal (lists also appear in reports), so
 *    it only counts when no substantial prose line follows it.
 */
function looksLikeAwaitingQuestion(turnText: string): boolean {
  const lines = stripCode(turnText)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return false;
  const tail = lines.slice(-8);
  let signalIdx = -1;
  for (let i = 0; i < tail.length; i++) {
    if (endsWithQuestionMark(tail[i]) || isListItem(tail[i])) signalIdx = i;
  }
  if (signalIdx === -1) return false;
  // A `?`-terminated signal line is decisive on its own.
  if (endsWithQuestionMark(tail[signalIdx])) return true;
  // Otherwise the signal is a list item — reject if a substantial prose line
  // follows it (the turn moved on from the list into a report).
  for (let i = signalIdx + 1; i < tail.length; i++) {
    if (!isListItem(tail[i]) && tail[i].length > SUBSTANTIAL_PROSE_LEN) {
      return false;
    }
  }
  return true;
}

/**
 * Surfaces a plain-text "awaiting user" question for the session, or null.
 * Mutually exclusive with a pending tool_use by construction: a pending
 * tool_use leaves a trailing assistant `tool_use` block, which step 3 rejects.
 */
export function detectAwaitingUserQuestion(
  events: ParsedSessionEvent[],
): TextQuestion | null {
  // 1. Latest conversational event (allowlist: user | assistant).
  let lastIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (isConversational(events[i])) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return null;
  // 2. A trailing user event (real message OR tool_result) — Claude is not
  //    waiting on the user.
  if (events[lastIdx].kind !== "assistant") return null;
  // 3. Mid-action guard: the latest assistant event still carries a tool_use
  //    (Claude is acting; a pending AskUserQuestion is handled by deriveInbox).
  if (assistantHasToolUse(events[lastIdx])) return null;
  // 4. Gather the trailing assistant turn — back to the previous `user` event.
  let turnStart = lastIdx;
  for (let i = lastIdx - 1; i >= 0; i--) {
    if (events[i].kind === "user") break;
    if (events[i].kind === "assistant") turnStart = i;
    // non-conversational events are skipped (allowlist)
  }
  // 5. Assemble the turn's text blocks.
  const parts: string[] = [];
  for (let i = turnStart; i <= lastIdx; i++) {
    if (events[i].kind === "assistant") parts.push(...assistantTextBlocks(events[i]));
  }
  const turnText = parts.join("\n").trim();
  if (!turnText) return null;
  // 6. Heuristic.
  if (!looksLikeAwaitingQuestion(turnText)) return null;
  const rawId = events[lastIdx].uuid;
  const questionId =
    typeof rawId === "string" && rawId.length > 0
      ? rawId
      : `awaiting-${turnStart}-${lastIdx}`;
  const questionText =
    turnText.length > MAX_QUESTION_TEXT_LEN
      ? "…" + turnText.slice(turnText.length - MAX_QUESTION_TEXT_LEN)
      : turnText;
  return { questionId, questionText, atAssistantEvent: lastIdx };
}

/**
 * Unified per-session inbox derivation. Runs the tool_use path
 * (`deriveInbox`) and the plain-text-question path
 * (`detectAwaitingUserQuestion`) and applies the precedence rule in ONE
 * place: a pending tool_use (e.g. AskUserQuestion) wins — a session with a
 * pending tool interaction never also surfaces a text question.
 */
export function deriveSessionInbox(
  args: DeriveInboxArgs,
): DeriveSessionInboxResult {
  const base = deriveInbox(args);
  const textQuestion =
    base.pending.length > 0 ? null : detectAwaitingUserQuestion(args.events);
  return { ...base, textQuestion };
}
