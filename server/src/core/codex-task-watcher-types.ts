/*
 * core/codex-task-watcher-types.ts — types, deps interfaces, and tunable
 * defaults for `CodexTaskWatcher` (`codex-task-watcher.ts`). Split out to
 * keep the class file under the 300-line guideline; re-exported verbatim
 * from `codex-task-watcher.ts` so every existing import site is unaffected.
 */

import type { ExternalTask } from "./sdk-sessions-store.js";
import type { OracleOutcome, RunCodexOracleInput } from "./codex-oracle-runner.js";

/** Settings default per §5 (min 5 — Settings enforces the floor, not this module). */
export const DEFAULT_STALL_TIMEOUT_MS = 15 * 60 * 1000;
/** §5.2 launch-confirmation window — distinct from, and shorter than, the
 *  mid-task stall trigger above. */
export const DEFAULT_LAUNCH_CONFIRM_TIMEOUT_MS = 90 * 1000;

export type CodexWatcherNoticeKind =
  | "nudge_sent"
  | "delivery_error"
  | "no_oracle_unresolved"
  | "launch_confirmation_failed";

export interface CodexWatcherNotice {
  taskId: string;
  kind: CodexWatcherNoticeKind;
  detail: string;
  at: number;
}

export interface CodexTaskWatcherStore {
  list(): ExternalTask[];
  patch(taskId: string, patch: Partial<ExternalTask>): ExternalTask | undefined;
  persist(): Promise<void>;
}

export interface CodexTaskWatcherPtyManager {
  getLastDataAt(taskId: string): number | null;
  attachCount(taskId: string): number;
  write(taskId: string, data: string): void;
}

export interface CodexTaskWatcherDeps {
  store: CodexTaskWatcherStore;
  ptyManager: CodexTaskWatcherPtyManager;
  getProjectById: (id: string) => { path: string } | undefined;
  runOracle: (input: RunCodexOracleInput) => Promise<OracleOutcome>;
  /**
   * §4 — best-effort, filename-first discovery of a fresh launch's thread
   * id (`core/codex-thread-discovery.ts`). Optional: omitting it just means
   * no task ever gets a `threadId`, i.e. `resume` never fires (§4's earlier,
   * pre-discovery behavior) — tests that don't care about §4 can skip it.
   */
  discoverThreadId?: (args: {
    cwd: string;
    sinceIso: string;
    excludeThreadIds?: ReadonlySet<string>;
  }) => Promise<string | null>;
  now?: () => number;
  /**
   * Settings-backed (`GlobalSettings.codexStallTimeoutMinutes`) — a plain
   * number OR a (possibly async) getter, so a caller that re-reads
   * settings.json can hand in `async () => (await readSettings())...` and
   * have a live-edited Settings value take effect on the very next tick,
   * without reconstructing the watcher (which would drop in-flight
   * episode/notice state).
   */
  stallTimeoutMs?: number | (() => number | Promise<number>);
  launchConfirmTimeoutMs?: number | (() => number | Promise<number>);
  /**
   * §5.4 — best-effort visible-viewport text for the self-report parser
   * (`codex-status-report.ts`). Optional and best-effort by design, same
   * as `PtyManager.peekTerminalText` itself: `null`/omitted just means no
   * self-report signal is available (headless mirror disabled, no live
   * entry) — the oracle-only classification path is unaffected either way.
   */
  peekTerminalText?: (taskId: string) => string | null;
}

export interface EpisodeState {
  /** The `lastDataAt` value this episode "belongs to" — a newer value
   *  means fresh output arrived, which starts a brand-new episode. */
  lastSeenDataAt: number;
  nudged: boolean;
}
