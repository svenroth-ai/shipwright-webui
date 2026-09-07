/*
 * server/src/external/create-external-routes-args.ts — the injection
 * contract for `createExternalRoutes` (./routes.ts). Split out on its own
 * (iterate-2026-09-07-leadwright-setup-wizard) to keep routes.ts under the
 * bloat ceiling — this is a pure type declaration, no runtime code.
 */
import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import type { SessionWatcher } from "../core/session-watcher.js";
import type { PreviewSessionManager, PreviewProfile } from "../core/preview-session-manager.js";
import type { RunConfigReadResult } from "../core/run-config-reader.js";
import type { ComplianceReadResult } from "../core/compliance-reader.js";
import type { OrgRouterDeps } from "./org/routes.js";
import type { ExternalRouteProjectView } from "./_shared/helpers.js";

export interface CreateExternalRoutesArgs {
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
     * D01/F01 — tear down the live embedded pty on DELETE /tasks/:id BEFORE
     * the scrollback + snapshot privacy clears. Optional: legacy/test
     * harnesses pass `{ get }` only; production (index.ts) wires it.
     */
    kill?(taskId: string): void | Promise<void>;
    /**
     * iterate-2026-05-18-inbox-terminal-prompts — decoded visible-viewport
     * text of the task's live headless mirror, or null when there is no
     * live mirror. Optional: legacy test harnesses pass `{ get }` only;
     * production (index.ts) wires it. When absent the inbox emits no
     * `terminal_prompt` rows (graceful — never a crash).
     */
    peekTerminalText?(taskId: string): string | null;
  };
  /** FR-04.38 — `/api/external/org/*` (leadwright's org dir, not a project).
   *  Mounted only when `honoHost` + `leadsRoot` are both provided (mirrors
   *  the `getProjectById`-gated mission-context mount above). */
  honoHost?: string;
  leadsRoot?: string;
  leadsRouteSecret?: string;
  orgLstatSync?: OrgRouterDeps["lstatSync"];
  orgWithDecisionsLock?: OrgRouterDeps["withDecisionsLock"];
  /** iterate-2026-09-07-leadwright-setup-wizard (W14) — see OrgRouterDeps. */
  leadwrightCheckoutRoot?: string;
  webuiBaseUrl?: string;
}
