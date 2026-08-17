/*
 * external/_shared/helpers.ts — types + constants + utilities shared
 * across the 9 external/* sub-routers + the registration shell
 * (server/src/external/routes.ts). Extracted from the historical
 * monolithic routes.ts during the C2 split (campaign-C-C2).
 *
 * Public re-exports of `FILE_MAX_BYTES`, `MIME_BY_EXTENSION`,
 * `sanitizeContentDispositionFilename`, `clearInboxDeriveCache`, and
 * `ExternalRouteProjectView` are kept on the shell (./routes.ts) for
 * back-compat with 14 sibling test files that import from `./routes.js`.
 */

import { ExternalTask, UNASSIGNED_PROJECT_ID } from "../../core/sdk-sessions-store.js";

// ---------------------------------------------------------------------------
// Thresholds + caps
// ---------------------------------------------------------------------------

/** Iterate G — task is "active" while its JSONL was mutated this often. */
export const ACTIVE_IDLE_THRESHOLD_MS = 120_000;

/** Iterate G — task flips back to "active" if mtime moves within this window. */
export const IDLE_REACTIVATE_THRESHOLD_MS = 5_000;

/** Hard cap on user-assigned titles. CLI accepts more, but UI legibility
 * (TaskBoard cards, terminal title bar) breaks past ~200 chars. */
export const TITLE_MAX_LENGTH = 200;

/**
 * Hard cap on the task description / initial prompt. Originally 20,000
 * (iterate-2026-05-18-edit-task-dialog) — generous headroom against a
 * pathological payload, but far above the actual constraint: a task's
 * description is embedded verbatim as a single-line positional argument
 * in the launch command (`{task.initial_prompt}` /
 * `core/actions-substitute.ts`), which the embedded terminal writes to
 * the pty in one shot. Windows' interactive console line editor
 * (cmd.exe and PowerShell's console host, both hosted via ConPTY here)
 * has a well-known ~8,191-character ceiling for a single
 * interactively-typed/pasted line — past that the line is silently
 * truncated or the shell chokes on an unbalanced quote, so the command
 * appears to paste cleanly but Claude never starts. Lowered to 6,000
 * (iterate-2026-08-13-task-description-length-cap) to leave safe
 * headroom under that ceiling once the slash command, `--plugin-dir`
 * args, `--name`, `--session-id` and shell-quoting overhead are added
 * alongside it — while still comfortably fitting real briefs (pasted
 * errors, file references, triage findings).
 */
export const DESCRIPTION_MAX_LENGTH = 6_000;

// ---------------------------------------------------------------------------
// Project view shape (consumed by every sub-router that takes a projectId).
// ---------------------------------------------------------------------------

export interface ExternalRouteProjectView {
  id: string;
  name: string;
  path: string;
  profile?: string;
  synthesized?: boolean;
  settings?: { color?: string };
}

// ---------------------------------------------------------------------------
// Live-session augmentation helpers (Iterate G ADR-095 + ADR-102).
// ---------------------------------------------------------------------------

/**
 * ADR-095 — augment a serialized task with `liveSession`, derived from
 * `ptyManager.get(taskId) !== undefined`. Defensive: handles undefined /
 * null input (returns it unchanged) so callers that already 404'd can
 * still pass-through. Returns a shallow clone.
 */
export function withLiveSession<T extends ExternalTask | undefined | null>(
  task: T,
  ptyManager: { get(taskId: string): unknown },
): T extends ExternalTask
  ? ExternalTask & { liveSession: boolean }
  : T {
  if (!task) return task as never;
  return {
    ...task,
    liveSession: ptyManager.get(task.taskId) !== undefined,
  } as never;
}

/**
 * ADR-102 — response-only override of `lastJsonlSeenMtimeMs` with a LIVE
 * JSONL mtime. Not persisted — mirrors withLiveSession.
 */
export function withLiveJsonlMtime<T extends ExternalTask>(
  task: T,
  liveMtimeMs: number | undefined,
): T {
  return liveMtimeMs != null
    ? { ...task, lastJsonlSeenMtimeMs: liveMtimeMs }
    : task;
}

// ---------------------------------------------------------------------------
// Parameter parsing helpers
// ---------------------------------------------------------------------------

/** Safe positive-int parser for query params. */
export function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Project-id validation (Section 02 iterate 3)
// ---------------------------------------------------------------------------

/**
 * Section 02 (iterate 3) — projectId validation.
 *
 * Returns a structured error body on rejection, or null when the id is
 * acceptable. The reserved UNASSIGNED_PROJECT_ID sentinel is always
 * valid (represents the synthesized bucket). If `getKnownProjectIds`
 * is not wired, every non-sentinel id is rejected — the route demands
 * explicit validation so a misconfigured server can't silently accept
 * arbitrary strings.
 */
export function validateProjectIdOrError(
  candidate: string,
  getKnownProjectIds: (() => Set<string>) | undefined,
): { error: string; projectId: string } | null {
  if (candidate === UNASSIGNED_PROJECT_ID) return null;
  const known = getKnownProjectIds?.();
  if (!known || !known.has(candidate)) {
    return { error: "unknown_project_id", projectId: candidate };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Description + tags / blockedBy normalization (PATCH + POST tasks parity)
// ---------------------------------------------------------------------------

/**
 * iterate-2026-05-18-edit-task-dialog — shared description normalization
 * for POST /tasks + PATCH /tasks/:id so create and edit enforce
 * identical rules (external review HIGH/MED — create/edit parity).
 * `null` / `undefined` / whitespace-only → cleared (value `undefined`);
 * a real string is trimmed; over-length → a structured error.
 */
export function normalizeDescription(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return { ok: false, error: "description must be a string" };
  }
  if (raw.length > DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      error: `description exceeds ${DESCRIPTION_MAX_LENGTH} characters`,
    };
  }
  const trimmed = raw.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

/**
 * iterate-2026-08-16-v1-lead-fields-tag-filter — poFeedback normalization.
 * Structurally mirrors `normalizeDescription` (same trim + cap rule, same
 * `DESCRIPTION_MAX_LENGTH` constant per the assignment) but is NOT built by
 * parameterizing that function — `normalizeDescription`'s exact error
 * string is pinned by `routes.description-length-cap.test.ts` + spec.md.
 */
export function normalizePoFeedback(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return { ok: false, error: "poFeedback must be a string" };
  }
  if (raw.length > DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      error: `poFeedback exceeds ${DESCRIPTION_MAX_LENGTH} characters`,
    };
  }
  const trimmed = raw.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

/**
 * D22 / F27 — canonical task-title validation, shared by PATCH /tasks/:id
 * (setting a title), POST /tasks, and POST /tasks/:id/fork so all three
 * enforce the SAME rule set with identical error strings. Mirrors the
 * launcher's `normalizeTitle` contract: embedded CR/LF break the
 * single-line `--name` copy-paste flow (uncaught throw → 500 on the next
 * launch), so they are rejected up-front instead.
 *
 * Non-string / newline → "title cannot contain newlines" (PATCH also maps
 * a non-string title here). Trims to empty → "title cannot be empty".
 * Over TITLE_MAX_LENGTH → "title exceeds N characters". Otherwise the
 * trimmed value. Create/fork keep their own synthesized-default fallback
 * for an ABSENT / blank title and only call this for a provided one.
 */
export function normalizeTitle(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || /[\r\n]/.test(raw)) {
    return { ok: false, error: "title cannot contain newlines" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "title cannot be empty" };
  }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    return { ok: false, error: `title exceeds ${TITLE_MAX_LENGTH} characters` };
  }
  return { ok: true, value: trimmed };
}

/**
 * iterate-2026-05-18-edit-task-dialog — normalize a `tags` / `blockedBy`
 * PATCH array: keep strings only, trim, drop empties, dedupe (order
 * preserved). Caller-supplied non-array input is rejected upstream.
 */
export function normalizeStringArray(raw: unknown[]): string[] {
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (t.length === 0 || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lead-foundation create-time fields (iterate-2026-05-14)
// ---------------------------------------------------------------------------

/**
 * iterate-2026-05-14 lead-foundation-task-schema — leadwright Phase 1,
 * widened 2026-08-16 (+leadParentTaskId, triage-v1-v4a.md Item 1b).
 *
 * Read + soft-drop the 6 user-creatable leadwright fields from a create
 * or launch body. Mirrors `validateExternalTask`'s per-field tolerance:
 * malformed shapes are filtered out, the rest survive. Daemon-owned
 * fields (including `poFeedback` — PATCH-only) are NOT read here.
 */
export function readLeadCreateFields(body: Record<string, unknown>): {
  domain?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  complexityHint?: "small" | "medium" | "large";
  tags?: string[];
  blockedBy?: string[];
  leadParentTaskId?: string;
} {
  const out: ReturnType<typeof readLeadCreateFields> = {};
  if (typeof body.domain === "string" && body.domain.length > 0) {
    out.domain = body.domain;
  }
  if (typeof body.leadParentTaskId === "string" && body.leadParentTaskId.length > 0) {
    out.leadParentTaskId = body.leadParentTaskId;
  }
  if (
    body.priority === "P0" ||
    body.priority === "P1" ||
    body.priority === "P2" ||
    body.priority === "P3"
  ) {
    out.priority = body.priority;
  }
  if (
    body.complexityHint === "small" ||
    body.complexityHint === "medium" ||
    body.complexityHint === "large"
  ) {
    out.complexityHint = body.complexityHint;
  }
  if (Array.isArray(body.tags)) {
    out.tags = (body.tags as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
  }
  if (Array.isArray(body.blockedBy)) {
    out.blockedBy = (body.blockedBy as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
  }
  return out;
}
