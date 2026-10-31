/*
 * MissionInfoPanel — the "Info" segment of the Mission right sidebar (M3):
 * Environment · Context · Outputs. READ-ONLY (DO-NOT #1); no composer, no
 * chat-* surface (spec 35). Context shows tokens + model, never a percentage.
 * Remote Control is an informational pill (On / Off / unknown). States: loading,
 * error (non-blocking, keeps the last data, pill falls back to unknown),
 * no-session ({status:"missing"}) and ok. No timer: manual Refresh button.
 */


import type { ExternalTask } from "../../../lib/externalApi";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import { useProject } from "../../../hooks/useProjects";
import { UNASSIGNED_PROJECT_ID } from "../../../lib/projectIds";
import { formatTokens, shortModel } from "../../../lib/sessionInfoFormat";
import type { ViewerTarget } from "../../../lib/viewerTarget";
import { MissionInfoOutputs } from "./MissionInfoOutputs";

interface Props {
  task: ExternalTask;
  onOpenOutput: (target: ViewerTarget) => void;
  /** False while the panel is mounted-but-hidden: no scan is requested for a panel nobody sees. */
  active?: boolean;
}

function Row({ k, children, testId, big }: { k: string; children: React.ReactNode; testId: string; big?: boolean }) {
  return (
    <div className="env-row" data-testid={testId}>
      <span className="env-k">{k}</span>
      <span className={big ? "env-v env-big" : "env-v"}>{children}</span>
    </div>
  );
}

export function MissionInfoPanel({ task, onOpenOutput, active = true }: Props) {
  const q = useSessionInfo(active ? task.taskId : null, task.state);
  // The Viewer/FolderTree resolve paths from the PROJECT root, which is not
  // always task.cwd (iterate worktrees, subfolder tasks) — relativize against it.
  const unassigned = task.projectId === UNASSIGNED_PROJECT_ID;
  const projectQ = useProject(unassigned ? "" : task.projectId);
  const projectRoot = projectQ.data?.path ?? null;
  // inside/outside is only known once the project has loaded (or there is none)
  const rootReady = unassigned || !projectQ.isPending;
  const info = q.data?.status === "ok" ? q.data.info : null;
  // After a failed refetch the cached On/Off may be stale (session ended): show Unknown.
  const remote: boolean | null = info && !q.isError ? info.remoteControl.active : null;
  const missing = q.data?.status === "missing";
  const failed = q.isError;

  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const outputs = (() => {
    if (!info) return [];
    const seen = new Set<string>();
    return [...info.outputs]
      .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
      .filter((o) => (seen.has(o.path) ? false : (seen.add(o.path), true)))
      .map((o) => o.path);
  })();

  return (
    <div className="env-panel" data-testid="mission-info-panel">
      {failed ? (
        <p className="env-empty" role="status" data-testid="env-error">
          Session info could not be refreshed{info ? " (showing the last known values)" : ""}. Use Refresh to try again.
        </p>
      ) : null}
      {missing ? (
        <p className="env-empty" data-testid="env-missing">
          No session recorded yet. Info appears once the session has started.
        </p>
      ) : null}
      <section className="env-sec" aria-labelledby="env-h-environment" data-testid="env-environment">
        <h4 id="env-h-environment" className="env-h">
          <span>Environment</span>
          <button
            type="button"
            className="env-refresh"
            data-testid="env-refresh"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            {q.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </h4>
        <Row k="Computer" testId="env-computer">
          This computer{host && host !== "localhost" ? ` (${host})` : ""}
        </Row>
        <Row k="Project folder" testId="env-folder">
          <span className="env-mono" title={task.cwd}>{task.cwd}</span>
        </Row>
        <Row k="Remote Control" testId="env-remote-control">
          {remote === null ? (
            <span className="env-pill" data-state="unknown" data-testid="env-remote-unknown">Unknown</span>
          ) : (
            <span className="env-pill" data-state={remote ? "on" : "off"} data-testid="env-remote-pill">
              {remote ? "On" : "Off"}
            </span>
          )}
        </Row>
      </section>

      <section className="env-sec" aria-labelledby="env-h-context" data-testid="env-context">
        <h4 id="env-h-context" className="env-h">Context</h4>
        {info && (info.context.tokens !== null || info.context.model) ? (
          <>
            {info.context.tokens !== null ? (
              <Row k="Tokens used" testId="env-tokens" big>
                {formatTokens(info.context.tokens)}
                {info.context.compactedSince ? (
                  <span className="env-note"> (before compaction)</span>
                ) : null}
              </Row>
            ) : null}
            {info.context.model ? (
              <Row k="Model" testId="env-model">{shortModel(info.context.model)}</Row>
            ) : null}
          </>
        ) : (
          <p className="env-empty" data-testid="env-context-empty">
            {q.isPending ? "Loading…" : failed || missing ? "—" : "No usage recorded yet."}
          </p>
        )}
      </section>

      <MissionInfoOutputs
        paths={outputs}
        projectRoot={projectRoot}
        rootReady={rootReady}
        emptyText={q.isPending ? "Loading…" : failed || missing ? "—" : "No files written yet."}
        onOpen={onOpenOutput}
      />
    </div>
  );
}
