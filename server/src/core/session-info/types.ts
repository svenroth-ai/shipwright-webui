/*
 * Wire shapes of GET /api/external/tasks/:id/session-info (campaign
 * mission-desktop-style, M2). READ-ONLY view derived from Claude's own files
 * (CLAUDE.md DO-NOT #1) — nothing here is ever written back.
 *
 * Outputs are ATTEMPTED-then-not-rejected writes: a tool_use whose result is_error is retracted.
 * Runtime: Claude only (Codex tasks have no such JSONL and answer status "missing").
 *
 * Deliberately absent: a context PERCENTAGE and a context WINDOW SIZE. The
 * window depends on the model/plan and is not recorded in the JSONL; inventing
 * one would be a guess dressed as a fact. Consumers show the raw token count.
 */

export interface SessionContextInfo {
  /** input + cache_read + cache_creation of the newest non-synthetic assistant message; null when none seen. */
  tokens: number | null;
  model: string | null;
  /** Timestamp of the message the numbers came from. */
  at: string | null;
  /**
   * A compaction happened AFTER that message, so `tokens` is stale. When set,
   * `tokens` is the compactor's own `postTokens` estimate instead (null when it recorded none).
   */
  compactedSince: boolean;
}

export interface SessionCompactionInfo {
  /** Compactions seen inside the scanned window. */
  count: number;
  last: { at: string | null; preTokens: number | null; postTokens: number | null } | null;
}

export interface SessionOutputFile {
  /** Absolute, normalised against the cwd of the entry that wrote it. */
  path: string;
  tool: "Write" | "Edit" | "NotebookEdit" | "MultiEdit";
  firstAt: string | null;
  lastAt: string | null;
  /** Agent id when a subagent produced it; null for the session itself. */
  agentId: string | null;
}

export interface SessionRemoteControl {
  /** A LIVE process of this session currently has a bridge session. */
  active: boolean;
  /** A bridge-session record exists in the JSONL — it was enabled at least once. */
  onceEnabled: boolean;
  pid: number | null;
}

export type SubagentState = "running" | "finished" | "finished-stale";

export interface SessionSubagent {
  agentId: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  spawnDepth: number | null;
  /** Set for depth-2 agents (a reviewer spawned by a sub-iterate). */
  parentAgentId: string | null;
  model: string | null;
  prompt: string | null;
  /** Last assistant text of the agent's own file (the notification's result is often just a pointer). */
  answer: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  state: SubagentState;
  /** completed | failed | killed | stopped, from the parent's task-notification; null without one. */
  status: string | null;
  tokens: number | null;
  toolUses: number | null;
}

export interface SessionInfoScan {
  /** True when the session file was larger than the scan window; older history is not reflected. */
  truncated: boolean;
  scannedBytes: number;
  sizeBytes: number;
  /** Outputs / subagents beyond the caps (MAX_OUTPUTS, MAX_SUBAGENTS) that were not returned. */
  outputsTruncated: number;
  subagentsTruncated: number;
}

export interface SessionInfo {
  sessionUuid: string;
  context: SessionContextInfo;
  compaction: SessionCompactionInfo;
  outputs: SessionOutputFile[];
  remoteControl: SessionRemoteControl;
  subagents: SessionSubagent[];
  scan: SessionInfoScan;
}
