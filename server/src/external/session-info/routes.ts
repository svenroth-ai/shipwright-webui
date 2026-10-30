/*
 * external/session-info/routes.ts — GET /api/external/tasks/:id/session-info.
 *
 * READ-ONLY derived view (context tokens, outputs, Remote Control, subagents)
 * of the task's Claude JSONL + its subagents/ siblings. Never mutates task state
 * or any Claude file (CLAUDE.md DO-NOT #1); statelessness per rule 4 — see the
 * memo note in core/session-info/session-info.ts.
 *
 *   200 { status: "ok", info }       200 { status: "missing" } (no JSONL yet)
 *   404 task unknown
 *
 * GET /api/external/tasks/:id/subagents/:agentId/transcript — the agent's own
 * JSONL tail (M4 Agents window): 200 { status: "ok", content, truncated,
 * sizeBytes } | { status: "missing" }; 400 malformed agentId; 404 task unknown.
 */

import { Hono } from "hono";

import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import type { SessionWatcher } from "../../core/session-watcher.js";
import { readSessionInfo, type SessionInfoDeps } from "../../core/session-info/session-info.js";
import { AGENT_ID_RE, readSubagentTranscript } from "../../core/session-info/subagent-transcript.js";

export interface SessionInfoRouterDeps {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
  /** Test seam (sessions dir, pid probe, clock). */
  infoDeps?: SessionInfoDeps;
}

export function createSessionInfoRouter(deps: SessionInfoRouterDeps): Hono {
  const app = new Hono();
  const { store, watcher } = deps;

  app.get("/api/external/tasks/:id/session-info", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    const loc = await watcher.findByUuid(task.sessionUuid);
    if (!loc) return c.json({ status: "missing" });
    try {
      return c.json({ status: "ok", info: await readSessionInfo(task.sessionUuid, loc, deps.infoDeps) });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return c.json({ status: "missing" });
      throw err;
    }
  });

  app.get("/api/external/tasks/:id/subagents/:agentId/transcript", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    const agentId = c.req.param("agentId");
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: "Invalid agent id" }, 400);
    const loc = await watcher.findByUuid(task.sessionUuid);
    if (!loc) return c.json({ status: "missing" });
    return c.json(await readSubagentTranscript(loc.path, agentId));
  });

  return app;
}
