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
  /** Timestamp of the record that carried it (to tell a resumed agent from a finished one). */
  at: string | null;
  taskId: string;
  toolUseId: string | null;
  status: string | null;
  durationMs: number | null;
  tokens: number | null;
  toolUses: number | null;
}

export interface AgentToolUse {
  /** run_in_background: its tool_result is only a launch ack; completion arrives as a task-notification. */
  background: boolean;
  prompt: string | null;
  description: string | null;
}

export interface ToolResult {
  at: string | null;
  isError: boolean;
  status: string | null;
  durationMs: number | null;
  tokens: number | null;
  toolUses: number | null;
}

export interface Facts {
  /** tool_use ids with no tool_result yet: a long silent tool call is not a dead agent. */
  pendingUse: Set<string>;
  /** tool_use id -> result, for foreground subagents (no task-notification) and failed writes. */
  toolResults: Map<string, ToolResult>;
  /** output tool_use id -> output key, so an errored write can be retracted. */
  outputUses: Map<string, string>;
  /** Per output key, every write attempt, so a rejected one can be retracted exactly. */
  outputAttempts: Map<string, { id: string | null; ts: string | null; tool: SessionOutputFile["tool"] }[]>;
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
    pendingUse: new Set(),
    toolResults: new Map(),
    outputUses: new Map(),
    outputAttempts: new Map(),
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
  if (!cwd || !(isWin(cwd) || cwd.startsWith("/"))) return null; // relative path with no absolute cwd to anchor it — unknowable
  return isWin(cwd) ? path.win32.resolve(cwd, p) : path.posix.resolve(cwd, p);
}

export function outputKey(p: string): string {
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
/** First `<name>…</name>` content, by plain string search — `name` is never a pattern. */
export const tag = (body: string, name: string): string | null => {
  const open = `<${name}>`;
  const start = body.indexOf(open);
  if (start < 0) return null;
  const from = start + open.length;
  const end = body.indexOf(`</${name}>`, from);
  return end < 0 ? null : body.slice(from, end).trim();
};

function takeNotifications(text: string, into: Map<string, Notification>, at: string | null): void {
  for (const m of text.matchAll(NOTIF_RE)) {
    const body = m[1]!;
    const taskId = tag(body, "task-id");
    if (!taskId) continue;
    const d = tag(body, "duration_ms");
    const t = tag(body, "subagent_tokens");
    const u = tag(body, "tool_uses");
    // Later notifications win: an agent can be resumed and notify again.
    into.set(taskId, {
      at,
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

function retractAttempt(f: Facts, key: string, id: string): void {
  const list = (f.outputAttempts.get(key) ?? []).filter((a) => a.id !== id);
  f.outputAttempts.set(key, list);
  const out = f.outputs.get(key);
  if (!out) return;
  if (!list.length) {
    f.outputs.delete(key);
    return;
  }
  out.firstAt = list[0]!.ts;
  out.lastAt = list[list.length - 1]!.ts;
  out.tool = list[list.length - 1]!.tool;
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
  if (ts) {
    if (lineTs === null || lineTs !== ts) f.lastTs = ts; // the record's own stamp beats the cheap peek
    if (!f.firstTs || f.firstTs === lineTs) f.firstTs = ts;
  }
  if (type === "bridge-session") {
    f.bridgeSeen = true;
    return;
  }
  if (type === "attachment") return; // prompt snapshots quote tool docs verbatim; never facts
  const msg = o.message as Record<string, unknown> | undefined;

  if (hasNotif && (type === "user" || type === "queue-operation")) {
    const text = textOf(msg?.content) ?? str(o.content);
    if (text) takeNotifications(text, f.notifications, ts);
  }

  if (type === "user" && Array.isArray(msg?.content) && line.includes('"tool_result"')) {
    const tur = (o.toolUseResult ?? {}) as Record<string, unknown>;
    const single = (msg!.content as unknown[]).filter((b) => (b as Record<string, unknown>)?.type === "tool_result").length === 1;
    for (const b of msg!.content as Record<string, unknown>[]) {
      if (!b || b.type !== "tool_result" || !str(b.tool_use_id)) continue;
      const id = b.tool_use_id as string;
      // A background launch is acknowledged by an immediate non-error result; it is NOT completion.
      if (single && (tur.isAsync === true || tur.status === "async_launched")) continue;
      const isError = b.is_error === true;
      f.pendingUse.delete(id);
      f.toolResults.set(id, {
        at: ts,
        isError,
        // toolUseResult describes ONE result; only trust it when the line carries exactly one.
        status: single ? str(tur.status) : null,
        durationMs: single ? num(tur.totalDurationMs) : null,
        tokens: single ? num(tur.totalTokens) : null,
        toolUses: single ? num(tur.totalToolUseCount) : null,
      });
      const key = f.outputUses.get(id);
      if (isError && key) retractAttempt(f, key, id);
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
    if (str(b.id)) f.pendingUse.add(b.id as string);
    const name = str(b.name);
    const input = (b.input ?? {}) as Record<string, unknown>;
    if ((name === "Agent" || name === "Task") && str(b.id)) {
      f.agentToolUses.set(b.id as string, { background: input.run_in_background === true, prompt: capText(str(input.prompt)), description: capText(str(input.description)) });
    } else if (name && OUTPUT_TOOLS.has(name)) {
      const raw = str(input.file_path) ?? str(input.notebook_path);
      const abs = raw ? normalizeAbsolute(raw, str(o.cwd)) : null;
      if (!abs) continue;
      const key = outputKey(abs);
      const prev = f.outputs.get(key);
      const tool = name as SessionOutputFile["tool"];
      if (str(b.id)) f.outputUses.set(b.id as string, key);
      const list = f.outputAttempts.get(key) ?? [];
      list.push({ id: str(b.id), ts, tool });
      f.outputAttempts.set(key, list);
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
