/*
 * wsReadyEnvelope — defensive parse of the terminal WS `ready` envelope.
 *
 * Extracted from `useTerminalSocket.ts` (iterate-2026-07-21-mac-sleep-terminal-
 * frozen) so the field-by-field back-compat rules are one pure, directly
 * testable function rather than 50 lines inlined in a message listener — and to
 * keep the hook under its anti-ratchet ceiling. ZERO React imports.
 *
 * Every field is optional on the wire: older servers omit the newer ones, so
 * each has an explicit fallback rather than propagating `undefined` into state.
 */

export type TerminalRole = "writer" | "reader";

export interface TerminalReadyInfo {
  role: TerminalRole;
  shellKind: "pwsh" | "cmd" | "posix";
  cwd: string;
  /**
   * Iterate v0.8.2 AC-7 — server bypassed pty spawn because the task is
   * in a terminal state (`done` / `launch_failed`). UI should render a
   * "Session ended" banner instead of an input cursor; the server will
   * close the WS after the replay envelopes.
   */
  replayOnly: boolean;
  /**
   * Iterate v0.8.2 AC-8 — total persisted scrollback bytes for this
   * task. 0 when the store is disabled or the task has never written
   * scrollback. Disclosure footer renders only when > 0.
   */
  scrollbackBytes: number;
  /**
   * Iterate v0.8.2 AC-9 — retention TTL surfaced for the disclosure
   * footer copy.
   */
  retentionDays: number;
  /**
   * Iterate v0.8.2 AC-9 — resolved scrollback dir for the disclosure
   * footer copy.
   */
  scrollbackDir: string;
}

export interface ParsedReadyEnvelope {
  /** Undefined when the server sent no recognised role (leave prior value). */
  role?: TerminalRole;
  /** Undefined when the server sent no recognised shell kind. */
  shellKind?: TerminalReadyInfo["shellKind"];
  /** Defaults to false — matches pre-v0.8.2 server behaviour. */
  replayOnly: boolean;
  /** Null when absent/invalid so the page layer can opt out cleanly. */
  scrollbackBytes: number | null;
  retentionDays: number | null;
  scrollbackDir: string | null;
  /** ADR-104 reset-banner signal; false when an older server omits it. */
  terminalReset: boolean;
  /** Reused-pty signal for the one-shot inject guard; false when omitted. */
  ptyReused: boolean;
}

export function parseReadyEnvelope(
  env: Record<string, unknown>,
): ParsedReadyEnvelope {
  const role =
    env.role === "writer" || env.role === "reader" ? env.role : undefined;
  const shellKind =
    env.shellKind === "pwsh" || env.shellKind === "cmd" || env.shellKind === "posix"
      ? env.shellKind
      : undefined;
  return {
    role,
    shellKind,
    replayOnly: typeof env.replayOnly === "boolean" ? env.replayOnly : false,
    scrollbackBytes:
      typeof env.scrollbackBytes === "number" && env.scrollbackBytes >= 0
        ? env.scrollbackBytes
        : null,
    retentionDays:
      typeof env.retentionDays === "number" && env.retentionDays > 0
        ? env.retentionDays
        : null,
    scrollbackDir:
      typeof env.scrollbackDir === "string" && env.scrollbackDir.length > 0
        ? env.scrollbackDir
        : null,
    terminalReset:
      typeof env.terminalReset === "boolean" ? env.terminalReset : false,
    ptyReused: typeof env.ptyReused === "boolean" ? env.ptyReused : false,
  };
}
