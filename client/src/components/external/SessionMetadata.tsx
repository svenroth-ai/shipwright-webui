import type { ExternalTask } from "../../lib/externalApi";

const STATE_STYLES: Record<ExternalTask["state"], string> = {
  draft: "bg-inset text-body",
  awaiting_external_start: "bg-warn-tint text-warn",
  active: "bg-ok-tint text-ok",
  idle: "bg-inset text-body",
  jsonl_missing: "bg-err-tint text-err",
  launch_failed: "bg-err-tint text-err",
  done: "bg-inset text-body",
};

interface Props {
  task: ExternalTask;
}

export function SessionMetadata({ task }: Props) {
  return (
    <div
      className="flex flex-col gap-1 p-3 text-sm"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-button)",
      }}
      data-testid="session-metadata"
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${STATE_STYLES[task.state]}`}
          data-testid="task-state-badge"
        >
          {task.state}
        </span>
        {task.parentTaskId && (
          <span className="rounded bg-info-tint px-2 py-0.5 text-xs text-info" title="Forked from a parent task">
            forked
          </span>
        )}
      </div>
      <div>
        <span className="text-muted">Session UUID: </span>
        <code className="font-mono text-xs">{task.sessionUuid}</code>
      </div>
      <div>
        <span className="text-muted">Working dir: </span>
        <code className="font-mono text-xs">{task.cwd}</code>
      </div>
      {task.pluginDirs.length > 0 && (
        <div>
          <span className="text-muted">Plugin dirs: </span>
          <span className="font-mono text-xs">{task.pluginDirs.length} passed</span>
        </div>
      )}
      {task.launchedAt && (
        <div>
          <span className="text-muted">Launched: </span>
          <span className="text-xs">{new Date(task.launchedAt).toLocaleString()}</span>
        </div>
      )}
      {task.firstJsonlObservedAt && (
        <div>
          <span className="text-muted">First JSONL: </span>
          <span className="text-xs">{new Date(task.firstJsonlObservedAt).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
