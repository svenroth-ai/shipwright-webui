/*
 * external/inbox/routes.ts — GET /api/external/inbox + POST /inbox/:toolUseId/dismiss.
 *
 * Aggregates pending interactions across all tracked tasks:
 *   - `ask_tool` — an unanswered AskUserQuestion tool_use in the JSONL.
 *   - `text_question` — a plain-text end-of-turn question detected by
 *     `detectAwaitingUserQuestion`.
 *   - `terminal_prompt` — a waiting picker visible in the LIVE headless
 *     mirror but not (yet) journaled to the JSONL.
 *
 * Precedence: ask_tool > terminal_prompt > text_question. terminal_prompt
 * is a post-pass over the JSONL-derived set so the mtime-keyed cache
 * stays byte-identical.
 *
 * Phase A4 hot-path: per-session derive cache + negative-result cache
 * — see `./_cache.ts`. JSONL cold-path + terminal_prompt post-pass live
 * in `./_derive.ts` to keep this shell ≤ 300 LOC.
 */

import { Hono } from "hono";

import { SessionWatcher } from "../../core/session-watcher.js";
import { SdkSessionsStore } from "../../core/sdk-sessions-store.js";

import { inboxDeriveCache } from "./_cache.js";
import { deriveInboxFromJsonl, appendTerminalPrompts } from "./_derive.js";

export interface InboxRouterDeps {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
  ptyManager: {
    get(taskId: string): unknown;
    peekTerminalText?(taskId: string): string | null;
  };
}

export function createInboxRouter(deps: InboxRouterDeps): Hono {
  const app = new Hono();
  const { store, watcher, ptyManager } = deps;

  app.get("/api/external/inbox", async (c) => {
    const { entries, storeDirty } = await deriveInboxFromJsonl({
      store,
      watcher,
    });
    appendTerminalPrompts(entries, { store, ptyManager });
    if (storeDirty) await store.persist();
    return c.json({ items: entries });
  });

  app.post("/api/external/inbox/:toolUseId/dismiss", async (c) => {
    const toolUseId = c.req.param("toolUseId");
    for (const task of store.list()) {
      if (!task.inbox.pendingToolUseIds.includes(toolUseId)) continue;
      const dismissed = new Set(task.inbox.dismissedToolUseIds);
      dismissed.add(toolUseId);
      store.patch(task.taskId, {
        inbox: {
          pendingToolUseIds: task.inbox.pendingToolUseIds.filter(
            (id) => id !== toolUseId,
          ),
          dismissedToolUseIds: Array.from(dismissed),
          lastProcessedByteOffset: task.inbox.lastProcessedByteOffset,
        },
      });
      // Phase A4 — bust the derive cache for this session so the next
      // GET /inbox call reflects the reduced pending set immediately.
      inboxDeriveCache.delete(task.sessionUuid);
      await store.persist();
      return c.json({ ok: true, taskId: task.taskId });
    }
    return c.json(
      { ok: false, error: "toolUseId not found in any pending set" },
      404,
    );
  });

  return app;
}
