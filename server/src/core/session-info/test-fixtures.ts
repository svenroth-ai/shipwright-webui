/* Fixture builders for the session-info tests — synthetic JSONL in Claude's real shapes. */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const SESSION = "11111111-2222-4333-8444-555555555555";
export const WIN_CWD = "C:\\proj\\repo";

export const ts = (n: number) => new Date(Date.UTC(2026, 9, 30, 10, 0, n)).toISOString();
export const jl = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";

export const assistant = (
  n: number,
  opts: { usage?: [number, number, number]; model?: string; blocks?: unknown[]; cwd?: string; sidechain?: boolean } = {},
) => ({
  type: "assistant",
  isSidechain: opts.sidechain ?? false,
  timestamp: ts(n),
  cwd: opts.cwd ?? WIN_CWD,
  message: {
    role: "assistant",
    model: opts.model ?? "claude-opus-4",
    usage: opts.usage
      ? { input_tokens: opts.usage[0], cache_read_input_tokens: opts.usage[1], cache_creation_input_tokens: opts.usage[2], output_tokens: 9 }
      : undefined,
    content: opts.blocks ?? [{ type: "text", text: `reply ${n}` }],
  },
});

export const toolUse = (name: string, input: Record<string, unknown>, id = `toolu_${name}_${Math.random()}`) => ({
  type: "tool_use",
  id,
  name,
  input,
});

export const notification = (agentId: string, toolUseId: string, status: string, durationMs = 5000) =>
  `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>x</summary>\n<result>delivered as a message</result>\n<usage><subagent_tokens>1234</subagent_tokens><tool_uses>7</tool_uses><duration_ms>${durationMs}</duration_ms></usage>\n</task-notification>`;

export const userNotif = (n: number, text: string) => ({ type: "user", timestamp: ts(n), message: { role: "user", content: text } });

export interface Layout {
  projectsDir: string;
  sessionPath: string;
  subDir: string;
}

export function makeLayout(): Layout {
  const projectsDir = mkdtempSync(path.join(tmpdir(), "sessinfo-"));
  const enc = path.join(projectsDir, "C--proj-repo");
  mkdirSync(path.join(enc, SESSION, "subagents"), { recursive: true });
  return { projectsDir, sessionPath: path.join(enc, `${SESSION}.jsonl`), subDir: path.join(enc, SESSION, "subagents") };
}

export function writeAgent(
  l: Layout,
  agentId: string,
  meta: Record<string, unknown>,
  lines: unknown[],
): string {
  const p = path.join(l.subDir, `agent-${agentId}.jsonl`);
  writeFileSync(p, jl(...lines));
  writeFileSync(path.join(l.subDir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
  return p;
}
