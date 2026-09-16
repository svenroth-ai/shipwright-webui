/*
 * external/inbox/_codex.ts — the `codex_watcher`/`codex_approval`/
 * `codex_error` inbox kinds (Codex Light AC6, §5.3).
 *
 * `appendCodexWatcherNotices` mirrors `appendLeadQuestions`'s shape: a
 * post-pass over the `CodexTaskWatcher`'s ephemeral, in-memory `snapshot()`
 * (never a JSONL or terminal read — see `core/codex-task-watcher.ts`'s
 * module header for the classification table this feeds). One entry per
 * task currently holding a notice (nudge sent, delivery error, unresolved
 * no_oracle self-check, or a failed launch confirmation) — the watcher
 * itself already collapses each task to its single latest notice, so no
 * further precedence/dedup is needed here.
 *
 * `appendCodexTerminalSignals` mirrors `appendTerminalPrompts`'s shape
 * (`_derive.ts`) instead: a post-pass over the live embedded-terminal
 * viewport text (`core/codex-terminal-signal-detect.ts`), scoped to
 * Codex-runtime tasks only. Independent of the silence-timer/oracle loop
 * (§5.3's own wording), so it runs on every Inbox GET, not gated by the
 * watcher's stall timer. Approval wins over error when a viewport somehow
 * matches both (an approval dialog is the more actionable, more common
 * case — a genuine error footer overwriting a still-open dialog would mean
 * the dialog already closed).
 */

import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import type { CodexTaskWatcher } from "../../core/codex-task-watcher.js";
import {
  extractCodexApprovalPrompt,
  extractCodexErrorText,
} from "../../core/codex-terminal-signal-detect.js";
import type { AggregatedEntry } from "./_types.js";

export function appendCodexWatcherNotices(
  entries: AggregatedEntry[],
  args: { store: SdkSessionsStore; codexWatcher: Pick<CodexTaskWatcher, "snapshot"> },
): void {
  const { store, codexWatcher } = args;
  for (const notice of codexWatcher.snapshot()) {
    const task = store.get(notice.taskId);
    if (!task) continue;
    if (task.state === "done" || task.state === "launch_failed") continue;
    entries.push({
      kind: "codex_watcher",
      taskId: task.taskId,
      sessionUuid: task.sessionUuid,
      taskTitle: task.title,
      noticeKind: notice.kind,
      detail: notice.detail,
      bestEffort: true,
    });
  }
}

export function appendCodexTerminalSignals(
  entries: AggregatedEntry[],
  args: {
    store: SdkSessionsStore;
    ptyManager: { peekTerminalText?(taskId: string): string | null };
  },
): void {
  const { store, ptyManager } = args;
  if (!ptyManager.peekTerminalText) return;
  const peek = ptyManager.peekTerminalText.bind(ptyManager);
  for (const task of store.list()) {
    if (task.runtime !== "codex") continue;
    if (task.state === "done" || task.state === "launch_failed") continue;
    let visible: string | null;
    try {
      visible = peek(task.taskId);
    } catch {
      continue; // best-effort — a mirror read must never break the inbox
    }
    if (!visible) continue;

    const promptText = extractCodexApprovalPrompt(visible);
    if (promptText) {
      entries.push({
        kind: "codex_approval",
        taskId: task.taskId,
        sessionUuid: task.sessionUuid,
        taskTitle: task.title,
        promptText,
        bestEffort: true,
      });
      continue;
    }

    const errorText = extractCodexErrorText(visible);
    if (errorText) {
      entries.push({
        kind: "codex_error",
        taskId: task.taskId,
        sessionUuid: task.sessionUuid,
        taskTitle: task.title,
        errorText,
        bestEffort: true,
      });
    }
  }
}
