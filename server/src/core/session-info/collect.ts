/*
 * One-pass fact collector over the lines of ONE session/subagent JSONL.
 * Pure (string in, facts out) so the same code serves the session file and
 * every `subagents/agent-*.jsonl`. Cheap `includes()` pre-filters keep the
 * JSON.parse bill off the (many, large) lines that cannot matter.
 */

import path from "node:path";

import type { SessionOutputFile } from "./types.js";

const OUTPUT_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);

export interface Notification {
  taskId: string;
  toolUseId: string | null;
  status: string | null;
  durationMs: number | null;
  tokens: number | null;
  toolUses: number | null;
}

export interface AgentToolUse {
  prompt: string | null;
  description: string | null;
}

export interface ToolResult {
  isError: boolean;
  status: string | null;
  durationMs: number | null;
  tokens: number | null;
  toolUses: number | null;
}

export interface Facts {
  /** tool_use id -> result, for foreground subagents (no task-notification) and failed writes. */
  toolResults: Map<string, ToolResult>;
  /** output tool_use id -> output key, so an errored write can be retracted. */
  outputUses: Map<string, string>;
  outputTouches: Map<string, number>;
  usage: { tokens: number; model: string | null; at: string | null } | null;
  /** Index (line ordinal) of the usage line, to order it against compactions. */
  usageSeq: number;
  compactions: { at: string | null; preTokens: number | null; postTokens: number | null; seq: number }[];
  bridgeSeen: boolean;
  outputs: Map<string, SessionOutputFile>;
  notifications: Map<string, Notification>;
  agentToolUses: Map<string, AgentToolUse>;
  firstTs: string | null;
  lastTs: string | null;
  lastAssistantText: string | null;
  model: string | null;
  seq: number;
}

export function newFacts(): Facts {
  return {
    toolResults: new Map(),
    outputUses: new Map(),
    outputTouches: new Map(),
    usage: null,
    usageSeq: -1,
    compactions: [],
    bridgeSeen: false,
    outputs: new Map(),
    notifications: new Map(),
    agentToolUses: new Map(),
    firstTs: null,
    lastTs: null,
    lastAssistantText: null,
    model: null,
    seq: 0,
  };
}

export const TEXT_CAP = 4000;
const capText = (s: string | null): string | null => (s && s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}…` : s);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Windows-style when the string looks like a drive/UNC path, else POSIX. */
function normalizeAbsolute(p: string, cwd: string | null): string | null {
  const isWin = (s: string) => /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\");
  if (isWin(p)) return path.win32.normalize(p);
  if (p.startsWith("/")) return cwd && isWin(cwd) ? null : path.posix.normalize(p);
  if (!cwd) return null; // relative path with no cwd to anchor it — unknowable
  return isWin(cwd) ? path.win32.resolve(cwd, p) : path.posix.resolve(cwd, p);
}

function outputKey(p: string): string {
  return /^[A-Za-z]:|^\\\\/.test(p) ? p.toLowerCase() : p;
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((b): b is { type: string; text: string } => !!b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text);
  return parts.length ? parts.join("\n") : null;
}

const NOTIF_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const tag = (body: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body);
  return m ? m[1]!.trim() : null;
};

function takeNotifications(text: string, into: Map<string, Notification>): void {
  for (const m of text.matchAll(NOTIF_RE)) {
    const body = m[1]!;
    const taskId = tag(body, "task-id");
    if (!taskId) continue;
    const d = tag(body, "duration_ms");
    const t = tag(body, "subagent_tokens");
    const u = tag(body, "tool_uses");
    // Later notifications win: an agent can be resumed and notify again.
    into.set(taskId, {
      taskId,
      toolUseId: tag(body, "tool-use-id"),
      status: tag(body, "status"),
      durationMs: d && /^\d+$/.test(d) ? Number(d) : null,
      tokens: t && /^\d+$/.test(t) ? Number(t) : null,
      toolUses: u && /^\d+$/.test(u) ? Number(u) : null,
    });
  }
}

/** Cheap timestamp peek so non-matching lines never reach JSON.parse. */
export function quickTimestamp(line: string): string | null {
  const i = line.lastIndexOf('"timestamp":"');
  if (i === -1) return null;
  const j = line.indexOf('"', i + 13);
  return j === -1 || j - i > 60 ? null : line.slice(i + 13, j);
}

export function ingestLine(f: Facts, line: string, agentId: string | null): void {
  f.seq++;
  const hasNotif = line.includes("<task-notification>") && line.includes("<task-id>");
  const mayMatter =
    hasNotif ||
    line.includes('"assistant"') ||
    line.includes('"bridge-session"') ||
    line.includes('"compact_boundary"') ||
    line.includes('"tool_result"');
  const lineTs = quickTimestamp(line);
  if (lineTs) {
    if (!f.firstTs) f.firstTs = lineTs;
    f.lastTs = lineTs;
  }
  if (!mayMatter) return;
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") return;
    o = parsed as Record<string, unknown>;
  } catch {
    return; // torn / non-JSON line
  }
  const type = o.type;
  const ts = str(o.timestamp);
  if (type === "bridge-session") {
    f.bridgeSeen = true;
    return;
  }
  if (type === "attachment") return; // prompt snapshots quote tool docs verbatim; never facts
  const msg = o.message as Record<string, unknown> | undefined;

  if (hasNotif && (type === "user" || type === "queue-operation")) {
    const text = textOf(msg?.content) ?? str(o.content);
    if (text) takeNotifications(text, f.notifications);
  }

  if (type === "user" && Array.isArray(msg?.content) && line.includes('"tool_result"')) {
    const tur = (o.toolUseResult ?? {}) as Record<string, unknown>;
    const single = (msg!.content as unknown[]).filter((b) => (b as Record<string, unknown>)?.type === "tool_result").length === 1;
    for (const b of msg!.content as Record<string, unknown>[]) {
      if (!b || b.type !== "tool_result" || !str(b.tool_use_id)) continue;
      const id = b.tool_use_id as string;
      const isError = b.is_error === true;
      f.toolResults.set(id, {
        isError,
        // toolUseResult describes ONE result; only trust it when the line carries exactly one.
        status: single ? str(tur.status) : null,
        durationMs: single ? num(tur.totalDurationMs) : null,
        tokens: single ? num(tur.totalTokens) : null,
        toolUses: single ? num(tur.totalToolUseCount) : null,
      });
      const key = f.outputUses.get(id);
      if (isError && key) {
        // A rejected / failed write produced nothing: retract this touch.
        const left = (f.outputTouches.get(key) ?? 1) - 1;
        f.outputTouches.set(key, left);
        if (left <= 0) f.outputs.delete(key);
      }
    }
    return;
  }

  if (type === "system" && o.subtype === "compact_boundary") {
    const cm = (o.compactMetadata ?? {}) as Record<string, unknown>;
    f.compactions.push({ at: ts, preTokens: num(cm.preTokens), postTokens: num(cm.postTokens), seq: f.seq });
    return;
  }

  if (type !== "assistant" || !msg || (o.isSidechain === true && agentId === null)) return;
  const model = str(msg.model);
  const usage = msg.usage as Record<string, unknown> | undefined;
  if (model !== "<synthetic>") {
    if (model) f.model = model;
    if (usage) {
      f.usage = {
        tokens: (num(usage.input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0),
        model,
        at: ts,
      };
      f.usageSeq = f.seq;
    }
  }
  const content = msg.content;
  if (!Array.isArray(content)) return;
  let text: string | null = null;
  for (const b of content as Record<string, unknown>[]) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) text = b.text;
    if (b.type !== "tool_use") continue;
    const name = str(b.name);
    const input = (b.input ?? {}) as Record<string, unknown>;
    if ((name === "Agent" || name === "Task") && str(b.id)) {
      f.agentToolUses.set(b.id as string, { prompt: capText(str(input.prompt)), description: capText(str(input.description)) });
    } else if (name && OUTPUT_TOOLS.has(name)) {
      const raw = str(input.file_path) ?? str(input.notebook_path);
      const abs = raw ? normalizeAbsolute(raw, str(o.cwd)) : null;
      if (!abs) continue;
      const key = outputKey(abs);
      const prev = f.outputs.get(key);
      if (str(b.id)) f.outputUses.set(b.id as string, key);
      f.outputTouches.set(key, (f.outputTouches.get(key) ?? 0) + 1);
      if (prev) {
        prev.lastAt = ts ?? prev.lastAt;
        prev.tool = name as SessionOutputFile["tool"];
      } else {
        f.outputs.set(key, { path: abs, tool: name as SessionOutputFile["tool"], firstAt: ts, lastAt: ts, agentId });
      }
    }
  }
  if (text) f.lastAssistantText = capText(text);
}
