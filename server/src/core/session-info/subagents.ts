/*
 * Subagent list for a session: `<session>/subagents/agent-<id>.jsonl` plus its
 * `.meta.json` (agentType, description, toolUseId, spawnDepth, parentAgentId
 * for depth 2, model). Joined on agentId.
 *
 * "Finished" comes from the `<task-notification>` the PARENT received — for a
 * depth-2 agent the parent is the depth-1 agent, so notifications are pooled
 * across the session file AND every agent file. The notification's own
 * `<result>` is often only a pointer ("delivered as a message"), so `answer`
 * is the last assistant text of the agent's own file. An agent with no
 * notification and a stale mtime is `finished-stale` (killed session, crash).
 */

import { lstat, readFile } from "node:fs/promises";

import type { AgentToolUse, Facts, Notification, ToolResult } from "./collect.js";
import type { SessionSubagent } from "./types.js";

export const SUBAGENT_STALE_MS = 10 * 60 * 1000;

export interface SubagentFile {
  agentId: string;
  jsonlPath: string;
  metaPath: string;
  mtimeMs: number;
  size: number;
}

const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function readMeta(p: string): Promise<Record<string, unknown>> {
  try {
    // lstat: a symlinked meta file is never followed; meta files are tiny, refuse anything else.
    const st = await lstat(p);
    if (!st.isFile() || st.size > 64 * 1024) return {};
    const o: unknown = JSON.parse(await readFile(p, "utf8"));
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function buildSubagents(
  files: SubagentFile[],
  subFacts: Map<string, Facts>,
  parent: Facts,
  now: number,
): Promise<SessionSubagent[]> {
  const notifs = new Map<string, Notification>(parent.notifications);
  const toolUses = new Map<string, AgentToolUse>(parent.agentToolUses);
  for (const f of subFacts.values()) {
    for (const [k, v] of f.notifications) notifs.set(k, v);
    for (const [k, v] of f.agentToolUses) toolUses.set(k, v);
  }
  const results = new Map<string, ToolResult>(parent.toolResults);
  for (const f of subFacts.values()) for (const [k, v] of f.toolResults) results.set(k, v);
  const out: SessionSubagent[] = [];
  for (const file of files) {
    const meta = await readMeta(file.metaPath);
    const facts = subFacts.get(file.agentId);
    const n = notifs.get(file.agentId) ?? null;
    const toolUseId = s(meta.toolUseId) ?? n?.toolUseId ?? null;
    const tu = toolUseId ? toolUses.get(toolUseId) : undefined;
    const startedAt = facts?.firstTs ?? null;
    const lastTs = facts?.lastTs ?? null;
    const tr = toolUseId ? results.get(toolUseId) : undefined;
    const status = n?.status ?? (tr ? (tr.isError ? "failed" : (tr.status ?? "completed")) : null);
    const state = n || tr ? "finished" : now - file.mtimeMs > SUBAGENT_STALE_MS ? "finished-stale" : "running";
    const wall =
      startedAt && lastTs && Date.parse(lastTs) >= Date.parse(startedAt) ? Date.parse(lastTs) - Date.parse(startedAt) : null;
    out.push({
      agentId: file.agentId,
      agentType: s(meta.agentType),
      description: s(meta.description) ?? tu?.description ?? null,
      toolUseId,
      spawnDepth: typeof meta.spawnDepth === "number" ? meta.spawnDepth : null,
      parentAgentId: s(meta.parentAgentId),
      model: s(meta.model) ?? facts?.model ?? null,
      prompt: tu?.prompt ?? null,
      answer: facts?.lastAssistantText ?? null,
      startedAt,
      endedAt: state === "running" ? null : lastTs,
      durationMs: n?.durationMs ?? tr?.durationMs ?? (state === "running" ? null : wall),
      state,
      status,
      tokens: n?.tokens ?? tr?.tokens ?? null,
      toolUses: n?.toolUses ?? tr?.toolUses ?? null,
    });
  }
  out.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  return out;
}
