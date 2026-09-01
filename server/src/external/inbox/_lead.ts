/*
 * external/inbox/_lead.ts — the `lead_question` inbox kind (FR-04.17/18/19).
 *
 * Unlike `ask_tool`/`text_question`/`terminal_prompt` (derived from a JSONL
 * or live-terminal read — see `./_derive.ts`), a `lead_question` is WRITTEN:
 * leadwright's `renderLeadQuestion` (separate repo, `lib/lead-question.ts`)
 * puts a `<!-- lead-question:TYPE -->` marker line at the top of a task's
 * `description` when it proposes a follow-up. This module only needs to
 * detect that marker's PRESENCE and strip it — the six named question
 * types are leadwright's own vocabulary (FR-04.18), not webui's. Per
 * CLAUDE.md DO-NOT #7 this is a verbatim, independent mirror of the
 * detection regex, not a cross-package import.
 *
 * A task is "waiting" iff its description carries the marker AND it has
 * not yet been answered (`poFeedback` unset) and not yet dismissed.
 *
 * CONTRACT (by design, not a bug): both suppressions are per-TASK, not
 * per-question. Once `poFeedback` is set (answered) or `lq-<taskId>` is
 * dismissed, this task can surface no FURTHER lead_question until
 * leadwright clears `poFeedback` and rewrites `description` for the next
 * follow-up — there is no per-question id to key a narrower suppression on,
 * and inventing one is explicitly out of scope here (that's leadwright's
 * FR-04.18 concern, not webui's). If leadwright ever needs to re-ask on the
 * SAME task while an old answer is still present, it must clear
 * `poFeedback` first.
 */

import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import type { AggregatedEntry } from "./_types.js";

const LEAD_QUESTION_MARKER_RE = /^<!--\s*lead-question:[a-zäöüß-]+\s*-->/;
// Same marker, but matched anywhere on its own line — used to strip a
// re-ask's marker appended BELOW the leading one, so the sentinel can never
// survive into the body even from a second occurrence (FR-04.37).
const LEAD_QUESTION_MARKER_LINE_RE =
  /^[ \t]*<!--\s*lead-question:[a-zäöüß-]+\s*-->[ \t]*$/gim;

/** Dismiss-id prefix for a `lead_question` — disambiguates from a JSONL `toolUseId` (which never starts with this). */
export const LEAD_QUESTION_DISMISS_PREFIX = "lq-";

export function leadQuestionDismissId(taskId: string): string {
  return `${LEAD_QUESTION_DISMISS_PREFIX}${taskId}`;
}

/**
 * FR-04.37 outbound: the marker line is an internal sentinel and must
 * never reach the rendered "notification" (the inbox card) — strip it
 * and return the human-authored body only. `null` when no marker is
 * present (an ordinary task description, not a waiting follow-up).
 */
export function extractLeadQuestionBody(
  description: string | undefined,
): string | null {
  if (typeof description !== "string") return null;
  const match = LEAD_QUESTION_MARKER_RE.exec(description);
  if (!match) return null;
  return description
    .slice(match[0].length)
    .replace(/^[\r\n]+/, "")
    .replace(LEAD_QUESTION_MARKER_LINE_RE, "");
}

/**
 * Post-pass over the store (mirrors `appendTerminalPrompts`'s shape):
 * append one `lead_question` entry per waiting, non-dismissed, unanswered
 * task. Runs after the JSONL-derived pass; a task already surfaced under
 * another kind (e.g. a live `ask_tool`) still gets its own lead_question
 * entry too — the two are independent waiting states on the same task.
 */
export function appendLeadQuestions(
  entries: AggregatedEntry[],
  args: { store: SdkSessionsStore },
): void {
  const { store } = args;
  for (const task of store.list()) {
    if (task.state === "done" || task.state === "launch_failed") continue;
    if (task.poFeedback) continue;
    const body = extractLeadQuestionBody(task.description);
    if (body === null) continue;
    if (task.inbox.dismissedToolUseIds.includes(leadQuestionDismissId(task.taskId))) {
      continue;
    }
    entries.push({
      kind: "lead_question",
      taskId: task.taskId,
      sessionUuid: task.sessionUuid,
      taskTitle: task.title,
      questionText: body,
    });
  }
}
