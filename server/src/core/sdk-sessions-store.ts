/*
 * Persisted store for external-launch task metadata.
 *
 * On disk at `<registryDir>/sdk-sessions.json`: { schemaVersion: 4, sessions:
 * { [taskId]: ExternalTask } } — see the SdkSessionsFile + ExternalTask
 * interfaces below for the full row shape.
 *
 * Schema migration (ADR-038 + -v2 + iterate-2026-06-17 boardColumn):
 * CURRENT_SCHEMA_VERSION = 4; the loader accepts v1–v4. v1 rows backfill
 * `projectId: "unassigned"`; older rows load with newer fields undefined.
 * Write-on-touch — the first persist() after a mutation flushes the whole
 * shape as v4, so large stores migrate over days of use (not on boot) and
 * rollback is a one-line constant revert.
 * O26 (deleted project refs): if `getKnownProjectIds` is injected, v2 rows
 * whose projectId is unknown resolve to "unassigned" in memory + next persist.
 * O25 (forward compat): the v1 branch tolerates an unknown projectId field so
 * older binaries don't crash on a v2-ish row tagged v1 (partial rollback).
 *
 * Writes are guarded by proper-lockfile (injected lock dep). F08 — persist()
 * re-reads + 3-way merges under that lock and writes atomically (tmp+rename)
 * so concurrent instances sharing the file never clobber each other's rows /
 * externally-written claim fields (see sdk-sessions-merge.ts). Reads are
 * unguarded — dirty reads (post-write, pre-flush) are acceptable.
 *
 * Corruption tolerance: a malformed entry fails ONLY its own read — we
 * soft-skip rows that fail schema validation rather than throwing, so one bad
 * row can't kill every other session on restart (round-2 GPT MAJOR 6).
 */

import { randomUUID } from "node:crypto";

import type { BoardColumn } from "./board-column.js";
import type { MissionContextAssociation } from "./mission-context/types.js";
import { atomicWriteFile, cloneSessions, mergeSessions, reReadDisk } from "./sdk-sessions-merge.js";
import { UNASSIGNED_PROJECT_ID, validateExternalTask } from "./sdk-sessions-validate.js";
// Re-exported for the many callers that historically imported it from here.
export { UNASSIGNED_PROJECT_ID } from "./sdk-sessions-validate.js";

export type ExternalTaskState =
  | "draft"
  | "awaiting_external_start"
  | "active"
  | "idle"
  | "jsonl_missing"
  | "launch_failed"
  | "done";

/**
 * The five "In Progress" states — a task that has been launched but is
 * not yet `done`. These are exactly the states from which a task can be
 * moved back to the Backlog (`POST /api/external/tasks/:id/backlog`,
 * iterate-2026-05-17-move-to-backlog / FR-01.32). `draft` (already in
 * Backlog) and `done` (terminal) are deliberately excluded.
 *
 * Verbatim mirror: `client/src/lib/taskLifecycle.ts` IN_PROGRESS_STATES.
 * The two halves are independent npm workspaces (DO-NOT guard #7 — no
 * cross-package import); keep this tuple and the client one in sync.
 */
export const BACKLOG_SOURCE_STATES = [
  "awaiting_external_start",
  "active",
  "idle",
  "jsonl_missing",
  "launch_failed",
] as const satisfies readonly ExternalTaskState[];

/** True when `state` is one of the five In-Progress {@link BACKLOG_SOURCE_STATES}. */
export function isBacklogSourceState(state: ExternalTaskState): boolean {
  return (BACKLOG_SOURCE_STATES as readonly ExternalTaskState[]).includes(state);
}


export interface ExternalTaskInboxState {
  pendingToolUseIds: string[];
  dismissedToolUseIds: string[];
  /** Byte offset in the JSONL up to which inbox-derive has processed. */
  lastProcessedByteOffset: number;
}

/**
 * iterate-2026-05-14 lead-foundation-task-schema — leadwright Phase 1.
 * Canonical source: leadwright/lib/lead-task-extension.ts (separate repo).
 * Inlined here per the spec's "Open questions" — the duplicated surface
 * is ~30 LOC and avoids cross-repo npm-link coupling. Field shapes are
 * locked; do not extend without revisiting that decision.
 *
 * Sub-object on `ExternalTask.leadHandoff` capturing the daemon-recorded
 * outcome of a lead-claimed task. Status is the discriminator; a row
 * whose status is outside the enum has the entire field dropped on load.
 */
export interface LeadHandoff {
  leadId: string;
  status: "completed" | "escalated" | "failed";
  beatsUsed: number;
  subIterateIds?: string[];
  summary: string;
  escalationReason?: string;
  learningsExtracted?: boolean;
}

export type LeadPriority = "P0" | "P1" | "P2" | "P3";
export type LeadComplexityHint = "small" | "medium" | "large";

export interface ExternalTask {
  taskId: string;
  sessionUuid: string;
  cwd: string;
  pluginDirs: string[];
  parentTaskId?: string;
  parentSessionUuid?: string;
  state: ExternalTaskState;
  title: string;
  /**
   * v2 — iterate 3 section 02. ADR-037. Always a non-empty string; the
   * reserved literal UNASSIGNED_PROJECT_ID represents tasks without a
   * chosen project (and deleted-project references resolved via O26).
   * v1 rows on disk are backfilled with UNASSIGNED_PROJECT_ID at load time.
   */
  projectId: string;
  /**
   * 2026-04-23 — captured at /launch time when NewIssueModal passes the
   * full action context. All five fields are optional so legacy rows
   * (pre-launch-wiring, back-compat test path, or manual API callers
   * that skip the new payload) keep loading cleanly. The launch route
   * persists them AFTER successful substitutePlaceholders — if the
   * substitution throws (unknown phase, newline in title or a parameter),
   * nothing is persisted.
   *
   * 2026-04-25 — iterate-custom-actions-generic-mode. Type widened from a
   * 4-id union to `string` so user-defined actions in `.shipwright-webui/actions.json`
   * (e.g. `new-content-orchestrator`) can flow through. Catalog membership
   * is the validity gate at /launch time — see routes.ts `unknown_action_id`.
   */
  actionId?: string;
  phase?: string;
  phaseLabel?: string;
  description?: string;
  autonomy?: "guided" | "autonomous";
  /**
   * v3 — iterate/multi-session-run-orchestrator-v2. Optional linkage to
   * a framework run-config v2 phase_task. When set, this task is a
   * "shadow" of an external multi-session phase the user is running.
   * - phaseTaskId   — the orchestrator's `phaseTaskId` (ptk-...)
   * - runId         — the owning run (run-XXXXXXXX)
   * - parentRunMaster — true if the shadow represents the master
   *   conversation (always false in this iterate; reserved for future).
   * Idempotency: the create-task route looks up existing tasks by
   * phaseTaskId before inserting; multiple Continue Pipeline clicks
   * for the same phase_task reuse the existing shadow.
   */
  phaseTaskId?: string;
  runId?: string;
  parentRunMaster?: boolean;
  /**
   * iterate-2026-05-14 lead-foundation-task-schema — leadwright Phase 1.
   * All additive + optional; the persisted shape writes only keys that are
   * set, and the loader soft-drops malformed values per-field (mirrors the
   * phaseTaskId / runId / parentRunMaster forward-compat tolerance).
   * User-creatable via POST /api/external/tasks: domain, priority,
   * complexityHint, tags, blockedBy. Daemon-owned (NOT webui-writable; see
   * MED-4 in routes.ts): leadParentTaskId, poFeedback, claimToken, claimedBy,
   * claimedAt, claimPid, leadHandoff, promotedFromTriageId.
   */
  domain?: string;
  priority?: LeadPriority;
  complexityHint?: LeadComplexityHint;
  tags?: string[];
  blockedBy?: string[];
  leadParentTaskId?: string;
  poFeedback?: string;
  claimToken?: string;
  claimedBy?: string;
  claimedAt?: string;
  claimPid?: number;
  leadHandoff?: LeadHandoff;
  promotedFromTriageId?: string;
  /** v4 — sticky user-owned board-column override (write-on-touch). */
  boardColumn?: BoardColumn;
  /** S1 — durable iterate association (see mission-context/association.ts); NOT `runId`. */
  missionContext?: MissionContextAssociation;
  createdAt: string;
  launchedAt?: string;
  firstJsonlObservedAt?: string;
  lastJsonlSeenMtimeMs?: number;
  inbox: ExternalTaskInboxState;
}

export interface SdkSessionsFile {
  schemaVersion: 1 | 2 | 3 | 4;
  sessions: Record<string, ExternalTask>;
}

export interface SdkSessionsStoreDeps {
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive: boolean }) => void;
  /** Optional proper-lockfile wrapper; omitted in tests. */
  lock?: (path: string) => Promise<() => Promise<void>>;
  /** Creates an empty file if missing (proper-lockfile requires lstat). */
  ensureFile: (path: string) => void;
  /** Optional atomic rename (default `fs.promises.rename`); omitted in unit doubles. */
  rename?: (from: string, to: string) => Promise<void>;
  /**
   * Optional — section 02 O26. If provided, v2-loaded rows whose
   * projectId is not in this set are resolved to UNASSIGNED_PROJECT_ID
   * in memory. Next persist() writes the canonical value back.
   * Omitted in unit tests (skips the resolve step).
   */
  getKnownProjectIds?: () => Set<string>;
}

const CURRENT_SCHEMA_VERSION = 4 as const;

export class SdkSessionsStore {
  private readonly path: string;
  private readonly deps: SdkSessionsStoreDeps;
  private sessions = new Map<string, ExternalTask>();
  /** Deep-copy of `sessions` at load()/last-persist — the 3-way merge base (F08). */
  private baseline = new Map<string, ExternalTask>();
  /** ids deleted since baseline — merge drops them so a delete beats disk churn (F08). */
  private deletedSinceBaseline = new Set<string>();
  private loaded = false;

  constructor(path: string, deps: SdkSessionsStoreDeps) {
    this.path = path;
    this.deps = deps;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.deps.existsSync(this.path)) {
      this.sessions.clear();
      this.loaded = true;
      return;
    }
    let raw: string;
    try {
      raw = await this.deps.readFile(this.path, "utf-8");
    } catch {
      // Unreadable file → start empty. Write path will create a fresh one.
      this.sessions.clear();
      this.loaded = true;
      return;
    }
    if (!raw.trim()) {
      this.sessions.clear();
      this.loaded = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupted top-level JSON → don't silently wipe; rename aside + start empty.
      const asideName = `${this.path}.corrupt-${Date.now()}`;
      try {
        await this.deps.writeFile(asideName, raw);
      } catch { /* ignore */ }
      this.sessions.clear();
      this.loaded = true;
      return;
    }

    // Schema-version gate. We accept v1, v2, and v3 (ADR-038 +
    // iterate/multi-session-run-orchestrator-v2). Anything else → start
    // empty (future version, won't silently misinterpret).
    const schemaVersion =
      parsed && typeof parsed === "object" && "schemaVersion" in parsed
        ? (parsed as { schemaVersion: unknown }).schemaVersion
        : undefined;
    if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4) {
      this.sessions.clear();
      this.loaded = true;
      return;
    }

    const sessionsObj =
      parsed && typeof parsed === "object" && "sessions" in parsed
        ? (parsed as { sessions: unknown }).sessions
        : undefined;
    if (!sessionsObj || typeof sessionsObj !== "object") {
      this.sessions.clear();
      this.loaded = true;
      return;
    }

    // Per-entry fault isolation: a bad row is dropped, the rest survive.
    for (const [taskId, value] of Object.entries(sessionsObj as Record<string, unknown>)) {
      const task = validateExternalTask(
        taskId,
        value,
        schemaVersion as 1 | 2 | 3 | 4,
      );
      if (task) this.sessions.set(taskId, task);
    }

    // Baseline = RAW on-disk rows (pre-O26). O26 below is a local change this
    // instance makes, so it must read as a diff the merge propagates — else
    // persist would take disk's stale projectId back and O26 never reaches disk (F08).
    this.baseline = cloneSessions(this.sessions);

    // O26: resolve stale projectId references to UNASSIGNED. Only runs when the
    // wiring provides a known-project-id set (production has it; unit tests
    // typically don't — fine, they test the pre-resolve shape).
    if (this.deps.getKnownProjectIds) {
      const known = this.deps.getKnownProjectIds();
      for (const task of this.sessions.values()) {
        if (
          task.projectId !== UNASSIGNED_PROJECT_ID &&
          !known.has(task.projectId)
        ) {
          task.projectId = UNASSIGNED_PROJECT_ID;
        }
      }
    }

    this.loaded = true;
  }

  create(args: {
    title: string;
    cwd: string;
    pluginDirs?: string[];
    parentTaskId?: string;
    parentSessionUuid?: string;
    /**
     * v2 — iterate 3 section 02. Defaults to UNASSIGNED_PROJECT_ID when
     * omitted. Callers that know the active project (e.g. the inline
     * task-creation form on TaskBoardPage) pass it explicitly.
     */
    projectId?: string;
    /**
     * 2026-04-23 — iterate-20260423-chat-livetest-2 AC-B. Phase is
     * validated by the route against the project's actions catalog
     * BEFORE reaching this method; the label is derived server-side
     * from the matched catalog entry. Both fields are optional so the
     * legacy inline create flow + unassigned tasks still work.
     */
    phase?: string;
    phaseLabel?: string;
    /**
     * 2026-05-05 — Save-to-Backlog wiring. Persisted at create-time so
     * a later TaskCard "Launch" click on a draft task recovers the right
     * command_template via routes.ts:421 fallback. The route validates
     * catalog membership at /launch time (`unknown_action_id` 400).
     */
    actionId?: string;
    /**
     * v3 — iterate/multi-session-run-orchestrator-v2. When the caller
     * passes a sessionUuid (Continue Pipeline path), it overrides the
     * auto-generated one — the framework's orchestrator has pre-bound
     * the uuid in run-config and the user's CLI launch must use it. The
     * route validates the uuid format + that it matches a phase_task
     * BEFORE calling here; this method trusts the caller.
     */
    sessionUuid?: string;
    phaseTaskId?: string;
    runId?: string;
    parentRunMaster?: boolean;
    /**
     * iterate-2026-05-14 lead-foundation-task-schema — only the 5
     * user-creatable fields are accepted here. The daemon-owned fields
     * (`claimToken`, `leadHandoff`, etc.) are NOT exposed on the create
     * signature; the daemon mutates them via the claim helper that lives
     * in the leadwright repo. External review MED-4.
     */
    domain?: string;
    priority?: LeadPriority;
    complexityHint?: LeadComplexityHint;
    tags?: string[];
    blockedBy?: string[];
    /**
     * iterate-2026-05-14 triage-tab (ADR-101) — back-ref to the upstream
     * triage item id (`trg-<8hex>`). Set EXCLUSIVELY by the
     * `/api/triage/:projectId/promote` route. Public POST
     * `/api/external/tasks` does NOT accept this field (narrow write
     * surface, mirrors the ADR-100 MED-4 pattern for daemon-only fields).
     */
    promotedFromTriageId?: string;
    /**
     * iterate-2026-05-18-edit-task-dialog — the task brief / initial
     * prompt. Previously only persisted by the /launch route; "Save to
     * Backlog" dropped it entirely. The route trims + length-caps before
     * calling here, so this method just stores whatever it is handed.
     */
    description?: string;
  }): ExternalTask {
    const task: ExternalTask = {
      taskId: randomUUID(),
      sessionUuid: args.sessionUuid ?? randomUUID(),
      cwd: args.cwd,
      pluginDirs: args.pluginDirs ?? [],
      parentTaskId: args.parentTaskId,
      parentSessionUuid: args.parentSessionUuid,
      title: args.title,
      projectId:
        typeof args.projectId === "string" && args.projectId.trim()
          ? args.projectId.trim()
          : UNASSIGNED_PROJECT_ID,
      state: "draft",
      createdAt: new Date().toISOString(),
      inbox: {
        pendingToolUseIds: [],
        dismissedToolUseIds: [],
        lastProcessedByteOffset: 0,
      },
    };
    if (args.phase) task.phase = args.phase;
    if (args.phaseLabel) task.phaseLabel = args.phaseLabel;
    if (args.actionId) task.actionId = args.actionId;
    // iterate-2026-05-18-edit-task-dialog — persist the description at
    // create-time so a "Save to Backlog" draft retains its brief.
    if (typeof args.description === "string" && args.description.length > 0) {
      task.description = args.description;
    }
    if (args.phaseTaskId) task.phaseTaskId = args.phaseTaskId;
    if (args.runId) task.runId = args.runId;
    if (typeof args.parentRunMaster === "boolean") {
      task.parentRunMaster = args.parentRunMaster;
    }
    // iterate-2026-05-14 lead-foundation: assign only when the caller passed
    // the field, so omitted fields stay absent (JSON.stringify drops the rest).
    if (typeof args.domain === "string") task.domain = args.domain;
    if (args.priority) task.priority = args.priority;
    if (args.complexityHint) task.complexityHint = args.complexityHint;
    if (Array.isArray(args.tags)) task.tags = args.tags;
    if (Array.isArray(args.blockedBy)) task.blockedBy = args.blockedBy;
    // iterate-2026-05-14 triage-tab (ADR-101): back-ref to the promoted triage
    // item. Set ONLY by /api/triage/:projectId/promote (not public POST
    // /api/external/tasks); daemon-only-fields pattern from ADR-100.
    if (typeof args.promotedFromTriageId === "string") {
      task.promotedFromTriageId = args.promotedFromTriageId;
    }
    this.sessions.set(task.taskId, task);
    return task;
  }

  /**
   * v3 — find an existing non-terminal task by `phaseTaskId`. Used by the
   * create-task route to make Continue Pipeline launches idempotent: a second
   * click on the same phase_task reuses the prior shadow (review O #6). Returns
   * the first match (only one non-terminal shadow per phase_task; defensive).
   */
  findByPhaseTaskId(phaseTaskId: string): ExternalTask | undefined {
    for (const t of this.sessions.values()) {
      if (t.phaseTaskId === phaseTaskId && t.state !== "done") return t;
    }
    return undefined;
  }

  /**
   * iterate-2026-05-14 triage-tab (ADR-101) — find an existing task by
   * `promotedFromTriageId`. Used by the promote route to make
   * Promote idempotent: if a previous attempt completed step 5 (created
   * task) but step 7 (status flip) failed, the retry must NOT create
   * another task — it must reuse the existing one and re-attempt the
   * status flip. Mirrors the `findByPhaseTaskId` pattern.
   *
   * Includes done-state tasks too (unlike findByPhaseTaskId): a triage
   * item promoted to a task that's been completed should still block
   * a re-promote attempt; the back-ref is unique per triage id.
   */
  findByPromotedFromTriageId(triageId: string): ExternalTask | undefined {
    for (const t of this.sessions.values()) {
      if (t.promotedFromTriageId === triageId) return t;
    }
    return undefined;
  }

  get(taskId: string): ExternalTask | undefined {
    return this.sessions.get(taskId);
  }

  list(): ExternalTask[] {
    return Array.from(this.sessions.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  /** Apply a partial patch to a task; returns the updated copy or undefined. */
  patch(taskId: string, patch: Partial<ExternalTask>): ExternalTask | undefined {
    const task = this.sessions.get(taskId);
    if (!task) return undefined;
    Object.assign(task, patch);
    return task;
  }

  delete(taskId: string): boolean {
    const existed = this.sessions.delete(taskId);
    // Track deletes of rows that exist on disk (in baseline) so the next
    // merge drops them unconditionally — a delete must beat a concurrent
    // instance's ~1/sec poll rewrite (F08). Cleared after a successful persist.
    if (existed && this.baseline.has(taskId)) this.deletedSinceBaseline.add(taskId);
    return existed;
  }

  /** Merge under the lock (F08 header note) + atomically flush. `await` after any mutation. */
  async persist(): Promise<void> {
    // Ensure parent dir + file exist before locking (proper-lockfile lstats).
    const lastSlash = Math.max(this.path.lastIndexOf("/"), this.path.lastIndexOf("\\"));
    if (lastSlash !== -1) {
      const dir = this.path.slice(0, lastSlash);
      if (!this.deps.existsSync(dir)) this.deps.mkdirSync(dir, { recursive: true });
    }
    this.deps.ensureFile(this.path);

    const release = this.deps.lock ? await this.deps.lock(this.path) : null;
    try {
      // F08 — UNDER the lock, re-read + 3-way merge onto disk (read-only): a
      // concurrent instance's rows + external claims survive, only fields THIS
      // instance changed win, deletes always win. corrupt disk → recover (write
      // full memory); FUTURE schemaVersion → ABORT (don't downgrade a newer file);
      // a transient read I/O error retries then rejects inside reReadDisk (never
      // clobbers). The merge is applied into this.sessions SYNCHRONOUSLY before
      // the write await, so a create/patch/delete during the write lands on the
      // LIVE map + is preserved for the next persist (never lost to a stale swap).
      // No lock ⇒ no cross-process coordination possible → write memory directly.
      if (release) {
        const rr = await reReadDisk(this.deps, this.path, CURRENT_SCHEMA_VERSION, validateExternalTask);
        if (rr.kind === "future") throw new Error("sdk-sessions.json on disk has a newer schemaVersion than this build supports — refusing to overwrite (version mismatch)");
        if (rr.kind === "ok") this.sessions = mergeSessions(this.baseline, this.sessions, rr.disk, this.deletedSinceBaseline);
        // rr.kind === "corrupt": keep this.sessions (full-write recover)
      }

      // Snapshot EXACTLY what we write (immune to concurrent mutation during the
      // await) + which deletes this write reconciles — both captured pre-await.
      const snapshot = cloneSessions(this.sessions);
      const reconciledDeletes = new Set(this.deletedSinceBaseline);
      const payload = { schemaVersion: CURRENT_SCHEMA_VERSION, sessions: Object.fromEntries(snapshot) } satisfies SdkSessionsFile;
      await atomicWriteFile(this.deps, this.path, JSON.stringify(payload, null, 2), Boolean(release));

      // On success only: baseline = what was actually written (NOT the possibly-
      // mutated live map); drop ONLY the reconciled tombstones so a delete during
      // the write survives to the next persist.
      this.baseline = snapshot;
      for (const id of reconciledDeletes) this.deletedSinceBaseline.delete(id);
    } finally {
      if (release) await release();
    }
  }
}
