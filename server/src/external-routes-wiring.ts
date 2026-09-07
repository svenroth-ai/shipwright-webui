/*
 * server/src/external-routes-wiring.ts — builds the `createExternalRoutes`
 * injection object from index.ts's already-constructed singletons. Split
 * out (iterate-2026-09-07-leadwright-setup-wizard) to keep index.ts under
 * the bloat ceiling — pure object construction, no new behavior.
 */
import { getProfilesDir, loadProfile as loadProfileReal } from "./core/profile-loader.js";
import type { ProjectManager } from "./core/project-manager.js";
import type { SdkSessionsStore } from "./core/sdk-sessions-store.js";
import type { SessionWatcher } from "./core/session-watcher.js";
import type { PreviewSessionManager } from "./core/preview-session-manager.js";
import type { ScrollbackStore } from "./terminal/scrollback-store.js";
import type { SnapshotStore } from "./terminal/snapshot-store.js";
import type { PtyManager } from "./terminal/pty-manager.js";
import type { ServerConfig } from "./config.js";
import type { CreateExternalRoutesArgs } from "./external/create-external-routes-args.js";

export interface ExternalRoutesWiringDeps {
  sdkSessionsStore: SdkSessionsStore;
  sessionWatcher: SessionWatcher;
  projectManager: ProjectManager;
  previewManager: PreviewSessionManager;
  scrollbackStore: ScrollbackStore;
  snapshotStore: SnapshotStore;
  ptyManager: PtyManager;
  honoHost: string;
  config: ServerConfig;
}

export function buildExternalRoutesArgs(deps: ExternalRoutesWiringDeps): CreateExternalRoutesArgs {
  const {
    sdkSessionsStore,
    sessionWatcher,
    projectManager,
    previewManager,
    scrollbackStore,
    snapshotStore,
    ptyManager,
    honoHost,
    config,
  } = deps;

  return {
    store: sdkSessionsStore,
    watcher: sessionWatcher,
    // Section 02 — PATCH/POST projectId validation. Excludes the
    // synthesized Unassigned row (that sentinel is hard-coded valid
    // inside validateProjectIdOrError).
    getKnownProjectIds: () =>
      new Set(projectManager.getAll().filter((p) => !p.synthesized).map((p) => p.id)),
    // Section 03 — actions / preview / stub routes. Synthesized row
    // has no filesystem path so it's skipped by getProjectById.
    getProjectById: (id) => {
      const p = projectManager.getById(id);
      if (!p || p.synthesized) return undefined;
      return {
        id: p.id,
        name: p.name,
        path: p.path,
        profile: p.profile,
        synthesized: p.synthesized,
        settings: p.settings ? { color: p.settings.color } : undefined,
      };
    },
    previewManager,
    loadProfile: (name: string) => loadProfileReal(name, getProfilesDir()),
    // ADR-068-A1: cascade-clean scrollback on DELETE /tasks/:id.
    scrollbackClearBestEffort: (taskId: string) => scrollbackStore.clearBestEffort(taskId),
    // Iterate C (ADR-087, MEDIUM-B1): cascade-clean the cell-state
    // snapshot on DELETE (secrets; privacy boundary). D19/F26: clear()
    // also sweeps the task's orphaned `.snapshot.tmp-*` strays.
    snapshotClearBestEffort: (taskId: string) => snapshotStore.clearBestEffort(taskId),
    // iterate-2026-05-08 v0.8.7 AC-1: live-pty lookup so transcript
    // poll can flip new-plain `active → idle` after pty-kill.
    // iterate-2026-05-18-inbox-terminal-prompts: peekTerminalText so
    // the inbox can detect a waiting AskUserQuestion picker from the
    // live @xterm/headless mirror.
    ptyManager: {
      get: (taskId: string) => ptyManager.get(taskId),
      kill: (taskId: string) => ptyManager.kill(taskId), // D01/F01 — teardown before clears
      peekTerminalText: (taskId: string) => ptyManager.peekTerminalText(taskId),
    },
    honoHost, // FR-04.38 org-directory route family
    leadsRoot: config.leadsRoot,
    leadsRouteSecret: config.leadsRouteSecret,
    // iterate-2026-09-07-leadwright-setup-wizard (W14)
    leadwrightCheckoutRoot: config.leadwrightCheckoutRoot,
    webuiBaseUrl: `http://localhost:${process.env.VITE_PORT ?? "5173"}`,
  };
}
