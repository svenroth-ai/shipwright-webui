/*
 * routes/org-threads-composite.ts — builds the `GET /api/org/threads`
 * response: every lead's follow-up-card threads, keyed by leadId (FR-04.42,
 * leadwright#35). One http round trip for the whole page, same "composite,
 * not N+1" shape `org-leads-composite.ts` already uses for usage/last-run/
 * beat-register/charter — this reads one more per-lead file
 * (`lead-question-threads.json`) the same way.
 *
 * A per-lead read failure (missing file, unreadable, malformed JSON,
 * unknown version) degrades that lead to an empty card list — it never
 * fails the whole response (AC-d: the Org page must still load with no
 * thread anywhere).
 */

import {
  readLeadQuestionThreadsCore,
  type LeadQuestionThreadsRouteDeps,
} from "../external/org/lead-question-threads.js";
import { extractLeadQuestionBody } from "../external/inbox/_lead.js";
import type { OrgThreadCardView, OrgThreadsResponse } from "../types/org.js";

/**
 * Narrowest shape this module needs out of `SdkSessionsStore` — mirrors the
 * `lstatSync`-style minimal-injection convention used across this directory
 * (inject only the method actually called, not the whole class).
 */
export interface TaskTitleLookup {
  get(taskId: string): { title: string } | undefined;
}

export interface OrgThreadsBuildDeps extends LeadQuestionThreadsRouteDeps {
  /** Task-title lookup — leadwright's thread record only carries `taskId`;
   *  the card's display title comes from webui's own task store. A taskId
   *  with no matching task (deleted, or store not yet caught up) falls
   *  back to the raw id rather than dropping the card. */
  store: TaskTitleLookup;
}

/** One lead's follow-up-card threads, in store order (never re-sorted). */
export function buildLeadThreadCards(deps: OrgThreadsBuildDeps, leadId: string): OrgThreadCardView[] {
  const result = readLeadQuestionThreadsCore(deps, leadId);
  if (!result.ok) return [];

  const cards: OrgThreadCardView[] = [];
  for (const [taskId, thread] of Object.entries(result.threads)) {
    if (thread.rounds.length === 0) continue;
    const task = deps.store.get(taskId);
    cards.push({
      cardId: taskId,
      cardTitle: task?.title ?? taskId,
      rounds: thread.rounds.map((round) => ({
        id: `${taskId}#${round.round}`,
        // FR-04.37: the stored question still carries the marker line
        // (renderLeadQuestion's raw output) — strip it the same way the
        // lead_question inbox kind already does, so it never renders.
        question: extractLeadQuestionBody(round.question) ?? round.question,
        askedAt: round.askedAt,
        answer: round.answer?.text,
        answeredAt: round.answer?.answeredAt,
      })),
    });
  }
  return cards;
}

/** Every lead's threads, keyed by leadId — one entry per chart lead, always. */
export function buildOrgThreads(deps: OrgThreadsBuildDeps, leadIds: string[]): OrgThreadsResponse {
  const out: OrgThreadsResponse = {};
  for (const leadId of leadIds) {
    out[leadId] = buildLeadThreadCards(deps, leadId);
  }
  return out;
}
