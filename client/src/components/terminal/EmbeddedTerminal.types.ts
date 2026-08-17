import type {
  BackpressureInfo,
  TerminalRole,
} from "../../hooks/useTerminalSocket";

export interface EmbeddedTerminalHandle {
  focus(): void;
  ready: boolean;
  role: TerminalRole | null;
}

export interface EmbeddedTerminalProps {
  taskId: string;
  active: boolean;
  /**
   * The task's lifecycle state (iterate-2026-08-16-task-lifecycle-ux-fixes).
   * Optional so every existing/test call site keeps compiling; omitted, the
   * guard below is simply inert. Used SOLELY to detect a `done` → non-`done`
   * transition (a Re-open) and re-arm the one-shot auto-inject guard in
   * `useAutoLaunch` — the same re-arm `terminalReset` (ADR-104) already
   * performs for a server restart. Without this, EmbeddedTerminal has NO
   * visibility into the task's lifecycle at all (it only ever received
   * `taskId` + `active`), so a Reopen — which the server correctly flips
   * `state: done -> draft` for (see routes.ts `/reopen`) — never reaches
   * the terminal pane; the guard stays armed from whatever it last observed
   * (a real prior session very likely DID write to this pty before it was
   * closed) and the next Resume silently falls back to manual "Send to
   * terminal", indistinguishable from Resume doing nothing until a full
   * page reload remounts the component and resets every ref.
   */
  taskState?: string;
  layoutRevision?: string | number;
  socketUrlOverride?: string;
  socketEnabled?: boolean;
  onGitignoreSuggestion?: () => void;
  onBackpressure?: (info: BackpressureInfo) => void;
  onReadyChange?: (ready: boolean, role: TerminalRole | null) => void;
  onPasteImageError?: (detail: string) => void;
  onTerminalMeta?: (meta: {
    replayOnly: boolean | null;
    scrollbackBytes: number | null;
    retentionDays: number | null;
    scrollbackDir: string | null;
  }) => void;
}
