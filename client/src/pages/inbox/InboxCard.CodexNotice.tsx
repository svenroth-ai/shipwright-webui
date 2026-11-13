/*
 * CodexNoticeCard — Codex Light AC6/§5.3's informational Inbox cards.
 *
 * Handles two inbox kinds, both FYI-only (no reply required, no Answer/
 * Dismiss action — the underlying condition auto-clears the notice the
 * next time the aggregator runs, same "ephemeral" character as
 * `terminal_prompt`):
 *   - `codex_watcher` — a `CodexTaskWatcher` notice (nudge sent, delivery
 *     error, unresolved no_oracle self-check, failed launch confirmation).
 *   - `codex_error`   — a Codex-reported structured error (turn abort,
 *     rate limit, etc.) detected in the live terminal.
 *
 * Same chrome as the sibling cards (InboxCardShell) so the Inbox reads as one
 * system — `codex_error` and a delivery error use the error tone (red bar +
 * eyebrow) since they name a real failure; `codex_watcher` keeps the shared
 * warning tone other FYI cards use.
 */
import type {
  CodexErrorInboxItem,
  CodexWatcherInboxItem,
  ExternalTask,
} from "../../lib/externalApi";
import { InboxCardShell, InboxEyebrow } from "./InboxCardShell";

const NOTICE_KIND_LABEL: Record<CodexWatcherInboxItem["noticeKind"], string> = {
  nudge_sent: "Nudge sent",
  delivery_error: "Delivery failed",
  no_oracle_unresolved: "Needs a status check",
  launch_confirmation_failed: "Launch may have failed",
};

export function CodexNoticeCard({
  item,
  task,
}: {
  item: CodexWatcherInboxItem | CodexErrorInboxItem;
  task: ExternalTask | undefined;
}) {
  const itemKey = item.kind === "codex_watcher" ? `cw-${item.taskId}` : `ce-${item.taskId}`;
  const bodyText = item.kind === "codex_watcher" ? item.detail : item.errorText;
  const label =
    item.kind === "codex_watcher" ? NOTICE_KIND_LABEL[item.noticeKind] : "Codex error";
  const isError = item.kind === "codex_error" || item.noticeKind === "delivery_error";
  const tone = isError ? "err" : "warn";

  return (
    <InboxCardShell
      testId={`inbox-card-${itemKey}`}
      itemKey={itemKey}
      sessionUuid={item.sessionUuid}
      task={task}
      tone={tone}
    >
      <InboxEyebrow tone={tone}>{label}</InboxEyebrow>

      <div
        data-testid={`inbox-question-text-${itemKey}`}
        style={{
          fontSize: "13px",
          color: "var(--color-text)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {bodyText}
      </div>
    </InboxCardShell>
  );
}
