/*
 * TaskNotificationChip — 2026-05-01 iterate-2026-05-01-task-notification-render.
 *
 * Renders a centered status pill for Claude Code background-task lifecycle
 * events (`<task-notification>` envelopes). The session-parser detects the
 * envelope (see `extractTaskNotification`) and emits a `task-notification`
 * kind event; this component is the renderer for that kind.
 *
 * Visual language: same chip pattern as `agent-name` / `permission-mode` /
 * `slash-command` (centered pill, monospace label, neutral palette). Status
 * dot color gates green (completed) vs red (failed) vs neutral (unknown).
 *
 * Security: `summary` and `taskId` render as React text nodes only; never
 * via dangerouslySetInnerHTML or derived classNames. The parser strips no
 * HTML, so this component is the sole defense.
 */

interface Props {
  status: string;
  summary: string;
  taskId: string;
}

export function TaskNotificationChip({ status, summary, taskId }: Props) {
  const palette = paletteForStatus(status);
  const label = summary.trim().length > 0
    ? summary
    : `Background task ${status}`;

  return (
    <div className="flex justify-start my-2" data-testid="task-notification-chip-row">
      <span
        data-testid="task-notification-chip"
        data-status={status}
        className="inline-flex max-w-[95%] items-center gap-1.5 px-2.5 py-1 text-[11px]"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          color: palette.text,
          background: palette.bg,
          borderRadius: "10px",
          opacity: 0.95,
        }}
        title={taskId ? `Background task ${taskId}` : undefined}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: palette.dot,
            flexShrink: 0,
          }}
        />
        <span style={{ opacity: 0.7 }}>Background task</span>
        <span
          className="truncate"
          style={{ color: palette.strong, fontWeight: 500 }}
          data-testid="task-notification-summary"
        >
          {label}
        </span>
      </span>
    </div>
  );
}

function paletteForStatus(status: string): {
  text: string;
  strong: string;
  bg: string;
  dot: string;
} {
  // Use the existing `--color-success` / `--color-warning` / muted tokens
  // so the chip inherits theme overrides and stays consistent with the
  // ask-bubble + system pills already in the transcript.
  if (status === "completed") {
    return {
      text: "var(--color-success, #059669)",
      strong: "var(--color-text, #1a1a1a)",
      bg: "rgba(5,150,105,0.10)",
      dot: "var(--color-success, #059669)",
    };
  }
  if (status === "failed") {
    return {
      text: "var(--color-error, #DC2626)",
      strong: "var(--color-text, #1a1a1a)",
      bg: "rgba(220,38,38,0.10)",
      dot: "var(--color-error, #DC2626)",
    };
  }
  return {
    text: "var(--color-muted, #6b7280)",
    strong: "var(--color-text, #1a1a1a)",
    bg: "rgba(107,114,128,0.10)",
    dot: "var(--color-muted, #6b7280)",
  };
}
