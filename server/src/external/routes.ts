/*
 * server/src/external/routes.ts — registration shell for the external
 * (Plan D'' / Iterate 3) API surface.
 *
 * Post-C2 split (campaign-C-C2-external-routes-split, 2026-05-26): the
 * historical 2879-LOC monolithic file has been broken into 9 per-concern
 * sub-routers under `./<concern>/routes.ts`. This file owns ONLY:
 *
 *   1. `createExternalRoutes(args)` — builds a Hono app + mounts the
 *      9 sub-routers + runs a one-time runtime invariant check
 *      (`ptyManager.get` must exist).
 *   2. Back-compat re-exports of the symbols that 14+ sibling test
 *      files + downstream consumers import from `./routes.js`:
 *      - `clearInboxDeriveCache`
 *      - `FILE_MAX_BYTES`
 *      - `MIME_BY_EXTENSION`
 *      - `sanitizeContentDispositionFilename`
 *      - `ExternalRouteProjectView` (interface alias)
 *
 * Wire-level URL surface is byte-identical to the pre-split version —
 * every handler still owns its absolute path string. Mount via
 * `app.route("/", subRouter)` leaves those paths alone.
 *
 * Backed by:
 *   - core/launcher.ts          (copy-command generation)
 *   - core/session-watcher.ts   (filename-first discovery + byte-range read)
 *   - core/session-parser.ts    (server-side parser for inbox)
 *   - core/inbox-derive.ts      (pending tool_use extraction)
 *   - core/sdk-sessions-store.ts (persisted task metadata)
 */

import { Hono } from "hono";

import {
  PreviewSessionManager,
  type PreviewProfile,
} from "../core/preview-session-manager.js";
import { loadProfile, getProfilesDir } from "../core/profile-loader.js";
import {
  readRunConfig as defaultReadRunConfig,
  type RunConfigReadResult,
} from "../core/run-config-reader.js";
import type { ComplianceReadResult } from "../core/compliance-reader.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { SdkSessionsStore } from "../core/sdk-sessions-store.js";

import { createRunConfigRouter } from "./run-config/routes.js";
import { createComplianceRouter } from "./compliance/routes.js";
import { createPreviewRouter } from "./preview/routes.js";
import { createActionsRouter } from "./actions/routes.js";
import { createTreeRouter } from "./tree/routes.js";
import { createFileRouter } from "./file/routes.js";
import { createMediaRouter } from "./media/routes.js";
import { createInboxRouter } from "./inbox/routes.js";
import { createTranscriptRouter } from "./transcript/routes.js";
import { createTasksRouter } from "./tasks/routes.js";
import { createLaunchRouter } from "./launch/routes.js";
import { createPrStatusRouter } from "./pr-status/routes.js";

// Back-compat re-exports — 14+ sibling test files + downstream consumers
// import these from `./routes.js` directly. Sources of truth post-C2:
//   - ./file/_helpers.ts          (FILE_MAX_BYTES, MIME_BY_EXTENSION,
//                                  sanitizeContentDispositionFilename)
//   - ./inbox/_cache.ts           (clearInboxDeriveCache)
//   - ./_shared/helpers.ts        (ExternalRouteProjectView)
export {
  FILE_MAX_BYTES,
  MIME_BY_EXTENSION,
  sanitizeContentDispositionFilename,
} from "./file/_helpers.js";
export { clearInboxDeriveCache } from "./inbox/_cache.js";
export type { ExternalRouteProjectView } from "./_shared/helpers.js";

import type { ExternalRouteProjectView } from "./_shared/helpers.js";

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
   * iterate-2026-06-30-compliance-grade-webui (FR-01.43) — reads a project's
   * `.shipwright/compliance/dashboard.md`. Tests inject a stub; production
   * wires the real reader. Read-only observer (CLAUDE.md rule 12 spirit).
   */
  readCompliance?: (projectPath: string) => Promise<ComplianceReadResult>;
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
   * is a backstop, the task delete is the authoritative privacy boundary.
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
  ptyManager: {
    get(taskId: string): unknown;
    /**
     * iterate-2026-05-18-inbox-terminal-prompts — decoded visible-viewport
     * text of the task's live headless mirror, or null when there is no
     * live mirror. Optional: legacy test harnesses pass `{ get }` only;
     * production (index.ts) wires it. When absent the inbox emits no
     * `terminal_prompt` rows (graceful — never a crash).
     */
    peekTerminalText?(taskId: string): string | null;
  };
}) {
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
  // iterate-2026-05-08 v0.8.7 AC-1 — runtime guard (external code review
  // openai medium): TypeScript-only requirement is bypassable in plain
  // JS or via type-erased callsites. Validate the contract at
  // construction time so the failure surfaces here, not at the first
  // transcript-poll N requests later.
  if (!ptyManager || typeof ptyManager.get !== "function") {
    throw new Error(
      "createExternalRoutes: required arg `ptyManager` is missing or invalid (must expose `get(taskId)`)",
    );
  }
  const profileResolver =
    injectedLoadProfile ??
    ((name: string) =>
      loadProfile(name, getProfilesDir()) as PreviewProfile | null);
  const runConfigReader =
    args.readRunConfig ?? ((p: string) => defaultReadRunConfig(p));

  const app = new Hono();

  // -------------------------------------------------------------------------
  // Mounted sub-routers (C2 split). Order is structurally irrelevant
  // (Hono dispatches by exact method+path), but reads top-to-bottom
  // from the most-trafficked endpoints down to the project-scoped ones.
  // -------------------------------------------------------------------------
  app.route(
    "/",
    createTasksRouter({
      store,
      watcher,
      ptyManager,
      getKnownProjectIds,
      getProjectById,
      scrollbackClearBestEffort,
      snapshotClearBestEffort,
    }),
  );
  // CLAUDE.md rule 13 — phaseTaskRef re-reads run-config server-side +
  // rejects mismatched session uuids (409 phase_task_session_uuid_mismatch);
  // phaseTaskRef + actionId → 400 mixed_launch_intents.
  app.route(
    "/",
    createLaunchRouter({ store, ptyManager, getProjectById, runConfigReader }),
  );
  // CLAUDE.md rule 4 — STATELESS byte-offset; multi-tab works by construction.
  app.route("/", createTranscriptRouter({ store, watcher, ptyManager }));
  // Inbox shares the derive cache + negative cache via ./inbox/_cache.ts.
  app.route("/", createInboxRouter({ store, watcher, ptyManager }));
  // CLAUDE.md rule 12 — run-config is a READ-ONLY observer; no mutation.
  app.route(
    "/",
    createRunConfigRouter({ getProjectById, readRunConfig: runConfigReader }),
  );
  // FR-01.43 — compliance dashboard is a READ-ONLY observer of dashboard.md.
  app.route(
    "/",
    createComplianceRouter({ getProjectById, readCompliance: args.readCompliance }),
  );
  // ADR-044 / CLAUDE.md rule 9 (shell:false invariant for preview spawn).
  app.route(
    "/",
    createPreviewRouter({
      getProjectById,
      previewManager,
      loadProfile: profileResolver,
    }),
  );
  // CLAUDE.md rule 10 — realpath path-guard for tree + file.
  app.route("/", createTreeRouter({ getProjectById }));
  app.route("/", createFileRouter({ getProjectById }));
  // Range-capable video streaming (SmartViewer <video> pane). Separate
  // from /file: streams via createReadStream + 206, no 5 MB cap.
  app.route("/", createMediaRouter({ getProjectById }));
  // GET actions + POST/DELETE per-project actions.json (Settings UI).
  app.route(
    "/",
    createActionsRouter({ getProjectById, loadProfile: profileResolver }),
  );
  // GET /pr-status?url=<prUrl> — open/merged badge for the transcript
  // PrLinkCard. Validates the github pull URL, then runs `gh pr view`
  // shell:false (iterate-2026-05-30-pr-card-status). Stateless; uses the
  // default gh runner + in-memory TTL cache from core/pr-status.ts.
  app.route("/", createPrStatusRouter());

  return app;
}
