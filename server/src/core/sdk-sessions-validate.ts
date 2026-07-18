/*
 * core/sdk-sessions-validate.ts — the hand-rolled row validator for
 * `sdk-sessions.json`, extracted verbatim from sdk-sessions-store.ts.
 *
 * Split out as a cohesive unit (the store's sibling `sdk-sessions-merge.ts`
 * follows the same pattern): schema validation is one concern, and the store
 * was carrying ~250 lines of it. Pure move — no behaviour change.
 *
 * `UNASSIGNED_PROJECT_ID` lives HERE and is re-exported by the store, so this
 * module imports only TYPES from the store. Type imports are erased at
 * runtime, which means there is no runtime import cycle between the two files.
 */

import { type BoardColumn, isBoardColumn } from "./board-column.js";
import type {
  ExternalTask,
  ExternalTaskInboxState,
  ExternalTaskState,
  LeadComplexityHint,
  LeadHandoff,
  LeadPriority,
} from "./sdk-sessions-store.js";

/**
 * Reserved projectId sentinel for the "Unassigned" pseudo-project bucket.
 * Kept in sync with client/src/lib/projectIds.ts (intentional duplication
 * per conventions.md — the two sides don't import each other).
 */
export const UNASSIGNED_PROJECT_ID = "unassigned";

// ---------- schema validators (hand-rolled; zod stays out of the store
// load path because a single malformed field shouldn't cascade-throw) ----------

export function validateExternalTask(
  taskId: string,
  raw: unknown,
  schemaVersion: 1 | 2 | 3 | 4,
): ExternalTask | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.taskId !== taskId) return null;
  if (typeof r.sessionUuid !== "string") return null;
  if (typeof r.cwd !== "string") return null;
  if (typeof r.title !== "string") return null;
  if (typeof r.createdAt !== "string") return null;
  const pluginDirs = Array.isArray(r.pluginDirs)
    ? r.pluginDirs.filter((x: unknown): x is string => typeof x === "string")
    : [];
  const validStates: ExternalTaskState[] = [
    "draft",
    "awaiting_external_start",
    "active",
    "idle",
    "jsonl_missing",
    "launch_failed",
    "done",
  ];
  const state = validStates.includes(r.state as ExternalTaskState)
    ? (r.state as ExternalTaskState)
    : "draft";

  // projectId branches on schemaVersion (ADR-038).
  //
  // v1: any projectId field on disk is untrusted (this is a compat-window
  //   shape, e.g. an older binary read a v2 row tagged v1). Always
  //   backfill UNASSIGNED_PROJECT_ID. External review O25.
  // v2 + v3: require a non-empty string; soft-skip the row otherwise
  //   (null, empty-string, or non-string = corrupt).
  let projectId: string;
  if (schemaVersion === 1) {
    projectId = UNASSIGNED_PROJECT_ID;
  } else {
    if (typeof r.projectId !== "string" || r.projectId.trim() === "") {
      return null;
    }
    projectId = r.projectId.trim();
  }

  const rawInbox = r.inbox;
  const inbox: ExternalTaskInboxState =
    rawInbox && typeof rawInbox === "object"
      ? {
          pendingToolUseIds: Array.isArray((rawInbox as Record<string, unknown>).pendingToolUseIds)
            ? ((rawInbox as Record<string, unknown>).pendingToolUseIds as unknown[]).filter(
                (x: unknown): x is string => typeof x === "string",
              )
            : [],
          dismissedToolUseIds: Array.isArray((rawInbox as Record<string, unknown>).dismissedToolUseIds)
            ? ((rawInbox as Record<string, unknown>).dismissedToolUseIds as unknown[]).filter(
                (x: unknown): x is string => typeof x === "string",
              )
            : [],
          lastProcessedByteOffset:
            typeof (rawInbox as Record<string, unknown>).lastProcessedByteOffset === "number"
              ? ((rawInbox as Record<string, unknown>).lastProcessedByteOffset as number)
              : 0,
        }
      : { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 };

  // v3 — read phase-task linkage fields. Forward-compat: tolerate them on
  // v1/v2 rows too (e.g. partial rollback after writing v3 once). Drop bad
  // shapes silently rather than fail the whole row.
  const phaseTaskId =
    typeof r.phaseTaskId === "string" && r.phaseTaskId.length > 0
      ? r.phaseTaskId
      : undefined;
  const runId =
    typeof r.runId === "string" && r.runId.length > 0 ? r.runId : undefined;
  const parentRunMaster =
    typeof r.parentRunMaster === "boolean" ? r.parentRunMaster : undefined;
  // v4 — sticky board-column override; soft-drop anything not a valid column.
  const boardColumn = isBoardColumn(r.boardColumn) ? r.boardColumn : undefined;

  // 2026-05-05 — preserve action-context fields persisted via store.patch()
  // (set at /launch time) and via store.create() actionId (Save-to-Backlog).
  // These were silently dropped on disk-reload before, causing every server
  // restart to lose the right command_template for backlog tasks → vanilla
  // claude on next Launch click.
  const actionId =
    typeof r.actionId === "string" && r.actionId.trim().length > 0
      ? r.actionId.trim()
      : undefined;
  const phase =
    typeof r.phase === "string" && r.phase.trim().length > 0
      ? r.phase.trim()
      : undefined;
  const phaseLabel =
    typeof r.phaseLabel === "string" && r.phaseLabel.trim().length > 0
      ? r.phaseLabel.trim()
      : undefined;
  const description =
    typeof r.description === "string" && r.description.length > 0
      ? r.description
      : undefined;
  const autonomy =
    r.autonomy === "guided" || r.autonomy === "autonomous"
      ? (r.autonomy as "guided" | "autonomous")
      : undefined;

  // iterate-2026-05-14 lead-foundation-task-schema — per-field soft-drop
  // validation. Forward-compat: tolerated on v1/v2/v3 rows alike (matches
  // the existing phaseTaskId / runId / parentRunMaster pattern). Bad
  // shapes drop the offending field only; the rest of the row survives.
  const domain =
    typeof r.domain === "string" && r.domain.length > 0 ? r.domain : undefined;
  const priority =
    r.priority === "P0" ||
    r.priority === "P1" ||
    r.priority === "P2" ||
    r.priority === "P3"
      ? (r.priority as LeadPriority)
      : undefined;
  const complexityHint =
    r.complexityHint === "small" ||
    r.complexityHint === "medium" ||
    r.complexityHint === "large"
      ? (r.complexityHint as LeadComplexityHint)
      : undefined;
  // `tags` and `blockedBy` MUST be arrays. A non-array value (string,
  // object, null) drops the whole field. Mixed-type arrays are filtered
  // down to the strings, consistent with `pluginDirs` handling above.
  const tags = Array.isArray(r.tags)
    ? (r.tags as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;
  const blockedBy = Array.isArray(r.blockedBy)
    ? (r.blockedBy as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;
  const leadParentTaskId =
    typeof r.leadParentTaskId === "string" && r.leadParentTaskId.length > 0
      ? r.leadParentTaskId
      : undefined;
  const poFeedback =
    typeof r.poFeedback === "string" && r.poFeedback.length > 0
      ? r.poFeedback
      : undefined;
  const claimToken =
    typeof r.claimToken === "string" && r.claimToken.length > 0
      ? r.claimToken
      : undefined;
  const claimedBy =
    typeof r.claimedBy === "string" && r.claimedBy.length > 0
      ? r.claimedBy
      : undefined;
  const claimedAt =
    typeof r.claimedAt === "string" && r.claimedAt.length > 0
      ? r.claimedAt
      : undefined;
  const claimPid =
    typeof r.claimPid === "number" && Number.isFinite(r.claimPid)
      ? r.claimPid
      : undefined;
  const promotedFromTriageId =
    typeof r.promotedFromTriageId === "string" && r.promotedFromTriageId.length > 0
      ? r.promotedFromTriageId
      : undefined;
  // leadHandoff: atomic — either the whole sub-object passes validation
  // or it's dropped. status is the discriminator; leadId + status +
  // beatsUsed + summary are required; sub-fields are optional.
  const rawHandoff = r.leadHandoff;
  let leadHandoff: LeadHandoff | undefined = undefined;
  if (rawHandoff && typeof rawHandoff === "object" && !Array.isArray(rawHandoff)) {
    const h = rawHandoff as Record<string, unknown>;
    const status =
      h.status === "completed" || h.status === "escalated" || h.status === "failed"
        ? (h.status as LeadHandoff["status"])
        : undefined;
    if (
      status !== undefined &&
      typeof h.leadId === "string" &&
      h.leadId.length > 0 &&
      typeof h.beatsUsed === "number" &&
      Number.isFinite(h.beatsUsed) &&
      typeof h.summary === "string"
    ) {
      const handoff: LeadHandoff = {
        leadId: h.leadId,
        status,
        beatsUsed: h.beatsUsed,
        summary: h.summary,
      };
      if (Array.isArray(h.subIterateIds)) {
        handoff.subIterateIds = (h.subIterateIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        );
      }
      if (typeof h.escalationReason === "string" && h.escalationReason.length > 0) {
        handoff.escalationReason = h.escalationReason;
      }
      if (typeof h.learningsExtracted === "boolean") {
        handoff.learningsExtracted = h.learningsExtracted;
      }
      leadHandoff = handoff;
    }
  }

  return {
    taskId,
    sessionUuid: r.sessionUuid,
    cwd: r.cwd,
    pluginDirs,
    parentTaskId: typeof r.parentTaskId === "string" ? r.parentTaskId : undefined,
    parentSessionUuid: typeof r.parentSessionUuid === "string" ? r.parentSessionUuid : undefined,
    title: r.title,
    projectId,
    state,
    createdAt: r.createdAt,
    launchedAt: typeof r.launchedAt === "string" ? r.launchedAt : undefined,
    firstJsonlObservedAt: typeof r.firstJsonlObservedAt === "string" ? r.firstJsonlObservedAt : undefined,
    lastJsonlSeenMtimeMs:
      typeof r.lastJsonlSeenMtimeMs === "number" ? r.lastJsonlSeenMtimeMs : undefined,
    inbox,
    ...(actionId ? { actionId } : {}),
    ...(phase ? { phase } : {}),
    ...(phaseLabel ? { phaseLabel } : {}),
    ...(description ? { description } : {}),
    ...(autonomy ? { autonomy } : {}),
    ...(phaseTaskId ? { phaseTaskId } : {}),
    ...(runId ? { runId } : {}),
    ...(parentRunMaster !== undefined ? { parentRunMaster } : {}),
    ...(boardColumn !== undefined ? { boardColumn } : {}),
    // iterate-2026-05-14 lead-foundation — spread only when defined so
    // the on-disk JSON stays quiet for legacy / non-lead tasks.
    ...(domain !== undefined ? { domain } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(complexityHint !== undefined ? { complexityHint } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(blockedBy !== undefined ? { blockedBy } : {}),
    ...(leadParentTaskId !== undefined ? { leadParentTaskId } : {}),
    ...(poFeedback !== undefined ? { poFeedback } : {}),
    ...(claimToken !== undefined ? { claimToken } : {}),
    ...(claimedBy !== undefined ? { claimedBy } : {}),
    ...(claimedAt !== undefined ? { claimedAt } : {}),
    ...(claimPid !== undefined ? { claimPid } : {}),
    ...(leadHandoff !== undefined ? { leadHandoff } : {}),
    ...(promotedFromTriageId !== undefined ? { promotedFromTriageId } : {}),
  };
}
