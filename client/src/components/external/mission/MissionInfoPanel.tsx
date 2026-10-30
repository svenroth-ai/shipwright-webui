/*
 * MissionInfoPanel — the "Info" segment of the Mission right sidebar (M3):
 * Environment · Context · Outputs. READ-ONLY (DO-NOT #1); no composer, no
 * chat-* surface (spec 35). Context shows tokens + model, never a percentage.
 * Remote Control is an informational pill (On / Off / unknown). States: loading,
 * error (non-blocking, keeps the last data, pill falls back to unknown),
 * no-session ({status:"missing"}) and ok. No timer: manual Refresh button.
 */

import { useState } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import { useProject } from "../../../hooks/useProjects";
import { UNASSIGNED_PROJECT_ID } from "../../../lib/projectIds";
import {
  baseName,
  formatTokens,
  relativeToCwd,
  shortModel,
} from "../../../lib/sessionInfoFormat";

const OUTPUTS_PREVIEW = 5;

interface Props {
  task: ExternalTask;
  onOpenOutput: (relPath: string) => void;
  /** False while the panel is mounted-but-hidden: no scan is requested for a panel nobody sees. */
  active?: boolean;
}

function Row({ k, children, testId }: { k: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="env-row" data-testid={testId}>
      <span className="env-k">{k}</span>
      <span className="env-v">{children}</span>
    </div>
  );
}

export function MissionInfoPanel({ task, onOpenOutput, active = true }: Props) {
  const q = useSessionInfo(active ? task.taskId : null, task.state);
  // The Viewer/FolderTree resolve paths from the PROJECT root, which is not
  // always task.cwd (iterate worktrees, subfolder tasks) — relativize against it.
  const unassigned = task.projectId === UNASSIGNED_PROJECT_ID;
  const projectRoot = useProject(unassigned ? "" : task.projectId).data?.path ?? null;
  const info = q.data?.status === "ok" ? q.data.info : null;
  const remote: boolean | null = info ? info.remoteControl.active : null;
  const missing = q.data?.status === "missing";
  const failed = q.isError && !info;
  const [showAll, setShowAll] = useState(false);

  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const outputs = (() => {
    if (!info) return [];
    const seen = new Set<string>();
    return [...info.outputs]
      .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
      .filter((o) => (seen.has(o.path) ? false : (seen.add(o.path), true)));
  })();
  const shown = showAll ? outputs : outputs.slice(0, OUTPUTS_PREVIEW);

  return (
    <div className="env-panel" data-testid="mission-info-panel">
      <div className="env-toolbar">
        <button
          type="button"
          className="env-more"
          data-testid="env-refresh"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          {q.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {failed ? (
        <p className="env-empty" role="status" data-testid="env-error">
          Session info is unavailable right now. Use Refresh to try again.
        </p>
      ) : null}
      {missing ? (
        <p className="env-empty" data-testid="env-missing">
          No session recorded yet. Info appears once the session has started.
        </p>
      ) : null}
      <section aria-labelledby="env-h-environment" data-testid="env-environment">
        <h4 id="env-h-environment" className="env-h">Environment</h4>
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

      <section aria-labelledby="env-h-context" data-testid="env-context">
        <h4 id="env-h-context" className="env-h">Context</h4>
        {info && info.context.tokens !== null ? (
          <>
            <Row k="Tokens used" testId="env-tokens">
              {formatTokens(info.context.tokens)}
              {info.context.compactedSince ? (
                <span className="env-note"> (before compaction)</span>
              ) : null}
            </Row>
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

      <section aria-labelledby="env-h-outputs" data-testid="env-outputs">
        <h4 id="env-h-outputs" className="env-h">Outputs</h4>
        {outputs.length === 0 ? (
          <p className="env-empty" data-testid="env-outputs-empty">
            {q.isPending ? "Loading…" : failed || missing ? "—" : "No files written yet."}
          </p>
        ) : (
          <ul className="env-outputs">
            {shown.map((o) => {
              const rel = projectRoot ? relativeToCwd(o.path, projectRoot) : null;
              return (
                <li key={o.path}>
                  {rel ? (
                    <button
                      type="button"
                      className="env-output"
                      title={o.path}
                      data-testid="env-output"
                      onClick={() => onOpenOutput(rel)}
                    >
                      {baseName(o.path)}
                    </button>
                  ) : (
                    <span className="env-output is-inert" title={o.path} data-testid="env-output-inert">
                      {baseName(o.path)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {outputs.length > OUTPUTS_PREVIEW ? (
          <button
            type="button"
            className="env-more"
            data-testid="env-outputs-more"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show less" : `Show more (${outputs.length - OUTPUTS_PREVIEW})`}
          </button>
        ) : null}
      </section>
    </div>
  );
}
