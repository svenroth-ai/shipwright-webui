/*
 * leadQuestionApi.ts — FR-04.17/18/19: the `lead_question` inbox item type
 * and its answer PATCH. Split out of externalApi.ts (grandfathered at the
 * bloat ceiling, shipwright_bloat_baseline.json) rather than growing that
 * file further.
 */
import { updateTask, type ExternalTask } from "./externalApi";
import type { InboxItemBase } from "./inboxItemTypes";

/**
 * FR-04.17/18/19 — a leadwright follow-up question awaiting a PO answer.
 * Written by the server straight off the task's `description` field (the
 * `<!-- lead-question:TYPE -->` marker leadwright's `renderLeadQuestion`
 * writes there — see `server/src/external/inbox/_lead.ts`), so it is a
 * fact, not a best-effort inference — no `bestEffort` field, deliberately.
 * `questionText` has that marker line stripped (FR-04.37 outbound: the
 * internal marker is a sentinel that must never reach this notification).
 * Answering PATCHes `ExternalTask.poFeedback` (see `answerLeadQuestion`);
 * per-question-type decoding is leadwright's own concern (FR-04.18), not
 * this field's.
 */
export interface LeadQuestionInboxItem extends InboxItemBase {
  kind: "lead_question";
  questionText: string;
}

/**
 * Answer a `lead_question` inbox item. PATCHes `poFeedback` with the PO's
 * own text plus an appended timestamp marker (trap: leadwright's reading
 * side treats an answer with no timestamp as a named error — see
 * `lib/context-packet.ts`'s `recentEvents.poFeedback[].ts`). No
 * per-question-type encoding here — that decoding stays leadwright's job
 * (FR-04.18); this is a plain, type-agnostic convention any future
 * encoding can build on.
 */
export async function answerLeadQuestion(
  taskId: string,
  answerText: string,
): Promise<ExternalTask> {
  const trimmed = answerText.trim();
  const poFeedback = `${trimmed}\n\n<!-- answered-at:${new Date().toISOString()} -->`;
  return updateTask(taskId, { poFeedback });
}
