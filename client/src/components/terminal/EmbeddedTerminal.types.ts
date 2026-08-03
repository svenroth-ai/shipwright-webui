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
