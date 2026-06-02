/*
 * idle-reaper.ts — embedded-terminal orphan-GC (attachment-gated idle ceiling).
 * iterate-2026-06-02-terminal-idle-attachment-gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pty for a task must be reaped when it is genuinely ORPHANED so its
 * process tree does not leak — but NOT while a user is still using it. The
 * historical bug (session 42feb775, 2026-06-02): a pty where Claude waited
 * at an interactive AskUserQuestion prompt produced no I/O for 30 min, so
 * `pty-manager`'s pure I/O-silence ceiling reaped it WHILE a WS client was
 * attached and watching. Claude's final, un-persisted turn lived only in
 * the killed process's memory, so `claude --resume` (rebuilds from the
 * JSONL only) lost it.
 *
 * THE GATE
 * --------
 * "Orphan" = idle AND no WS client attached. The grace timer is armed ONLY
 * when `attachCount === 0`. A watching client makes the pty immortal,
 * however long Claude waits. When the last client detaches the grace arms;
 * a re-attach before it elapses disarms it. We deliberately do NOT gate on
 * "Claude alive in the pty" — process-liveness is un-observable from the
 * webui (4 signals falsified; Resume-gate removed in PR #29). Attachment is
 * the only reliable signal.
 *
 * COHESION (ADR-101/103): extracted from the at-ceiling `pty-manager.ts`
 * deep module as a dedicated neutral, timer-seam-injectable, fully
 * unit-testable unit — the same shape as `ws-heartbeat.ts` /
 * `terminal-reset.ts`. `pty-manager` keeps a one-field wire + thin calls.
 */

/**
 * Default detached-grace before an orphaned pty is reaped: 12 h.
 *
 * The 30-min default this replaces was too aggressive for remote/mobile
 * use (leave a session waiting at a prompt, return after a commute → killed
 * + work lost). For a single-user local tool the asymmetry favours a
 * generous value: a lingering pty costs a few processes on your own PC; a
 * premature reap costs lost work. Overridable via
 * `SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS` (resolved in `config.ts`).
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 43_200_000;

export interface IdleReaperOpts {
  /** Grace, in ms, after the last client detaches before the pty is reaped. */
  timeoutMs: number;
  /** Invoked with the taskId when a task's grace elapses. */
  onReap: (taskId: string) => void;
  /** Scheduler seams for deterministic tests. Default to the globals. */
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Per-task idle grace manager. `touch(taskId, attachCount)` is the single
 * entry point: callers invoke it on every lifecycle event that bears on
 * orphan status (attach, detach, pty output, pty input, spawn). The reaper
 * decides arm-vs-disarm from `attachCount` alone, so the gating policy
 * lives in exactly one place.
 */
export class IdleReaper {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly timeoutMs: number;
  private readonly onReap: (taskId: string) => void;
  private readonly setT: NonNullable<IdleReaperOpts["setTimeoutFn"]>;
  private readonly clearT: NonNullable<IdleReaperOpts["clearTimeoutFn"]>;

  constructor(opts: IdleReaperOpts) {
    this.timeoutMs = opts.timeoutMs;
    this.onReap = opts.onReap;
    this.setT = opts.setTimeoutFn ?? setTimeout;
    this.clearT = opts.clearTimeoutFn ?? clearTimeout;
  }

  /**
   * Re-evaluate a task's idle grace.
   *   - `attachCount > 0`  → a client is watching → disarm (never an orphan).
   *   - `attachCount === 0` → arm (or re-arm) the grace; on expiry `onReap`
   *     fires and the timer is forgotten.
   */
  touch(taskId: string, attachCount: number): void {
    this.cancel(taskId);
    // Arm ONLY for exactly 0 attached. A corrupted/negative count (caller
    // bug or race) disarms rather than reaps — the safe direction for a
    // data-loss-averse GC (external review, openai medium).
    if (attachCount !== 0) return;
    const timer = this.setT(() => {
      this.timers.delete(taskId);
      this.onReap(taskId);
    }, this.timeoutMs);
    // Never keep the event loop alive solely for an idle-grace timer.
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(taskId, timer);
  }

  /** Disarm a task's grace (used on cleanup / explicit kill). Idempotent. */
  cancel(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer !== undefined) {
      this.clearT(timer);
      this.timers.delete(taskId);
    }
  }

  /** Whether a grace is currently armed for the task (tests / observability). */
  isArmed(taskId: string): boolean {
    return this.timers.has(taskId);
  }
}
