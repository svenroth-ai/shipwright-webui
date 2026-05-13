/*
 * /api/external/* — Sub-iterate 1 production routes.
 *
 * Stays under /api/external for now so it doesn't collide with the
 * existing /api/tasks (which still drives the old chat UI). Sub-iterate 2
 * renames to /api/tasks after deleting the chat surface.
 *
 * Backed by the promoted core modules:
 *   - core/launcher.ts         (copy-command generation)
 *   - core/session-watcher.ts  (filename-first discovery + byte-range read)
 *   - core/session-parser.ts   (server-side parser for inbox)
 *   - core/inbox-derive.ts     (pending tool_use extraction)
 *   - core/sdk-sessions-store.ts (persisted task metadata)
 *   - core/cli-compat.ts       (version-gate injection for diagnostics)
 */

import { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

import { buildCopyCommands } from "../core/launcher.js";
import { pathGuard, realPathGuard } from "../core/path-guard.js";
import { loadIgnore } from "../core/gitignore-cache.js";
import {
  buildExternalLaunchCommand,
  substitutePlaceholders,
  UnknownPhaseError,
  InvalidDescriptionError,
  InvalidParameterError,
  InvalidPlaceholderError,
  type SubstitutionContext,
} from "../core/actions-substitute.js";
import {
  loadActionsForProject,
  clearActionsCacheForProject,
  type ResolvedActions,
} from "../core/project-actions-loader.js";
import {
  validateActionsSchema,
  type SchemaError,
} from "../core/actions-schema-validator.js";
import {
  checkContractVersion,
  ACTIONS_SCHEMA_VERSION,
} from "../core/contract-version.js";
import { resolveParameters } from "../core/parameter-resolver.js";
import { PARAM_NAME_PATTERN } from "../types/action-schema.js";
import {
  PreviewExitedEarlyError,
  PreviewPortInUseError,
  PreviewProfileInvalidError,
  PreviewSessionManager,
  PreviewSpawnFailedError,
  PreviewTimeoutError,
  type PreviewProfile,
} from "../core/preview-session-manager.js";
import { loadProfile, getProfilesDir } from "../core/profile-loader.js";
import {
  readRunConfig as defaultReadRunConfig,
  type RunConfigReadResult,
} from "../core/run-config-reader.js";
import {
  deriveReadyToLaunchTasks,
  buildPhaseTaskName,
  PHASE_TASK_ID_PATTERN,
  RUN_ID_PATTERN,
  SESSION_UUID_PATTERN,
  SLASH_COMMAND_PATTERN,
  SPLIT_ID_SAFE_PATTERN,
} from "../types/run-config-v2.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { parseSessionJsonl } from "../core/session-parser.js";
import { deriveInbox, DEFAULT_USER_BLOCKING_TOOLS } from "../core/inbox-derive.js";
import {
  SdkSessionsStore,
  UNASSIGNED_PROJECT_ID,
  type ExternalTask,
  type ExternalTaskState,
} from "../core/sdk-sessions-store.js";

const ACTIVE_IDLE_THRESHOLD_MS = 120_000;
const IDLE_REACTIVATE_THRESHOLD_MS = 5_000;

/*
 * Iterate 3 remediation — Phase A4 (BUG 3 fix, 2026-04-20).
 *
 * `/api/external/inbox` used to re-parse the entire JSONL for every
 * tracked task on every request (9–10 s latency against 216 sessions
 * observed in UAT). The cache below memoizes the derived pending set
 * keyed by `(sessionUuid, mtimeMs, dismissedKey, contentLength)`.
 *
 * - mtimeMs change (new events written) busts the cache naturally.
 * - dismissedKey busts the cache when the user dismisses an entry so
 *   the next inbox call reflects the reduced pending set.
 * - contentLength captures the `lastProcessedByteOffset` we persist to
 *   the store, so callers see a coherent pair.
 *
 * Pattern mirrors `core/project-actions-loader.ts:52-68`. No explicit
 * invalidation needed; the key tuple naturally covers all cases.
 */
interface InboxDeriveCacheEntry {
  /** Resolved on-disk path — lets us `stat()` directly on warm calls
   *  instead of rescanning every subdir of ~/.claude/projects via
   *  findByUuid (the actual hot-spot — the JSONL parse is cheap by
   *  comparison). Falls back to findByUuid on stat failure. */
  resolvedPath: string;
  mtimeMs: number;
  contentLength: number;
  dismissedKey: string;
  entries: Array<{
    toolUseId: string;
    toolName: string;
    input: unknown;
    taskTitle: string;
  }>;
  pendingIds: string[];
}
const inboxDeriveCache = new Map<string, InboxDeriveCacheEntry>();

/**
 * Negative-result cache for `findByUuid` misses (Phase A4). Sessions
 * that haven't materialized on disk yet (e.g. `awaiting_external_start`
 * tasks where the user hasn't pasted the launch command) previously
 * triggered a full readdir scan across every subdirectory of
 * `~/.claude/projects` on EVERY inbox call — the dominant latency
 * source (60+ sessions × 216 subdir scans).
 *
 * With a short TTL we skip the scan for sessions we recently confirmed
 * don't exist. The TTL is intentionally short so launch → discovery
 * still converges quickly (~15 s worst case).
 */
const NEGATIVE_RESULT_TTL_MS = 15_000;
const inboxNegativeCache = new Map<string, number>();

/** Test helper — drops the per-session inbox caches. */
export function clearInboxDeriveCache(): void {
  inboxDeriveCache.clear();
  inboxNegativeCache.clear();
}

/** Hard cap on user-assigned titles. CLI accepts more, but UI legibility
 * (TaskBoard cards, terminal title bar) breaks past ~200 chars. */
const TITLE_MAX_LENGTH = 200;

export interface ExternalRouteProjectView {
  id: string;
  name: string;
  path: string;
  profile?: string;
  synthesized?: boolean;
  settings?: { color?: string };
}

export function createExternalRoutes(args: {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
  /**
   * Section 02 (iterate 3) — validates projectId on PATCH / POST. Returns
   * the set of non-synthesized project ids currently known to the server.
   * The reserved UNASSIGNED_PROJECT_ID sentinel is accepted independently
   * of this set. Omitted in legacy callers — PATCH projectId support is
   * gated on presence (iterate-2 callers still work without it, and the
   * route returns 400 "projectId not supported" if a client sends one
   * without wiring).
   */
  getKnownProjectIds?: () => Set<string>;
  /**
   * Section 03 (iterate 3) — look up a registered project by id. Used by
   * GET /projects/:id/actions + POST /projects/:id/preview +
   * POST /projects/:id/actions-stub. The synthesized "unassigned" row is
   * NOT returned from here (it has no filesystem path).
   */
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  /**
   * Section 03 — preview-session manager instance, shared across requests
   * so the dedup cache holds between POSTs. Injected by index.ts;
   * test harnesses can pass a fresh instance per test.
   */
  previewManager?: PreviewSessionManager;
  /**
   * Section 03 — loads a profile by name. Defaults to the real
   * `core/profile-loader.ts` entry; tests inject a synthetic profile.
   */
  loadProfile?: (profileName: string) => PreviewProfile | null;
  /**
   * iterate/multi-session-run-orchestrator-v2 — reads a project's
   * shipwright_run_config.json. Tests inject a stub so they don't
   * touch the filesystem; production wires the real reader.
   */
  readRunConfig?: (projectPath: string) => Promise<RunConfigReadResult>;
  /**
   * Iterate-2026-05-04 (ADR-068-A1) — best-effort scrollback cleanup
   * cascade on DELETE /api/external/tasks/:id. Optional for tests;
   * production wires the singleton ScrollbackStore.
   */
  scrollbackClearBestEffort?: (taskId: string) => Promise<void>;
  /**
   * Iterate-2026-05-12 (ADR-087, MEDIUM-B1 fix) — best-effort snapshot
   * cleanup cascade on DELETE /api/external/tasks/:id. Optional for
   * tests; production wires the singleton SnapshotStore. Snapshots
   * capture rendered cell-state and may contain secrets; the 24-h TTL
   * is a backstop, the task delete is the authoritative privacy
   * boundary.
   */
  snapshotClearBestEffort?: (taskId: string) => Promise<void>;
  /**
   * iterate-2026-05-08 v0.8.7 AC-1 — required injection of the pty
   * lookup so the transcript poll can flip `new-plain` tasks from
   * `active` → `idle` when the pty is gone (idle-ceiling, /close,
   * server-restart, DELETE cascade).
   *
   * Required (NOT optional) per external plan review 2026-05-08
   * (gemini + openai): optional production dependencies hide
   * misconfiguration. Tests pass `{ get: () => undefined }`; the
   * production caller in `index.ts` passes the singleton.
   */
  ptyManager: { get(taskId: string): unknown };
}) {
  const app = new Hono();
  const {
    store,
    watcher,
    getKnownProjectIds,
    getProjectById,
    previewManager,
    loadProfile: injectedLoadProfile,
    scrollbackClearBestEffort,
    snapshotClearBestEffort,
    ptyManager,
  } = args;
  // iterate-2026-05-08 v0.8.7 AC-1 — runtime guard (per external code
  // review openai medium): TypeScript-only requirement is bypassable in
  // plain JS or via type-erased callsites. Validate the contract at
  // construction time so the failure surfaces here, not at the first
  // transcript-poll N requests later.
  if (!ptyManager || typeof ptyManager.get !== "function") {
    throw new Error(
      "createExternalRoutes: required arg `ptyManager` is missing or invalid (must expose `get(taskId)`)",
    );
  }
  const profileResolver =
    injectedLoadProfile ??
    ((name: string) => loadProfile(name, getProfilesDir()) as PreviewProfile | null);
  const runConfigReader = args.readRunConfig ?? ((p: string) => defaultReadRunConfig(p));

  /**
   * Iterate G (ADR-095) — augment a serialized task with `liveSession`,
   * derived from `ptyManager.get(taskId) !== undefined`. The persisted
   * `ExternalTask` shape on disk does NOT include this field; it is
   * computed at response time from in-memory pty state. The client
   * uses it to gate the header Resume CTA — while the pty is alive,
   * the user types directly into the embedded terminal instead.
   *
   * Defensive: handles undefined / null input (returns it unchanged)
   * so callers that already 404'd can still pass-through. Returns a
   * shallow clone so callers don't mutate the live store entry.
   */
  function withLiveSession<T extends ExternalTask | undefined | null>(
    task: T,
  ): T extends ExternalTask ? ExternalTask & { liveSession: boolean } : T {
    if (!task) return task as never;
    return {
      ...task,
      liveSession: ptyManager.get(task.taskId) !== undefined,
    } as never;
  }

  app.post("/api/external/tasks", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Untitled task";
    const cwd = typeof body.cwd === "string" && body.cwd.trim()
      ? body.cwd.trim()
      : process.cwd();
    const pluginDirs = Array.isArray(body.pluginDirs)
      ? body.pluginDirs.filter((p: unknown): p is string => typeof p === "string")
      : [];
    // Section 02 (iterate 3) — allow callers to pass an explicit projectId
    // at creation. Defaults to UNASSIGNED_PROJECT_ID via the store. Invalid
    // ids are rejected symmetrically with PATCH so the TaskBoard inline
    // form can't leak a stale project id from a deleted project.
    let projectId: string | undefined;
    if (typeof body.projectId === "string" && body.projectId.trim()) {
      const candidate = body.projectId.trim();
      const validation = validateProjectIdOrError(candidate, getKnownProjectIds);
      if (validation) return c.json(validation, 400);
      projectId = candidate;
    }

    // 2026-04-23 — iterate-20260423-chat-livetest-2 AC-B. Phase persisted
    // on CREATION when the project's actions catalog validates the id.
    // Server derives phaseLabel from the catalog entry — client-sent
    // label is intentionally dropped (external review GPT #2 — avoids
    // label drift when the UI caches stale actions.json).
    //
    // Reject (not silently drop) when phase is supplied without a
    // resolvable project — the client has no way to discover which
    // phases are valid without a catalog, so sending phase there is a
    // bug (code-review blocker #2 / Gemini #2 — never lose user input
    // silently). Callers who don't know the project must omit phase.
    let phase: string | undefined;
    let phaseLabel: string | undefined;
    const rawPhase =
      typeof body.phase === "string" && body.phase.trim()
        ? body.phase.trim()
        : undefined;
    if (rawPhase) {
      if (!projectId) {
        return c.json(
          {
            error: "phase_requires_project",
            detail:
              "Phase cannot be validated without a projectId — " +
              "unassigned tasks have no actions catalog.",
          },
          400,
        );
      }
      const project = getProjectById?.(projectId);
      if (!project) {
        return c.json(
          {
            error: "phase_requires_project",
            detail: `Phase cannot be validated — project '${projectId}' has no resolvable catalog.`,
          },
          400,
        );
      }
      const loaded = loadActionsForProject(project.path || "");
      const match = loaded.actions.phases.find((p) => p.id === rawPhase);
      if (!match) {
        return c.json(
          {
            error: "invalid_phase",
            detail: `Phase '${rawPhase}' is not in this project's actions catalog.`,
            allowed: loaded.actions.phases.map((p) => p.id),
          },
          400,
        );
      }
      phase = match.id;
      phaseLabel = match.label;
    }

    // iterate/multi-session-run-orchestrator-v2 — Phase-task linkage
    // (review O #5/#6 + plan A4/A6.5). When the body carries phase-task
    // metadata, validate the shapes here and reuse an existing
    // non-terminal shadow if one already maps to the same phaseTaskId
    // (idempotency for repeat Continue Pipeline clicks).
    const phaseTaskRefs = resolvePhaseTaskCreateFields(body);
    if ("error" in phaseTaskRefs) {
      return c.json(phaseTaskRefs.error, phaseTaskRefs.status);
    }
    if (phaseTaskRefs.phaseTaskId) {
      const existing = store.findByPhaseTaskId(phaseTaskRefs.phaseTaskId);
      if (existing) {
        return c.json({ task: withLiveSession(existing), reused: true });
      }
    }

    // 2026-05-05 — Save-to-Backlog wiring. Persist the chosen action id at
    // create-time so a later TaskCard "Launch" click can recover the right
    // command_template via routes.ts:421 fallback. Catalog membership is
    // not validated here — the /launch handler already rejects unknown ids
    // (`unknown_action_id` 400). Empty/non-string actionId is dropped.
    const createActionId =
      typeof body.actionId === "string" && body.actionId.trim().length > 0
        ? body.actionId.trim()
        : undefined;

    const task = store.create({
      title,
      cwd,
      pluginDirs,
      projectId,
      phase,
      phaseLabel,
      actionId: createActionId,
      sessionUuid: phaseTaskRefs.sessionUuid,
      phaseTaskId: phaseTaskRefs.phaseTaskId,
      runId: phaseTaskRefs.runId,
      parentRunMaster: phaseTaskRefs.parentRunMaster,
    });
    await store.persist();
    return c.json({ task: withLiveSession(task) });
  });

  app.get("/api/external/tasks", (c) => {
    // Section 02 — optional ?projectId=<id> filter. Unvalidated on read
    // (unknown id → empty list, not 400) because an orphaned URL from a
    // deleted project is a benign state, not a user error. The reserved
    // "unassigned" literal is a valid filter value for the synthesized
    // bucket.
    const filter = c.req.query("projectId");
    const all = store.list();
    const filtered = filter ? all.filter((t) => t.projectId === filter) : all;
    // Iterate G (ADR-095): augment each entry with `liveSession` so the
    // header Resume CTA can hide while the pty is alive.
    const tasks = filtered.map((t) => withLiveSession(t));
    return c.json({ tasks });
  });

  app.get("/api/external/tasks/:id", (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    // Iterate G (ADR-095) — augment with liveSession.
    return c.json({ task: withLiveSession(task) });
  });

  app.post("/api/external/tasks/:id/launch", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const resume = Boolean(body.resume);
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);

    // Section 03 (iterate 3) — O20 idempotency guard.
    //
    // The spec language "state ∈ {pending, backlog}" loosely maps to our
    // enum's `draft` + `awaiting_external_start` + `launch_failed`. The
    // intent is: reject re-launches against a TERMINAL state (done). The
    // existing Resume / Fork flows (LaunchRow) already call this route
    // against `active` and `idle` — the `resume: true` branch emits a new
    // copy-command to pick up where the user left off, which is a valid
    // re-launch. We therefore reject ONLY `done` and `launch_failed`
    // when no explicit resume intent is present.
    //
    // Note: `launch_failed` is accepted (the user is retrying after a
    // clipboard hiccup). `done` is terminal — closing a task is an
    // explicit user action and a re-launch after close is almost always
    // unintended.
    if (task.state === "done") {
      return c.json(
        { error: "launch_invalid_state", state: task.state },
        409,
      );
    }

    // 2026-04-23 — iterate-20260423-launch-command-wiring.
    //
    // When NewIssueModal passes the full action context (actionId + phase
    // + phaseLabel + description + autonomy), we resolve the project's
    // actions catalog and run substitutePlaceholders against the matching
    // action's `command_template`. That yields a command string containing
    // the slash command, --project-root, --autonomous, and the description
    // trailer. Without actionId we fall back to the pre-iterate legacy
    // shape (--session-id + --add-dir + --name + --plugin-dir) — that
    // preserves existing Resume/Fork call sites and spec 30/36.
    const description =
      typeof body.description === "string" ? body.description : undefined;
    const autonomy =
      body.autonomy === "autonomous" || body.autonomy === "guided"
        ? (body.autonomy as "autonomous" | "guided")
        : undefined;
    // 2026-04-25 — iterate-custom-actions-generic-mode. The bundled IDs
    // (`new-task`/`new-pipeline`/`new-iterate`/`new-plain`) are no longer
    // a hard allowlist; any non-empty action id pulled from the project's
    // `.webui/actions.json` is accepted. Authoritative validation happens
    // below via the catalog lookup (`unknown_action_id` 400). The
    // shape-check here only rejects non-string / empty values so callers
    // can't smuggle structural garbage into substitutePlaceholders.
    const bodyActionId =
      typeof body.actionId === "string" && body.actionId.trim().length > 0
        ? body.actionId.trim()
        : undefined;
    const bodyPhase =
      typeof body.phase === "string" && body.phase.trim()
        ? body.phase.trim()
        : undefined;
    const bodyPhaseLabel =
      typeof body.phaseLabel === "string" && body.phaseLabel.trim()
        ? body.phaseLabel.trim()
        : undefined;

    // v0.4.1 — root-cause fix for the "phase disappears on Resume / TaskCard
    // launch" bug. When the request body omits actionId / phase /
    // phaseLabel, fall back to the values persisted on the task at create
    // time. This makes once-set-always-used the contract: TaskCard's
    // green Launch button + Terminal Resume + any other launch path that
    // doesn't carry the full action context will still produce a properly
    // substituted command instead of falling through to the legacy path
    // that loses phase + actionId silently.
    const taskActionId =
      typeof task.actionId === "string" && task.actionId.trim().length > 0
        ? task.actionId
        : undefined;
    const actionId = bodyActionId ?? taskActionId;
    const phase = bodyPhase ?? task.phase;
    const phaseLabel = bodyPhaseLabel ?? task.phaseLabel;

    // iterate/launch-cli-parameters § 5 — body parameters validation.
    // Shape: Record<string, string | boolean>; key allowlist is the
    // PARAM_NAME_PATTERN (matches schema.name validity).
    let userParams: Record<string, string | boolean> | undefined;
    if (body.parameters !== undefined) {
      if (
        body.parameters === null ||
        typeof body.parameters !== "object" ||
        Array.isArray(body.parameters)
      ) {
        return c.json(
          { error: "invalid_parameters_body", detail: "parameters must be an object" },
          400,
        );
      }
      userParams = {};
      for (const [k, v] of Object.entries(
        body.parameters as Record<string, unknown>,
      )) {
        if (!PARAM_NAME_PATTERN.test(k)) {
          return c.json(
            { error: "invalid_parameters_body", detail: `bad key: ${k}` },
            400,
          );
        }
        if (typeof v !== "string" && typeof v !== "boolean") {
          return c.json(
            {
              error: "invalid_parameters_body",
              detail: `value for ${k} must be string or boolean`,
            },
            400,
          );
        }
        userParams[k] = v;
      }
    }

    let commands;
    const taskUpdate: Partial<ExternalTask> = {
      state: "awaiting_external_start",
      launchedAt: new Date().toISOString(),
    };

    // iterate/multi-session-run-orchestrator-v2 — Plan A6 + A8.
    //
    // phaseTaskRef branch: client passes ONLY the phaseTaskId; the server
    // re-reads the project's run-config and verifies the entire phase_task
    // before producing a command. This is the load-bearing security path —
    // the client never gets to dictate sessionUuid / slashCommand directly.
    const phaseTaskRefRaw = body.phaseTaskRef;
    if (phaseTaskRefRaw !== undefined) {
      if (actionId) {
        return c.json(
          {
            error: "mixed_launch_intents",
            detail: "phaseTaskRef and actionId are mutually exclusive",
          },
          400,
        );
      }
      if (
        !phaseTaskRefRaw ||
        typeof phaseTaskRefRaw !== "object" ||
        Array.isArray(phaseTaskRefRaw)
      ) {
        return c.json(
          { error: "invalid_phase_task_ref", detail: "must be an object" },
          400,
        );
      }
      const refPhaseTaskId = (phaseTaskRefRaw as Record<string, unknown>)
        .phaseTaskId;
      if (
        typeof refPhaseTaskId !== "string" ||
        !PHASE_TASK_ID_PATTERN.test(refPhaseTaskId)
      ) {
        return c.json(
          { error: "invalid_phase_task_id", detail: "must match /^ptk-[0-9a-f]{4,}$/" },
          400,
        );
      }
      const project = getProjectById?.(task.projectId);
      if (!project || !project.path) {
        return c.json(
          { error: "phase_task_requires_project", projectId: task.projectId },
          400,
        );
      }
      const cfgRead = await runConfigReader(project.path);
      if (cfgRead.status !== "ok") {
        return c.json(
          {
            error: "run_config_unavailable",
            status: cfgRead.status,
            ...(cfgRead.status === "invalid" ? { reason: cfgRead.reason } : {}),
          },
          409,
        );
      }
      const phaseTask = cfgRead.config.phase_tasks.find(
        (t) => t.phaseTaskId === refPhaseTaskId,
      );
      if (!phaseTask) {
        return c.json(
          { error: "phase_task_not_found", phaseTaskId: refPhaseTaskId },
          409,
        );
      }
      if (phaseTask.status !== "awaiting_launch") {
        return c.json(
          {
            error: "phase_task_not_actionable",
            phaseTaskId: refPhaseTaskId,
            status: phaseTask.status,
          },
          409,
        );
      }
      const completed = new Set(cfgRead.config.completed_phase_task_ids);
      if (!phaseTask.prerequisites.every((p) => completed.has(p))) {
        return c.json(
          {
            error: "phase_task_prereq_not_met",
            phaseTaskId: refPhaseTaskId,
            prerequisites: phaseTask.prerequisites,
            completed: cfgRead.config.completed_phase_task_ids,
          },
          409,
        );
      }
      // Defense in depth even though the reader already validated these.
      if (!SLASH_COMMAND_PATTERN.test(phaseTask.slashCommand)) {
        return c.json(
          {
            error: "phase_task_corrupt",
            detail: "slashCommand fails strict regex",
          },
          409,
        );
      }
      if (
        phaseTask.splitId !== null &&
        !SPLIT_ID_SAFE_PATTERN.test(phaseTask.splitId)
      ) {
        return c.json(
          {
            error: "phase_task_corrupt",
            detail: "splitId contains unsafe characters",
          },
          409,
        );
      }
      // The shadow webui task MUST already carry the phase_task's
      // pre-bound sessionUuid (set at create-task time). Mismatch =
      // either a stale shadow trying to launch the wrong phase or a
      // tampered store; either way, refuse.
      if (task.sessionUuid !== phaseTask.sessionUuid) {
        return c.json(
          {
            error: "phase_task_session_uuid_mismatch",
            taskSessionUuid: task.sessionUuid,
            phaseTaskSessionUuid: phaseTask.sessionUuid,
          },
          409,
        );
      }
      const derivedName = buildPhaseTaskName({
        runId: cfgRead.config.runId,
        phase: phaseTask.phase,
        splitId: phaseTask.splitId,
      });
      commands = buildCopyCommands({
        sessionUuid: phaseTask.sessionUuid,
        cwd: task.cwd,
        pluginDirs: task.pluginDirs,
        title: derivedName,
        slashCommand: phaseTask.slashCommand,
      });
      taskUpdate.phaseTaskId = phaseTask.phaseTaskId;
      taskUpdate.runId = cfgRead.config.runId;
      taskUpdate.parentRunMaster = false;
      taskUpdate.phase = phaseTask.phase;
      taskUpdate.phaseLabel = phaseTask.phase;
      taskUpdate.title = derivedName;
    }

    if (!commands && actionId && !resume) {
      const project = getProjectById?.(task.projectId);
      // If the project is resolvable, run the proper substitution path.
      // Unassigned / deleted-project references fall back to legacy.
      if (project) {
        const loaded = loadActionsForProject(project.path || "");
        const action = loaded.actions.actions.find((a) => a.id === actionId);
        if (!action || !action.command_template) {
          return c.json(
            { error: "unknown_action_id", actionId },
            400,
          );
        }
        const allowedPhaseIds = new Set(
          loaded.actions.phases.map((p) => p.id),
        );

        // Resolve user-supplied CLI parameters against the action's schema.
        // Server-side default-injection + required-check + pattern + control-char.
        const resolveResult = resolveParameters({
          action,
          phase,
          userParams,
        });
        if (!resolveResult.ok) {
          return c.json(
            {
              error: resolveResult.error,
              ...(resolveResult.name ? { name: resolveResult.name } : {}),
              ...(resolveResult.detail ? { detail: resolveResult.detail } : {}),
              ...(resolveResult.allowed ? { allowed: resolveResult.allowed } : {}),
            },
            400,
          );
        }

        const ctx: SubstitutionContext = {
          project: { id: project.id, path: project.path || "" },
          task: {
            uuid: task.sessionUuid,
            title: task.title,
            description,
            phase: phase ?? "",
            phase_label: phaseLabel ?? "",
            autonomy,
            parameters: resolveResult.resolved,
          },
          pluginDirs: task.pluginDirs,
          allowedPhaseIds,
          actionId,
        };
        try {
          commands = {
            powershell: substitutePlaceholders(
              action.command_template,
              ctx,
              "powershell",
            ),
            cmd: substitutePlaceholders(action.command_template, ctx, "cmd"),
            posix: substitutePlaceholders(
              action.command_template,
              ctx,
              "posix",
            ),
          };
        } catch (err) {
          if (
            err instanceof UnknownPhaseError ||
            err instanceof InvalidDescriptionError ||
            err instanceof InvalidParameterError ||
            err instanceof InvalidPlaceholderError
          ) {
            return c.json(
              {
                error: "command_substitution_failed",
                detail: err.message,
              },
              400,
            );
          }
          throw err;
        }
        // Persist the action context so TaskDetail can render a faithful
        // phase badge without guessing from the title.
        taskUpdate.actionId = actionId;
        if (phase) taskUpdate.phase = phase;
        if (phaseLabel) taskUpdate.phaseLabel = phaseLabel;
        if (description) taskUpdate.description = description;
        if (autonomy) taskUpdate.autonomy = autonomy;
      }
    }

    // Legacy fallback: no actionId, unresolvable project, or resume flag.
    if (!commands) {
      // iterate-2026-05-08 v0.8.8 AC-1 — Resume on `new-plain` tasks
      // semantically can't work: Claude only writes a JSONL transcript
      // AFTER the user types their first message inside the TUI. So
      // `claude --resume <sessionUuid>` always fails with "No conversation
      // found" for a new-plain task whose pty died before the first
      // message. v0.8.7 AC-1 unblocked the Resume CTA for these tasks
      // (idle transition on pty-gone); this gate makes the Resume click
      // actually USEFUL by emitting a FRESH launch (`--session-id <uuid>`,
      // no `--resume` flag) so Claude opens a new TUI session under the
      // same task identity.
      const effectiveResume =
        resume && task.actionId !== "new-plain";
      commands = buildCopyCommands({
        sessionUuid: task.sessionUuid,
        cwd: task.cwd,
        resume: effectiveResume,
        pluginDirs: task.pluginDirs,
        title: task.title,
      });
    }
    const updated = store.patch(task.taskId, taskUpdate);
    await store.persist();
    return c.json({ task: withLiveSession(updated), commands });
  });

  /**
   * Patch a task. Title is the source of truth for the next launch's
   * `--name` flag (Claude's CLI picker title). Section 02 (iterate 3)
   * extends the body to accept `{projectId}` independently of title —
   * at least one of the two must be present.
   *
   * Concurrent writers from multiple tabs are serialized by
   * `proper-lockfile` inside the store's persist() call; on lock
   * contention we surface 409 so the client can retry instead of
   * overwriting silently.
   */
  app.patch("/api/external/tasks/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);

    const hasTitle = typeof body.title === "string";
    const hasProjectId = typeof body.projectId === "string";

    if (!hasTitle && !hasProjectId) {
      return c.json({ error: "at_least_one_field_required" }, 400);
    }

    const patch: Partial<ExternalTask> = {};

    if (hasTitle) {
      if (/[\r\n]/.test(body.title)) {
        return c.json({ error: "title cannot contain newlines" }, 400);
      }
      const trimmed = body.title.trim();
      if (trimmed.length === 0) {
        return c.json({ error: "title cannot be empty" }, 400);
      }
      if (trimmed.length > TITLE_MAX_LENGTH) {
        return c.json({ error: `title exceeds ${TITLE_MAX_LENGTH} characters` }, 400);
      }
      patch.title = trimmed;
    }

    if (hasProjectId) {
      const candidate = body.projectId.trim();
      if (candidate === "") {
        return c.json({ error: "projectId cannot be empty" }, 400);
      }
      const validation = validateProjectIdOrError(candidate, getKnownProjectIds);
      if (validation) return c.json(validation, 400);
      patch.projectId = candidate;
    }

    store.patch(task.taskId, patch);
    try {
      await store.persist();
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
        return c.json({ error: "sdk-sessions.json is locked, retry" }, 409);
      }
      throw err;
    }
    return c.json({ task: withLiveSession(store.get(task.taskId)) });
  });

  app.post("/api/external/tasks/:id/fork", async (c) => {
    const parent = store.get(c.req.param("id"));
    if (!parent) return c.json({ error: "Parent task not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : `${parent.title} — fork`;
    const child = store.create({
      title,
      cwd: parent.cwd,
      pluginDirs: parent.pluginDirs,
      parentTaskId: parent.taskId,
      parentSessionUuid: parent.sessionUuid,
      // Section 02 — forks inherit the parent's projectId. Falls through to
      // UNASSIGNED_PROJECT_ID via the store's default when the parent is a
      // legacy v1 task that has already been backfilled.
      projectId: parent.projectId,
    });
    const commands = buildCopyCommands({
      sessionUuid: child.sessionUuid,
      cwd: child.cwd,
      fork: true,
      parentSessionUuid: parent.sessionUuid,
      pluginDirs: child.pluginDirs,
      title: child.title,
    });
    store.patch(child.taskId, {
      state: "awaiting_external_start",
      launchedAt: new Date().toISOString(),
    });
    await store.persist();
    return c.json({ task: withLiveSession(store.get(child.taskId)), commands });
  });

  app.get("/api/external/tasks/:id/transcript", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);

    const fromByte = parseIntSafe(c.req.query("fromByte"), 0);
    const expectFingerprint = c.req.query("expectFingerprint") ?? null;

    const result = await watcher.readChunk({
      sessionUuid: task.sessionUuid,
      fromByte,
      expectFingerprint,
    });

    // Apply state-machine transitions based on probe outcome + mtime.
    if (result.status === "missing") {
      if (task.firstJsonlObservedAt && task.state !== "jsonl_missing") {
        store.patch(task.taskId, { state: "jsonl_missing" });
        await store.persist();
      } else if (
        // iterate-2026-05-08 v0.8.7 AC-1 — `new-plain` tasks never write
        // JSONL (per known_issues.md). Without this branch, AC-4's pty-up
        // active-state never decays back to `idle` after pty-kill, so the
        // header CTA stays empty (Resume only renders for state=idle).
        // Idempotent by construction: only fires when state===active +
        // pty entry is gone. Subsequent polls see state=idle + skip.
        task.actionId === "new-plain" &&
        task.state === "active" &&
        ptyManager.get(task.taskId) === undefined
      ) {
        store.patch(task.taskId, { state: "idle" });
        await store.persist();
      }
      return c.json({
        status: "missing",
        task: withLiveSession(store.get(task.taskId)),
      });
    }

    if (result.status === "rotated") {
      return c.json({
        status: "rotated",
        task: withLiveSession(task),
        currentFingerprint: result.currentFingerprint,
      });
    }

    const now = Date.now();
    const loc = await watcher.findByUuid(task.sessionUuid);
    const mtime = loc?.mtimeMs ?? 0;

    const patch: Partial<ExternalTask> = { lastJsonlSeenMtimeMs: mtime };
    let nextState: ExternalTaskState = task.state;
    if (!task.firstJsonlObservedAt) {
      nextState = "active";
      patch.firstJsonlObservedAt = new Date().toISOString();
    } else if (
      task.state === "jsonl_missing" ||
      task.state === "awaiting_external_start"
    ) {
      // awaiting_external_start: re-launch / resume case where JSONL already
      // exists from a prior session. Without this branch, the badge stays
      // stuck on "Awaiting launch" forever after a re-click of Launch on a
      // task whose firstJsonlObservedAt is already set.
      nextState = "active";
    } else if (task.state === "active" && now - mtime > ACTIVE_IDLE_THRESHOLD_MS) {
      // iterate-2026-05-11 v0.9.3 AC-1 (ADR-085) — for `new-plain` tasks
      // the JSONL mtime is meaningless (Claude doesn't write to it until
      // the user types their first message inside the TUI). Using mtime
      // as the active→idle decay signal made the state ping-pong every
      // transcript-poll cycle right after a Resume click: /launch sets
      // awaiting → poll flips to active (line 920-924) → next poll fires
      // this branch (mtime stale) → idle → user sees Resume button → clicks
      // again → ad infinitum. Empirical reproduction at task 31b4076d-...
      // showed 53× accumulated launch-command echoes in disk-scrollback.
      //
      // For new-plain the AUTHORITATIVE active→idle signal is pty entry
      // gone (the v0.8.7 AC-1 path at L889 inside the result="missing"
      // branch). When result="ok" (JSONL exists from a prior session),
      // we trust pty-up as "claude is running" and keep state=active.
      // When pty goes away, the JSONL file might still exist (status="ok")
      // OR get rotated/deleted (status="missing") — in either case the
      // result="missing" branch will eventually catch it (Claude exit
      // typically cleans up the JSONL line buffer; on Windows ConPTY exit
      // the pty entry is gone almost instantly via PtyManager.cleanup).
      // Trading a slightly delayed idle transition for a stable active
      // state is the right call: the user's mental model is "claude is
      // running, Resume button should be hidden", and that wins over
      // catching the exact second of decay.
      if (
        task.actionId === "new-plain" &&
        ptyManager.get(task.taskId) !== undefined
      ) {
        // Keep nextState = task.state (active).
      } else {
        nextState = "idle";
      }
    } else if (task.state === "idle" && now - mtime <= IDLE_REACTIVATE_THRESHOLD_MS) {
      nextState = "active";
    }
    if (nextState !== task.state) {
      patch.state = nextState;
    }
    store.patch(task.taskId, patch);
    await store.persist();

    return c.json({
      status: "ok",
      chunk: result.chunk,
      task: withLiveSession(store.get(task.taskId)),
    });
  });

  app.get("/api/external/inbox", async (c) => {
    // Aggregate inbox across all tracked tasks. Phase A4 (iterate 3
    // remediation, 2026-04-20): per-session derive cache keyed by
    // (sessionUuid, mtimeMs, dismissedKey, contentLength). Cold call
    // still does the full scan; warm calls (no new events, no new
    // dismissals) short-circuit to the cached entries array. Mirrors
    // the mtime-cache pattern in `core/project-actions-loader.ts`.
    type AggregatedEntry = {
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      toolUseId: string;
      toolName: string;
      input: unknown;
      bestEffort: true;
    };
    const out: AggregatedEntry[] = [];
    let storeDirty = false;
    for (const task of store.list()) {
      // Skip tasks the user has explicitly closed or whose session is
      // unrecoverable — they cannot grow new pending interactions, and
      // re-reading their JSONL is a major contributor to inbox latency
      // when sdk-sessions.json accumulates many stale entries.
      if (task.state === "done" || task.state === "launch_failed") continue;

      const dismissedKey = task.inbox.dismissedToolUseIds.slice().sort().join(",");
      const cached = inboxDeriveCache.get(task.sessionUuid);

      // Warm-path fastpath (Phase A4): avoid the full
      // `findByUuid` readdir scan over every subdir of
      // ~/.claude/projects by stat-ing the previously resolved path
      // directly. If mtime is unchanged AND dismissed set is
      // unchanged, reuse the cached entries and skip all I/O past
      // the single stat call.
      if (cached) {
        let currentMtime: number | null = null;
        try {
          const s = await stat(cached.resolvedPath);
          currentMtime = s.mtimeMs;
        } catch {
          // File moved/rotated — fall through to cold path below.
          currentMtime = null;
        }
        if (
          currentMtime !== null &&
          currentMtime === cached.mtimeMs &&
          cached.dismissedKey === dismissedKey
        ) {
          for (const e of cached.entries) {
            out.push({
              taskId: task.taskId,
              sessionUuid: task.sessionUuid,
              taskTitle: e.taskTitle,
              toolUseId: e.toolUseId,
              toolName: e.toolName,
              input: e.input,
              bestEffort: true,
            });
          }
          continue;
        }
      }

      // Cold path — either no cache entry, or the cached mtime is
      // stale, or the cached file is gone. Do the full scan.
      //
      // Phase A4 (iterate 3 remediation) — skip the scan if we very
      // recently confirmed no file exists for this session
      // (`awaiting_external_start` tasks pre-launch). Short TTL so
      // launch → discovery still converges fast.
      const negUntil = inboxNegativeCache.get(task.sessionUuid);
      const nowMs = Date.now();
      if (negUntil !== undefined && negUntil > nowMs) continue;

      const loc = await watcher.findByUuid(task.sessionUuid);
      if (!loc) {
        inboxNegativeCache.set(task.sessionUuid, nowMs + NEGATIVE_RESULT_TTL_MS);
        continue;
      }
      // Session materialized — bust any stale negative entry.
      inboxNegativeCache.delete(task.sessionUuid);

      // Cold / stale — re-read + re-derive.
      let content = "";
      try {
        const chunk = await watcher.readChunk({
          sessionUuid: task.sessionUuid,
          fromByte: 0,
          expectFingerprint: null,
        });
        if (chunk.status === "ok") content = chunk.chunk.content;
      } catch {
        continue;
      }
      const parsed = parseSessionJsonl(content);
      const result = deriveInbox({
        events: parsed.events,
        allowlist: DEFAULT_USER_BLOCKING_TOOLS,
        dismissed: new Set(task.inbox.dismissedToolUseIds),
      });
      const cacheEntries: InboxDeriveCacheEntry["entries"] = [];
      for (const e of result.pending) {
        cacheEntries.push({
          toolUseId: e.toolUseId,
          toolName: e.toolName,
          input: e.input,
          taskTitle: task.title,
        });
        out.push({
          taskId: task.taskId,
          sessionUuid: task.sessionUuid,
          taskTitle: task.title,
          toolUseId: e.toolUseId,
          toolName: e.toolName,
          input: e.input,
          bestEffort: true,
        });
      }

      // Persist the observed pending set so the next restart doesn't
      // re-derive from scratch for UI latency.
      const nextPending = result.pending.map((e) => e.toolUseId);
      if (
        nextPending.join(",") !== task.inbox.pendingToolUseIds.join(",") ||
        task.inbox.lastProcessedByteOffset !== content.length
      ) {
        store.patch(task.taskId, {
          inbox: {
            pendingToolUseIds: nextPending,
            dismissedToolUseIds: task.inbox.dismissedToolUseIds,
            lastProcessedByteOffset: content.length,
          },
        });
        storeDirty = true;
      }

      inboxDeriveCache.set(task.sessionUuid, {
        resolvedPath: loc.path,
        mtimeMs: loc.mtimeMs,
        contentLength: content.length,
        dismissedKey,
        entries: cacheEntries,
        pendingIds: nextPending,
      });
    }
    if (storeDirty) await store.persist();
    return c.json({ items: out });
  });

  app.post("/api/external/inbox/:toolUseId/dismiss", async (c) => {
    const toolUseId = c.req.param("toolUseId");
    for (const task of store.list()) {
      if (!task.inbox.pendingToolUseIds.includes(toolUseId)) continue;
      const dismissed = new Set(task.inbox.dismissedToolUseIds);
      dismissed.add(toolUseId);
      store.patch(task.taskId, {
        inbox: {
          pendingToolUseIds: task.inbox.pendingToolUseIds.filter((id) => id !== toolUseId),
          dismissedToolUseIds: Array.from(dismissed),
          lastProcessedByteOffset: task.inbox.lastProcessedByteOffset,
        },
      });
      // Phase A4 — bust the derive cache for this session so the next
      // GET /inbox call reflects the reduced pending set immediately.
      // (The cache key includes dismissedKey so this is belt-and-braces,
      // but the explicit delete guarantees no stale object sticks
      // around even if the sort-order ever drifts.)
      inboxDeriveCache.delete(task.sessionUuid);
      await store.persist();
      return c.json({ ok: true, taskId: task.taskId });
    }
    return c.json({ ok: false, error: "toolUseId not found in any pending set" }, 404);
  });

  app.post("/api/external/tasks/:id/close", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    const updated = store.patch(task.taskId, { state: "done" });
    await store.persist();
    return c.json({ task: withLiveSession(updated) });
  });

  app.delete("/api/external/tasks/:id", async (c) => {
    const taskId = c.req.param("id");
    const deleted = store.delete(taskId);
    if (!deleted) return c.json({ error: "Task not found" }, 404);
    await store.persist();
    // Iterate-2026-05-04 (ADR-068-A1): cascade-clean scrollback files.
    // Best-effort — task delete is authoritative even if scrollback
    // unlink fails. Errors logged inside scrollbackClearBestEffort.
    if (scrollbackClearBestEffort) {
      try {
        await scrollbackClearBestEffort(taskId);
      } catch {
        // best-effort
      }
    }
    // Iterate-2026-05-12 (ADR-087, MEDIUM-B1 fix): cascade-clean snapshot
    // file. Snapshots capture rendered cell-state (may contain secrets);
    // the 24-h TTL is a backstop, the task delete is the authoritative
    // privacy boundary. Best-effort symmetric to scrollback.
    if (snapshotClearBestEffort) {
      try {
        await snapshotClearBestEffort(taskId);
      } catch {
        // best-effort
      }
    }
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Section 03 (iterate 3) — project-scoped actions / preview routes.
  //
  // These live on the SAME Hono app as the /tasks routes because they share
  // the same middleware chain (CORS, auth eventually). They are NOT nested
  // under /tasks — they operate on projects.
  // -------------------------------------------------------------------------

  /**
   * GET /api/external/projects/:projectId/actions — resolved actions schema
   * for the project. Falls back to the bundled default when .webui/actions.json
   * is absent; returns diagnostics in-band when the user file exists but is
   * malformed (O24 chip). Validates every command_template via the substitute
   * dry-run; unknown placeholder → 400 with typed code.
   */
  app.get("/api/external/projects/:projectId/actions", (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }

    const loaded = loadActionsForProject(project.path || "");
    const actions = loaded.actions;

    // Structural validation (5 O24 cases).
    const schemaErrors: SchemaError[] = validateActionsSchema(actions);
    if (schemaErrors.length > 0) {
      // Prefer the first hard schema error as the 400 code — the UI needs
      // one actionable message. All errors are surfaced in `errors[]` for
      // debugging.
      const first = schemaErrors[0];
      return c.json(
        {
          error: first.code,
          errors: schemaErrors,
          projectId,
        },
        400,
      );
    }

    // Placeholder-level dry-run validation per action template.
    for (const a of actions.actions) {
      if (!a.command_template) continue;
      const phaseIds = actions.phases.map((p) => p.id);
      try {
        // Build a throwaway substitution context and attempt all three
        // shell forms. validateTemplate() returns only placeholder errors;
        // anything else we let bubble up as a 500 (bug).
        const errCandidate = dryRunTemplate(a.command_template, a.id, phaseIds);
        if (errCandidate) {
          return c.json(
            {
              error: "invalid_placeholder",
              placeholder: errCandidate.placeholder,
              actionId: errCandidate.actionId,
              template: errCandidate.template,
            },
            400,
          );
        }
      } catch {
        // Defense-in-depth: a crashing template validator should fail
        // the route rather than expose the raw stack trace.
        return c.json(
          { error: "template_validation_failed", actionId: a.id },
          500,
        );
      }
    }

    // Resolve preview.enabled per plan.md § 2.1 precedence:
    //   Step 1 — profile.stack.frontend present AND dev_server.command
    //            present → true unless explicitly disabled below.
    //   Step 2 — actions.preview.enabled:
    //            "auto" → follow Step 1.
    //            true   → only honored if Step 1 also allowed it (profile gate wins).
    //            false  → force off regardless.
    const profile = project.profile
      ? (profileResolver(project.profile) as
          | (PreviewProfile & { stack?: { frontend?: unknown } })
          | null)
      : null;
    const profileAllowsPreview =
      Boolean(profile?.stack?.frontend) &&
      Boolean(profile?.dev_server?.command);
    const actionsPref = actions.preview?.enabled;
    let previewEnabled: boolean;
    if (actionsPref === false) {
      previewEnabled = false;
    } else if (actionsPref === true) {
      previewEnabled = profileAllowsPreview;
    } else {
      // "auto" or undefined — follow profile.
      previewEnabled = profileAllowsPreview;
    }

    return c.json({
      actions: actions.actions,
      phases: actions.phases,
      defaults: actions.defaults,
      preview: {
        enabled: previewEnabled,
        command: profile?.dev_server?.command ?? null,
        port: profile?.dev_server?.port ?? null,
        ready_path: profile?.dev_server?.ready_path ?? null,
        ready_timeout_seconds: profile?.dev_server?.ready_timeout_seconds ?? null,
      },
      diagnostics: loaded.diagnostics,
      // FR-01.27 — Settings UI uses this to render the source-state badge
      // (Custom / Bundled / Malformed). True iff the loader read
      // `<project.path>/.webui/actions.json` successfully; false when it
      // fell back to the bundled default (file missing OR malformed —
      // the diagnostics array distinguishes those).
      fromUser: loaded.fromUser,
    });
  });

  /**
   * POST /api/external/projects/:projectId/preview — spawn dev server.
   *
   * Structured error codes — the UI maps each to a specific toast:
   *   preview_profile_invalid  (400) — command contains shell operators / empty
   *   preview_spawn_failed     (500) — spawn threw (ENOENT etc.)
   *   preview_port_in_use      (500) — port probe reported EADDRINUSE
   *   preview_exited_early     (500) — child emitted exit before ready
   *   preview_timeout          (500) — no ready signal within timeout
   */
  app.post("/api/external/projects/:projectId/preview", async (c) => {
    if (!previewManager) {
      return c.json({ error: "preview_unavailable" }, 501);
    }
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.profile) {
      return c.json(
        { error: "preview_profile_invalid", detail: "project has no profile" },
        400,
      );
    }
    const profile = profileResolver(project.profile);
    if (!profile) {
      return c.json(
        { error: "preview_profile_invalid", detail: "profile not found" },
        400,
      );
    }
    try {
      const entry = await previewManager.spawn(projectId, profile, {
        cwd: project.path,
      });
      return c.json({ url: entry.url, sessionId: entry.sessionId });
    } catch (err) {
      if (err instanceof PreviewProfileInvalidError) {
        return c.json(
          { error: "preview_profile_invalid", detail: err.detail },
          400,
        );
      }
      if (err instanceof PreviewPortInUseError) {
        return c.json(
          { error: "preview_port_in_use", port: err.port },
          500,
        );
      }
      if (err instanceof PreviewSpawnFailedError) {
        return c.json(
          { error: "preview_spawn_failed", detail: err.detail },
          500,
        );
      }
      if (err instanceof PreviewExitedEarlyError) {
        return c.json(
          { error: "preview_exited_early", detail: `exited with code ${err.code}` },
          500,
        );
      }
      if (err instanceof PreviewTimeoutError) {
        return c.json(
          { error: "preview_timeout", seconds: err.seconds },
          500,
        );
      }
      // Unknown failure — bubble as a generic 500 so a bug doesn't masquerade
      // as one of the expected codes.
      return c.json(
        { error: "preview_unknown_error", detail: String(err).slice(0, 200) },
        500,
      );
    }
  });

  // -------------------------------------------------------------------------
  // iterate/multi-session-run-orchestrator-v2 — Run-config route.
  //
  // Read-only observer of `<project.path>/shipwright_run_config.json`. The
  // route never mutates state; the framework's orchestrator owns all
  // run-config writes. v1 configs and missing configs return early so the
  // UI falls back to the legacy flat task rendering.
  // -------------------------------------------------------------------------

  /**
   * GET /api/external/projects/:projectId/run-config
   *
   * Response shapes:
   *   { status: "ok", config, readyToLaunchTasks, diagnostics }
   *   { status: "missing" }
   *   { status: "v1_legacy" }
   *   { status: "invalid", reason }
   *
   * `readyToLaunchTasks` is a derived UX convenience (every awaiting_launch
   * task whose prerequisites are completed). The framework's state machine
   * remains the source of truth; phase-task launches re-verify against the
   * full config server-side at launch time.
   */
  app.get("/api/external/projects/:projectId/run-config", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const result = await runConfigReader(project.path);
    if (result.status === "ok") {
      return c.json({
        status: "ok",
        config: result.config,
        readyToLaunchTasks: deriveReadyToLaunchTasks(result.config),
        diagnostics: result.diagnostics,
      });
    }
    if (result.status === "missing" || result.status === "v1_legacy") {
      return c.json({ status: result.status });
    }
    return c.json({ status: "invalid", reason: result.reason });
  });

  // -------------------------------------------------------------------------
  // Section 04a — Tree + File routes for SmartViewer / FolderTree.
  //
  // Security surface:
  //   - path-guard.ts refuses traversal / absolute-input / drive-hop attempts
  //   - file route enforces 5 MB cap (413) and image-allowlist (415)
  //   - file route sets explicit Content-Type + nosniff + sanitized
  //     Content-Disposition to block MIME-sniffing + header-injection
  // -------------------------------------------------------------------------

  /**
   * GET /api/external/projects/:projectId/tree?path=<relpath>
   *
   * Returns one level of entries. `ignored: true` is advisory — the client
   * decides whether to show them muted or hide them entirely (plan § 7 O6).
   */
  app.get("/api/external/projects/:projectId/tree", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const relpath = c.req.query("path") ?? "";
    const guard = pathGuard(project.path, relpath);
    if (!guard.ok) {
      // Normalize guard reasons to a single client-facing error code for
      // consistency: both "absolute_input" and "drive_change" surface as
      // "path_traversal" — the UI doesn't distinguish and we avoid leaking
      // internal-guard semantics. The `detail` field preserves the precise
      // reason for server logs.
      const err = guard.reason === "traversal" ? "path_traversal" : guard.reason;
      return c.json({ error: err, detail: guard.reason }, 400);
    }

    const ig = loadIgnore(project.path);

    // Build the subpath prefix relative to project.path for ignore lookups.
    // If the caller requested "src", an entry "index.ts" should be tested
    // against "src/index.ts" so that a .gitignore rule like "src/index.ts"
    // matches. We always use POSIX separators for ignore() — the `ignore`
    // package documents that.
    const subPrefix = relpath.length > 0 && relpath !== "."
      ? relpath.replace(/\\/g, "/").replace(/\/+$/, "")
      : "";

    let entries;
    try {
      entries = await readdir(guard.absolute, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      if (code === "ENOTDIR") {
        return c.json({ error: "not_a_directory", path: relpath }, 400);
      }
      return c.json(
        { error: "tree_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    // Symlink-escape check — only when the caller requested a subdirectory
    // (the project root itself is trusted; it's where the user pointed us).
    // For any non-empty relpath we realpath + re-verify. A symlinked-dir
    // escape attempt lands here, NOT in pathGuard (which is string-only).
    if (relpath.length > 0 && relpath !== ".") {
      const realGuard = realPathGuard(project.path, guard.absolute);
      if (!realGuard.ok) {
        return c.json(
          { error: "path_traversal", detail: realGuard.reason },
          400,
        );
      }
    }

    const out = entries.map((d) => {
      const kind: "file" | "dir" = d.isDirectory() ? "dir" : "file";
      // `ignore` requires a relative path. It treats trailing slashes as a
      // directory hint, which affects pattern semantics.
      const testPathBase = subPrefix ? `${subPrefix}/${d.name}` : d.name;
      const testPath = kind === "dir" ? `${testPathBase}/` : testPathBase;
      const ignored = ig.ignores(testPath) || ig.ignores(testPathBase);
      return { name: d.name, kind, ignored };
    });

    // Stable sort — dirs first, then alpha. Keeps the UI deterministic.
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return c.json({ entries: out });
  });

  /**
   * GET /api/external/projects/:projectId/file?path=<relpath>
   *
   * Byte-streams the file with:
   *   - X-Content-Type-Options: nosniff
   *   - Explicit Content-Type per extension (never inferred)
   *   - Content-Disposition: inline; filename="<sanitized>"
   *
   * 400 on traversal / absolute input. 413 if > 5 MB. 415 if extension not
   * in the text/markdown/image allowlist.
   */
  app.get("/api/external/projects/:projectId/file", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const relpath = c.req.query("path");
    if (!relpath || relpath.length === 0) {
      return c.json({ error: "path_required" }, 400);
    }
    const guard = pathGuard(project.path, relpath);
    if (!guard.ok) {
      const err = guard.reason === "traversal" ? "path_traversal" : guard.reason;
      return c.json({ error: err, detail: guard.reason }, 400);
    }

    let st;
    try {
      st = await stat(guard.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      return c.json(
        { error: "file_stat_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    if (!st.isFile()) {
      return c.json({ error: "not_a_file", path: relpath }, 400);
    }

    // Symlink-escape defense. The stat above already succeeded, so the
    // target exists — realpath will verify it's still under project root.
    // If the file is a symlink whose target is outside the root, reject.
    const realGuard = realPathGuard(project.path, guard.absolute);
    if (!realGuard.ok) {
      return c.json(
        { error: "path_traversal", detail: realGuard.reason },
        400,
      );
    }

    if (st.size > FILE_MAX_BYTES) {
      return c.json(
        { error: "file_too_large", maxBytes: FILE_MAX_BYTES, size: st.size },
        413,
      );
    }

    const rawExt = extname(guard.absolute).toLowerCase().slice(1);
    const mime = MIME_BY_EXTENSION[rawExt];
    if (!mime) {
      return c.json(
        {
          error: "binary_not_previewable",
          mime: `application/octet-stream`,
          extension: rawExt || null,
        },
        415,
      );
    }

    const filename = sanitizeContentDispositionFilename(basename(guard.absolute));

    // Read the full file into memory. This is safe because the 5 MB cap is
    // already enforced above — no file larger than 5 MB reaches this point.
    // We avoid streaming here to dodge a race in test teardown (where the
    // file disappears before the node-readable has finished draining into
    // the web-response) AND to make the Content-Length + body atomic — a
    // streamed response could race with a filesystem-level deletion and
    // produce a truncated body past the nosniff check.
    let body: Buffer;
    try {
      body = readFileSync(guard.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      return c.json(
        { error: "file_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    // Set security headers BEFORE sending body.
    c.header("Content-Type", mime);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", `inline; filename="${filename}"`);
    c.header("Content-Length", String(body.length));
    c.header("Cache-Control", "private, max-age=0, must-revalidate");
    // Defense-in-depth for SVG (which CAN embed <script>): when an SVG is
    // loaded via <iframe> browsers WILL execute inline script. The CSP
    // header blocks that in every viewer. For non-SVG responses the CSP
    // is harmless. `default-src 'none'` also prevents sub-resource loads
    // (the SmartViewer image renderer uses <img src>, which is unaffected).
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );

    // Return the raw bytes. Hono wraps a Uint8Array into the Response body
    // as-is; Content-Type is NOT mutated (we set it above).
    return c.body(new Uint8Array(body));
  });

  /**
   * POST /api/projects/:id/actions-stub — create `<project.path>/.webui/actions.json`
   * as an empty structured stub. Only called from the wizard's "Custom"
   * branch; idempotent (second call is a no-op).
   *
   * This is the ONLY write webui performs inside a user's project path.
   */
  app.post("/api/projects/:id/actions-stub", (c) => {
    const id = c.req.param("id");
    const project = getProjectById?.(id);
    if (!project) {
      return c.json({ error: "project_not_found", projectId: id }, 404);
    }
    if (!project.path) {
      return c.json(
        { error: "project_path_unavailable", projectId: id },
        400,
      );
    }
    const dir = join(project.path, ".webui");
    const file = join(dir, "actions.json");
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(file)) {
        const stub = {
          $schema:
            "https://shipwright.dev/schemas/actions.v1.json (see docs/actions.md)",
          schemaVersion: 1,
          defaults: { autonomy: "guided" },
          actions: [],
          phases: [],
          preview: { enabled: "auto" },
        };
        writeFileSync(file, JSON.stringify(stub, null, 2) + "\n", "utf-8");
      }
      return c.json({ path: file, created: true });
    } catch (err) {
      return c.json(
        {
          error: "stub_write_failed",
          detail: String(err).slice(0, 200),
          path: file,
        },
        500,
      );
    }
  });

  /**
   * POST /api/projects/:id/actions-upload — replace `<project.path>/.webui/actions.json`
   * with a JSON body validated against the actions schema. Iterate
   * iterate-20260430-actions-upload-ui (FR-01.27).
   *
   * Validation pipeline (rejects with 4xx on first failure):
   *   1. Project resolvable + has a filesystem path.
   *   2. Raw body ≤ ACTIONS_UPLOAD_MAX_BYTES.
   *   3. Body parses as JSON.
   *   4. checkContractVersion (fail-soft: warns once, never blocks).
   *   5. validateActionsSchema returns no errors.
   *
   * Atomic write: writeFileSync to a sibling tmp path, then renameSync.
   * Cache: clearActionsCache() so the next GET /actions reflects the
   * new file (cache key is per-project but the bundled-default branch
   * shares state, so a global clear is the simplest correct option).
   */
  app.post("/api/projects/:id/actions-upload", async (c) => {
    const id = c.req.param("id");
    const project = getProjectById?.(id);
    if (!project) {
      return c.json({ error: "project_not_found", projectId: id }, 404);
    }
    if (!project.path) {
      return c.json(
        { error: "project_path_unavailable", projectId: id },
        400,
      );
    }

    // Pre-buffer DoS guard — reject before reading the body when the
    // declared Content-Length already exceeds the cap. Without this,
    // `c.req.text()` allocates the full payload into memory before the
    // post-read length check can fire.
    const declaredLength = Number(c.req.header("content-length") ?? "");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > ACTIONS_UPLOAD_MAX_BYTES
    ) {
      return c.json(
        {
          error: "payload_too_large",
          maxBytes: ACTIONS_UPLOAD_MAX_BYTES,
          size: declaredLength,
        },
        413,
      );
    }

    const raw = await c.req.text();
    if (raw.length > ACTIONS_UPLOAD_MAX_BYTES) {
      return c.json(
        {
          error: "payload_too_large",
          maxBytes: ACTIONS_UPLOAD_MAX_BYTES,
          size: raw.length,
        },
        413,
      );
    }

    let parsed: ResolvedActions;
    try {
      parsed = JSON.parse(raw) as ResolvedActions;
    } catch (err) {
      return c.json(
        { error: "invalid_json", detail: String(err).slice(0, 200) },
        400,
      );
    }

    // Schema validation requires a structured object — guard against
    // null / array / scalar before the validator dereferences fields.
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return c.json(
        { error: "invalid_json", detail: "expected JSON object at top level" },
        400,
      );
    }

    // Fail-soft: emits a one-shot warn on console for newer-than-known
    // schemaVersion, but does not block the upload.
    checkContractVersion({
      artefact: ".webui/actions.json (upload)",
      path: project.path,
      declared: parsed.schemaVersion,
      knownMax: ACTIONS_SCHEMA_VERSION,
      fieldName: "schemaVersion",
    });

    const errors: SchemaError[] = validateActionsSchema(parsed);
    if (errors.length > 0) {
      return c.json(
        { error: "schema_validation_failed", errors },
        400,
      );
    }

    // Placeholder dry-run — same check the GET /actions route runs against
    // the loader output. Performing it here too means a payload with an
    // unresolvable placeholder fails 400 at upload time instead of 500-ing
    // at the next launch. Mirrors the order of checks in the GET handler.
    const phaseIds = parsed.phases.map((p) => p.id);
    for (const action of parsed.actions) {
      if (!action.command_template) continue;
      const errCandidate = dryRunTemplate(action.command_template, action.id, phaseIds);
      if (errCandidate) {
        return c.json(
          {
            error: "invalid_placeholder",
            placeholder: errCandidate.placeholder,
            actionId: errCandidate.actionId,
            template: errCandidate.template,
          },
          400,
        );
      }
    }

    const dir = join(project.path, ".webui");
    const file = join(dir, "actions.json");
    const tmp = join(dir, `actions.json.tmp-${process.pid}-${Date.now()}`);
    try {
      mkdirSync(dir, { recursive: true });
      // Symlink-resolution defense: even though the destination filename
      // is fixed (no user-controlled path components), `project.path`
      // itself OR the `.webui` directory could be a symlink that escapes
      // the registered project root. realPathGuard is mandatory per
      // CLAUDE.md DO-NOT regression guard #10.
      const guard = realPathGuard(project.path, dir);
      if (!guard.ok) {
        return c.json(
          { error: "path_unsafe", reason: guard.reason, path: dir },
          400,
        );
      }
      // Re-serialize the parsed object so we get canonical formatting and
      // strip any garbage (e.g. comments stripped by JSON.parse). 2-space
      // indent matches the actions-stub writer.
      writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      renameSync(tmp, file);
    } catch (err) {
      // Best-effort tmp cleanup — ignore if it is already gone.
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* swallow */
      }
      return c.json(
        {
          error: "upload_write_failed",
          detail: String(err).slice(0, 200),
          path: file,
        },
        500,
      );
    }

    clearActionsCacheForProject(project.path);
    return c.json({ path: file, written: true });
  });

  /**
   * DELETE /api/projects/:id/actions-upload — reset the project to the
   * bundled default by removing `<project.path>/.webui/actions.json`.
   * Idempotent: returns `{removed: false}` when the file did not exist.
   */
  app.delete("/api/projects/:id/actions-upload", (c) => {
    const id = c.req.param("id");
    const project = getProjectById?.(id);
    if (!project) {
      return c.json({ error: "project_not_found", projectId: id }, 404);
    }
    if (!project.path) {
      return c.json(
        { error: "project_path_unavailable", projectId: id },
        400,
      );
    }
    const file = join(project.path, ".webui", "actions.json");
    if (!existsSync(file)) {
      clearActionsCacheForProject(project.path);
      return c.json({ path: file, removed: false });
    }
    // Same realpath guard as POST — refuse to unlink a target that
    // resolves outside the project root.
    const guard = realPathGuard(project.path, file);
    if (!guard.ok) {
      return c.json(
        { error: "path_unsafe", reason: guard.reason, path: file },
        400,
      );
    }
    try {
      unlinkSync(file);
    } catch (err) {
      return c.json(
        {
          error: "upload_unlink_failed",
          detail: String(err).slice(0, 200),
          path: file,
        },
        500,
      );
    }
    clearActionsCacheForProject(project.path);
    return c.json({ path: file, removed: true });
  });

  return app;
}

/**
 * 256 KB cap on `.webui/actions.json` upload payloads. The bundled default
 * is ~5 KB; 256 KB is generous for any legitimate per-project override and
 * tight enough to refuse accidental binary uploads or copy-paste of huge
 * files.
 */
const ACTIONS_UPLOAD_MAX_BYTES = 256 * 1024;

/**
 * Dry-run the substitute pipeline against a template using placeholder-
 * allowlist-safe values; returns the first placeholder failure, or null.
 * Shared between the GET /actions route and unit tests.
 */
function dryRunTemplate(
  template: string,
  actionId: string,
  phaseIds: string[],
): InvalidPlaceholderError | null {
  const ctx: SubstitutionContext = {
    project: { id: "dry-run", path: "/tmp/dry-run" },
    task: {
      uuid: "00000000-0000-0000-0000-000000000000",
      title: "dry run",
      phase: phaseIds[0] ?? "dry-run-phase",
      phase_label: "Dry Run",
    },
    pluginDirs: [],
    allowedPhaseIds: new Set([...phaseIds, "dry-run-phase"]),
    actionId,
  };
  try {
    buildExternalLaunchCommand({ template, ctx });
    return null;
  } catch (err) {
    if (err instanceof InvalidPlaceholderError) return err;
    if (err instanceof UnknownPhaseError) return null; // handled at launch time
    throw err;
  }
}


function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * iterate/multi-session-run-orchestrator-v2 — Validates phase-task fields
 * on the create-task body. Returns either resolved fields or a structured
 * error tuple. Pure shape-check; cross-checks against the run-config
 * happen in the launch route, which is the security boundary.
 *
 * Plan A6.5: shape-validate every field; the route enforces idempotency
 * via store.findByPhaseTaskId().
 */
type PhaseTaskCreateFields = {
  phaseTaskId?: string;
  runId?: string;
  sessionUuid?: string;
  parentRunMaster?: boolean;
};
function resolvePhaseTaskCreateFields(
  body: Record<string, unknown>,
):
  | PhaseTaskCreateFields
  | { error: { error: string; detail?: string }; status: 400 }
{
  const out: PhaseTaskCreateFields = {};
  const phaseTaskId = body.phaseTaskId;
  const runId = body.runId;
  const sessionUuid = body.sessionUuid;
  const parentRunMaster = body.parentRunMaster;

  if (
    phaseTaskId === undefined &&
    runId === undefined &&
    sessionUuid === undefined &&
    parentRunMaster === undefined
  ) {
    return out;
  }

  if (phaseTaskId !== undefined) {
    if (typeof phaseTaskId !== "string" || !PHASE_TASK_ID_PATTERN.test(phaseTaskId)) {
      return {
        error: {
          error: "invalid_phase_task_id",
          detail: "phaseTaskId must match /^ptk-[0-9a-f]{4,}$/",
        },
        status: 400,
      };
    }
    out.phaseTaskId = phaseTaskId;
  }
  if (runId !== undefined) {
    if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
      return {
        error: {
          error: "invalid_run_id",
          detail: "runId must match /^run-[0-9a-f]{8}$/",
        },
        status: 400,
      };
    }
    out.runId = runId;
  }
  if (sessionUuid !== undefined) {
    if (
      typeof sessionUuid !== "string" ||
      !SESSION_UUID_PATTERN.test(sessionUuid)
    ) {
      return {
        error: {
          error: "invalid_session_uuid",
          detail: "sessionUuid must be a valid uuid",
        },
        status: 400,
      };
    }
    out.sessionUuid = sessionUuid;
  }
  if (parentRunMaster !== undefined) {
    if (typeof parentRunMaster !== "boolean") {
      return {
        error: {
          error: "invalid_parent_run_master",
          detail: "parentRunMaster must be boolean",
        },
        status: 400,
      };
    }
    out.parentRunMaster = parentRunMaster;
  }
  return out;
}

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
function validateProjectIdOrError(
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
// Section 04a — helpers for the file route.
// ---------------------------------------------------------------------------

/** 5 MB — server-side cap per spec. Client applies a lower 1 MB cap for
 * text/markdown/code; images may use the full 5 MB budget. */
export const FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Explicit extension → Content-Type mapping. Any extension NOT in this table
 * is treated as "not previewable" and rejected with 415 from the file route.
 *
 * Security rationale:
 *   - Everything text-ish is served as text/plain (NOT application/javascript
 *     or text/typescript) so the browser can't be tricked into executing it
 *     even in a renderable-script context.
 *   - Markdown is served as text/markdown; charset=utf-8 — some browsers
 *     render it inline, but the nosniff header + Content-Disposition inline
 *     with explicit filename prevents auto-download shenanigans.
 *   - Image entries match the documented allowlist (png / jpg / jpeg / gif /
 *     svg / webp).
 */
export const MIME_BY_EXTENSION: Record<string, string> = Object.freeze({
  // Text-ish — all served as text/plain regardless of semantic type.
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "text/plain; charset=utf-8",
  yaml: "text/plain; charset=utf-8",
  yml: "text/plain; charset=utf-8",
  toml: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  xml: "text/plain; charset=utf-8",
  html: "text/plain; charset=utf-8",
  css: "text/plain; charset=utf-8",
  js: "text/plain; charset=utf-8",
  jsx: "text/plain; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  mjs: "text/plain; charset=utf-8",
  cjs: "text/plain; charset=utf-8",
  sh: "text/plain; charset=utf-8",
  bash: "text/plain; charset=utf-8",
  zsh: "text/plain; charset=utf-8",
  py: "text/plain; charset=utf-8",
  rb: "text/plain; charset=utf-8",
  go: "text/plain; charset=utf-8",
  rs: "text/plain; charset=utf-8",
  java: "text/plain; charset=utf-8",
  kt: "text/plain; charset=utf-8",
  swift: "text/plain; charset=utf-8",
  c: "text/plain; charset=utf-8",
  h: "text/plain; charset=utf-8",
  cpp: "text/plain; charset=utf-8",
  hpp: "text/plain; charset=utf-8",
  sql: "text/plain; charset=utf-8",
  env: "text/plain; charset=utf-8",
  gitignore: "text/plain; charset=utf-8",
  dockerfile: "text/plain; charset=utf-8",
  mmd: "text/plain; charset=utf-8",
  mermaid: "text/plain; charset=utf-8",
  // Image allowlist.
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
});

/**
 * Sanitize a filename for use inside `Content-Disposition: inline;
 * filename="<sanitized>"`.
 *
 * Contract:
 *   - ASCII alphanumerics + `. _ -` + spaces are preserved.
 *   - All other characters (including CR, LF, ", \, ;, non-ASCII) are
 *     replaced with `_`. This blocks header-injection via CR/LF, avoids
 *     the need for RFC 6266 percent-encoding, and produces a filename
 *     the client can safely render back.
 *   - Result is clamped to 120 characters. If the original was longer
 *     we preserve the extension when possible.
 *   - Empty result falls back to "file".
 *
 * This is intentionally MORE restrictive than RFC 6266 allows — the UI
 * only needs the filename as a hint; we prefer a conservative char class
 * over round-trip fidelity.
 */
export function sanitizeContentDispositionFilename(raw: string): string {
  const base = basename(raw || "").normalize("NFKC");
  if (base.length === 0) return "file";

  // Replace anything outside the allowed class with `_`.
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, "_");

  if (cleaned.length === 0) return "file";
  if (cleaned.length <= 120) return cleaned;

  // Clamp to 120, preserving the extension if we can.
  const dot = cleaned.lastIndexOf(".");
  if (dot > 0 && cleaned.length - dot <= 16) {
    const ext = cleaned.slice(dot);
    const headLen = 120 - ext.length;
    return cleaned.slice(0, headLen) + ext;
  }
  return cleaned.slice(0, 120);
}
