/*
 * external/inbox/_derive.ts — JSONL cold-path derive + terminal_prompt
 * post-pass for the inbox aggregator. Extracted from the historical
 * routes.ts to keep `routes.ts` (the inbox shell) ≤ 300 LOC.
 *
 * Discriminated union: `ask_tool` > `terminal_prompt` > `text_question`.
 */

import { stat } from "node:fs/promises";

import { SessionWatcher } from "../../core/session-watcher.js";
import { parseSessionJsonl } from "../../core/session-parser.js";
import {
  deriveSessionInbox,
  DEFAULT_USER_BLOCKING_TOOLS,
} from "../../core/inbox-derive.js";
import { extractTerminalPrompt } from "../../core/terminal-prompt-detect.js";
import {
  SdkSessionsStore,
  type ExternalTask,
} from "../../core/sdk-sessions-store.js";

import {
  inboxDeriveCache,
  inboxNegativeCache,
  NEGATIVE_RESULT_TTL_MS,
  type InboxDeriveCacheEntry,
} from "./_cache.js";

export type AggregatedEntry =
  | {
      kind: "ask_tool";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      toolUseId: string;
      toolName: string;
      input: unknown;
      bestEffort: true;
    }
  | {
      kind: "text_question";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      questionId: string;
      questionText: string;
      bestEffort: true;
    }
  | {
      kind: "terminal_prompt";
      taskId: string;
      sessionUuid: string;
      taskTitle: string;
      promptText: string;
      bestEffort: true;
    };

/**
 * Walk every task in the store, return cached entries on a warm hit
 * (mtime + dismissed unchanged), otherwise re-read the JSONL +
 * re-derive. Persists `inbox.pendingToolUseIds` + `lastProcessedByteOffset`
 * to the store when they drift. Returns the aggregated rows + a flag
 * telling the caller whether to persist.
 */
export async function deriveInboxFromJsonl(args: {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
}): Promise<{ entries: AggregatedEntry[]; storeDirty: boolean }> {
  const { store, watcher } = args;
  const out: AggregatedEntry[] = [];
  let storeDirty = false;

  for (const task of store.list()) {
    // Skip tasks the user has explicitly closed or whose session is
    // unrecoverable — they cannot grow new pending interactions.
    if (task.state === "done" || task.state === "launch_failed") continue;

    const dismissedKey = task.inbox.dismissedToolUseIds
      .slice()
      .sort()
      .join(",");
    const cached = inboxDeriveCache.get(task.sessionUuid);

    // Warm-path fastpath (Phase A4): avoid the full findByUuid readdir
    // scan over every subdir of ~/.claude/projects by stat-ing the
    // previously resolved path directly.
    if (cached && (await tryWarmHit(task, cached, dismissedKey, out))) {
      continue;
    }

    // Cold path — either no cache entry, or the cached mtime is stale,
    // or the cached file is gone. Do the full scan.
    const negUntil = inboxNegativeCache.get(task.sessionUuid);
    const nowMs = Date.now();
    if (negUntil !== undefined && negUntil > nowMs) continue;

    const loc = await watcher.findByUuid(task.sessionUuid);
    if (!loc) {
      inboxNegativeCache.set(task.sessionUuid, nowMs + NEGATIVE_RESULT_TTL_MS);
      continue;
    }
    inboxNegativeCache.delete(task.sessionUuid);

    // Cold / stale — re-read + re-derive.
    let content = "";
    try {
      const chunk = await watcher.readChunk({
        sessionUuid: task.sessionUuid,
        fromByte: 0,
        expectFingerprint: null,
        location: loc, // resolved just above — don't walk the projects dir twice
      });
      if (chunk.status === "ok") content = chunk.chunk.content;
    } catch {
      continue;
    }
    const parsed = parseSessionJsonl(content);
    const result = deriveSessionInbox({
      events: parsed.events,
      allowlist: DEFAULT_USER_BLOCKING_TOOLS,
      dismissed: new Set(task.inbox.dismissedToolUseIds),
    });
    const cacheEntries: InboxDeriveCacheEntry["entries"] = [];
    for (const e of result.pending) {
      cacheEntries.push({
        kind: "ask_tool",
        toolUseId: e.toolUseId,
        toolName: e.toolName,
        input: e.input,
        taskTitle: task.title,
      });
      out.push({
        kind: "ask_tool",
        taskId: task.taskId,
        sessionUuid: task.sessionUuid,
        taskTitle: task.title,
        toolUseId: e.toolUseId,
        toolName: e.toolName,
        input: e.input,
        bestEffort: true,
      });
    }
    if (result.textQuestion) {
      cacheEntries.push({
        kind: "text_question",
        questionId: result.textQuestion.questionId,
        questionText: result.textQuestion.questionText,
        taskTitle: task.title,
      });
      out.push({
        kind: "text_question",
        taskId: task.taskId,
        sessionUuid: task.sessionUuid,
        taskTitle: task.title,
        questionId: result.textQuestion.questionId,
        questionText: result.textQuestion.questionText,
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

  return { entries: out, storeDirty };
}

/**
 * Phase 2 post-pass (iterate-2026-05-18-inbox-terminal-prompts) —
 * `terminal_prompt`: a waiting picker is on-screen in the embedded
 * terminal but never appears in the JSONL. Detect it from the live
 * @xterm/headless mirror. Precedence:
 *   ask_tool > terminal_prompt > text_question.
 */
export function appendTerminalPrompts(
  out: AggregatedEntry[],
  args: {
    store: SdkSessionsStore;
    ptyManager: {
      get(taskId: string): unknown;
      peekTerminalText?(taskId: string): string | null;
    };
  },
): void {
  const { store, ptyManager } = args;
  if (!ptyManager.peekTerminalText) return;
  const peek = ptyManager.peekTerminalText.bind(ptyManager);
  for (const task of store.list()) {
    if (task.state === "done" || task.state === "launch_failed") continue;
    // ask_tool wins outright — never double-surface the same task.
    if (out.some((e) => e.taskId === task.taskId && e.kind === "ask_tool")) {
      continue;
    }
    let promptText: string | null = null;
    try {
      const visible = peek(task.taskId);
      if (visible) promptText = extractTerminalPrompt(visible);
    } catch (err) {
      // Best-effort: a mirror read must never break the inbox. But a
      // silent swallow hides real regressions (external code review
      // openai-1) — log with task context before falling back.
      promptText = null;
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "inbox terminal_prompt detection failed for task",
          taskId: task.taskId,
          error: String(err).slice(0, 200),
        }),
      );
    }
    if (!promptText) continue;
    // terminal_prompt supersedes a JSONL text_question for the same task.
    const tqIdx = out.findIndex(
      (e) => e.taskId === task.taskId && e.kind === "text_question",
    );
    if (tqIdx >= 0) out.splice(tqIdx, 1);
    out.push({
      kind: "terminal_prompt",
      taskId: task.taskId,
      sessionUuid: task.sessionUuid,
      taskTitle: task.title,
      promptText,
      bestEffort: true,
    });
  }
}

/**
 * Helper for `deriveInboxFromJsonl`: returns true if the cached entries
 * were emitted (warm-hit), false to fall through to the cold path.
 */
async function tryWarmHit(
  task: ExternalTask,
  cached: InboxDeriveCacheEntry,
  dismissedKey: string,
  out: AggregatedEntry[],
): Promise<boolean> {
  let currentMtime: number | null = null;
  try {
    const s = await stat(cached.resolvedPath);
    currentMtime = s.mtimeMs;
  } catch {
    return false;
  }
  if (currentMtime !== cached.mtimeMs || cached.dismissedKey !== dismissedKey) {
    return false;
  }
  for (const e of cached.entries) {
    if (e.kind === "text_question") {
      out.push({
        kind: "text_question",
        taskId: task.taskId,
        sessionUuid: task.sessionUuid,
        taskTitle: e.taskTitle,
        questionId: e.questionId,
        questionText: e.questionText,
        bestEffort: true,
      });
    } else {
      out.push({
        kind: "ask_tool",
        taskId: task.taskId,
        sessionUuid: task.sessionUuid,
        taskTitle: e.taskTitle,
        toolUseId: e.toolUseId,
        toolName: e.toolName,
        input: e.input,
        bestEffort: true,
      });
    }
  }
  return true;
}
