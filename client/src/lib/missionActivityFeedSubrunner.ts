/**
 * Subagent ("subrunner") dispatch + resolution for `missionActivityFeed.ts`'s
 * reducer — kept in its own file (iterate-2026-09-26-mission-tab-subrunner)
 * rather than folded into `missionActivityFeedTurn.ts`/
 * `missionActivityFeedClassify.ts`, both already near the project's
 * 300-line convention ceiling.
 *
 * This harness's real subagent-dispatch tool is named `Agent` (confirmed by
 * direct JSONL inspection); `Task` is kept recognized too for the classic
 * Claude Code CLI convention other files here already assume
 * (`stage-markers.ts`, `missionActivityFeedClassify.ts`'s `isReviewTask`).
 *
 * RESOLUTION MECHANISM — corrected against a REAL captured transcript
 * (a genuine `Agent` dispatch that hit its 200-turn limit, was resumed via
 * `SendMessage`, and later finished). The initial design assumed a hand-back
 * arrives as a wrapped plain user-role message ("Another Claude session sent
 * a message: <agent-message …>") — that string does not occur anywhere in
 * the real transcript. What actually resolves a dispatch is the SAME
 * `<task-notification>` envelope `session-parser.ts` already reclassifies
 * to `kind: "task-notification"` for background Bash commands — an `Agent`
 * completion notification additionally carries a `<result>` tag with the
 * subagent's full final report. Correlation is by the notification's
 * `taskId`, which for an `Agent` dispatch is the STABLE agent id revealed in
 * the dispatch's own ack tool_result ("agentId: <id>") — never the
 * dispatch's `tool_use.id`, which a `SendMessage` continuation reissues as a
 * NEW id on every resume (confirmed: the same agent's SECOND notification
 * carried a different `<tool-use-id>` than its first).
 */
import type { TaskNotificationEvent } from "../external/session-parser";
import type { ActivityCard } from "./missionActivityFeedTypes";
import { explanationExcerpt } from "./missionActivityFeedText";

export function isSubrunnerDispatch(name: string): boolean {
  return name === "Agent" || name === "Task";
}

/** Builds a fresh `subrunner` card for a just-dispatched `Agent`/`Task` tool
 *  call. `subrunnerId` is PROVISIONALLY the dispatch's own `tool_use.id` —
 *  `applySubrunnerAck` below overwrites it with the dispatch's real, STABLE
 *  agent id the moment its ack tool_result names one (see this file's own
 *  doc comment for why that id, not this one, is what a later
 *  `task-notification` actually carries). Kept here rather than inlined at
 *  `missionActivityFeedTurn.ts`'s call site (bloat-ceiling — that file has no
 *  spare budget of its own) since every other subrunner-specific concern
 *  already lives in this file. */
export function createSubrunnerDispatchCard(
  toolId: string,
  input: Record<string, unknown> | undefined,
  timestamp: string | undefined,
): ActivityCard {
  return {
    kind: "subrunner",
    text: subrunnerDescription(input),
    commands: [],
    subrunnerId: toolId,
    subrunnerStatus: "running",
    timestamp,
  };
}

/** Overwrites a subrunner card's provisional id with the dispatch's real
 *  agent id once its ack tool_result names one (`extractSubrunnerAgentId`).
 *  `Task` is kept RECOGNIZED as a dispatch (`isSubrunnerDispatch`) only for
 *  the classic CLI convention other files here already assume — never
 *  empirically confirmed to behave like `Agent` in THIS harness (this file's
 *  own doc comment). A `Task` ack with no `agentId:` fingerprint is treated
 *  as a SYNCHRONOUS completion instead — its own content IS the finished
 *  report, exactly like the untouched `review`-bucket branch in
 *  `missionActivityFeedResolve.ts` already reads a review Task's ack
 *  directly, no async wait (doubt-review finding, high: without this, a
 *  genuine synchronous `Task` dispatch got stuck on "running" forever with
 *  its real report silently discarded, since no `task-notification` is ever
 *  generated for a subagent that has no async background lifecycle at all).
 *
 *  An `Agent` ack with no `agentId:` fingerprint is the OPPOSITE case (local
 *  PR-review preflight BLOCK, 2026-09-26): `Agent` dispatches are always
 *  asynchronous in this harness, so a malformed/unexpected ack shape is not
 *  evidence the work already finished — marking it "done" with the raw ack
 *  text as its report would both invent a false completion and permanently
 *  bury the real eventual `task-notification` report. Left running instead
 *  (the same accepted outcome `resolveSubrunnerNotification`'s own doc
 *  comment already describes for an agent id that never resolves). An
 *  `isError` ack still fails closed regardless of dispatch kind — a
 *  dispatch that failed to launch at all never gets an async completion to
 *  wait for.
 *
 *  Kept here alongside `extractSubrunnerAgentId` rather than inlined at
 *  `missionActivityFeedResolve.ts`'s call site (same bloat-ceiling reason as
 *  `createSubrunnerDispatchCard` above). */
export function applySubrunnerAck(card: ActivityCard, ackContent: string, isError: boolean, commandKey: string): void {
  const agentId = extractSubrunnerAgentId(ackContent);
  if (agentId) {
    card.subrunnerId = agentId;
    return;
  }
  if (isError) {
    card.subrunnerStatus = "failed";
    attachSubrunnerReport(card, ackContent);
    return;
  }
  const dispatchToolName = commandKey.split("\u0000", 1)[0];
  if (dispatchToolName === "Agent") return;
  card.subrunnerStatus = "done";
  attachSubrunnerReport(card, ackContent);
}

/** A dispatched subagent's own description of what it's doing — the same
 *  field the real `Agent`/`Task` tool schema always carries. Falls back to a
 *  generic sentence only for a malformed/missing input, never an empty card. */
export function subrunnerDescription(input: Record<string, unknown> | undefined): string {
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  return description || "Delegated work to a subagent.";
}

// Anchored to the harness's own launch-acknowledgement preamble, not a bare
// `agentId:` substring search (doubt-review finding, low): an unanchored
// match could fire on an unrelated ack's own prose/JSON that happens to
// contain that literal text, silently overwriting `subrunnerId` with a
// garbage value and permanently breaking correlation for the real
// completion.
const AGENT_ID_RE = /Async agent launched successfully[\s\S]*?agentId:\s*([A-Za-z0-9_-]+)/;

/** Extracts the dispatch's own stable agent id from its ack tool_result text
 *  ("Async agent launched successfully. … agentId: <id> …") — see this
 *  file's doc comment for why this, not the dispatching tool_use's own id,
 *  is the correlation key a later `task-notification` actually carries.
 *  Returns null for a non-Agent ack (e.g. a plain shell command's result,
 *  or a synchronous `Task`'s own finished prose), which never matches this
 *  fingerprint. */
export function extractSubrunnerAgentId(ackContent: string): string | null {
  const match = AGENT_ID_RE.exec(ackContent);
  return match ? match[1] : null;
}

function attachSubrunnerReport(card: ActivityCard, raw: string): void {
  const bounded = explanationExcerpt(raw);
  const full = explanationExcerpt(raw, Infinity, Infinity);
  card.subrunnerReport = bounded;
  card.subrunnerReportFull = full.length > bounded.length ? full : undefined;
}

/** Resolves a `task-notification` event onto the matching open subrunner
 *  card, correlated by `taskId === card.subrunnerId` — a plain background-
 *  Bash-command notification's `taskId` never matches any subrunner card's
 *  stored agent id, so this is a no-op for it by construction (no separate
 *  "is this an Agent notification" check needed). No-ops too when no
 *  subrunner card carries this id at all (the dispatch is outside the
 *  narrative window, or its ack never resolved an agent id) — nothing to
 *  attach a report to, and inventing an orphan card here (unlike a genuine
 *  hand-back) would show a report with no description of what it was for.
 *  Ordering: an ack is that SAME tool_use's own `tool_result`, so it is
 *  always present in the transcript before any notification for that agent
 *  can exist at all (the agent must be dispatched-and-acknowledged before it
 *  can ever finish and be notified about) — there is no transcript order in
 *  which this event could arrive first (doubt-review finding, medium).
 *  Prefers a still-`"running"` match over an already-resolved one (doubt-
 *  review finding, low) so a same-id collision degrades to "the open one
 *  wins", never a silently-swallowed second notification.
 *
 *  Only `"completed"`/`"failed"` resolve the card — any other `status`
 *  (including the parser's `"unknown"` fallback for a missing/malformed
 *  `<status>` tag) is a no-op, leaving the card `"running"` (external code
 *  review, openai, medium: "every notification status except `failed`
 *  becomes `done`... a malformed notification can falsely mark a running
 *  agent complete"). */
export function resolveSubrunnerNotification(cards: ActivityCard[], event: TaskNotificationEvent): void {
  if (event.status !== "completed" && event.status !== "failed") return;
  if (!event.taskId) return;
  const matches = cards.filter((c) => c.kind === "subrunner" && c.subrunnerId === event.taskId);
  const card = matches.find((c) => c.subrunnerStatus === "running") ?? matches[0];
  if (!card) return;
  // A `SendMessage`-continued agent notifies more than once for the SAME id
  // (a partial "stopped at its turn limit" notification, then a later final
  // one) — each arrival overwrites the previous status/report, last one
  // wins, same as every other retry/recovery overwrite in this reducer.
  card.subrunnerStatus = event.status === "failed" ? "failed" : "done";
  // Prefer the rich `<result>` report; fall back to the short `<summary>`
  // for a malformed/older envelope that carries no `<result>` at all.
  const raw = event.result || event.summary;
  if (raw) attachSubrunnerReport(card, raw);
}
