/*
 * resumeCtaGate — shared Resume-CTA activity gate
 * (iterate-20260515-resume-cta-jsonl-signal, ADR-102).
 *
 * Decides whether the Resume CTA should be HIDDEN because Claude (or
 * another foreground process) is plausibly still active on the task.
 * Consumed by BOTH `TaskDetailHeader.ctaFor()` and the `TaskCard` action
 * matrix — a standalone module so neither surface cross-imports the
 * other (resolves Iterate M internal-review finding M-2).
 *
 * History of the signal:
 *   - Iterate L (ADR-095/096 fork) gated on `altScreenActive` — falsified
 *     by ADR-098: with `CLAUDE_CODE_NO_FLICKER=1` default-on Claude
 *     renders in the MAIN buffer, so `altScreenActive` stays false during
 *     active streaming.
 *   - Iterate M (ADR-100) gated on `lastPtyDataAt` — falsified again:
 *     `lastPtyDataAt` is bumped only in the webui EMBEDDED terminal's
 *     `pty.onData`. In the Plan-D'' default Claude runs in the user's
 *     OWN terminal; webui hosts no Claude pty, so `lastPtyDataAt` is
 *     `null` for every externally-launched task → the gate failed open →
 *     Resume showed for every active task (Sven UAT 2026-05-15; live
 *     `GET /api/external/tasks` curl confirmed `lastPtyDataAt: null` on
 *     all tasks).
 *   - Iterate N (ADR-102) — PRIMARY signal is `lastJsonlSeenMtimeMs`,
 *     the mtime of `<uuid>.jsonl`. Claude appends to that file as it
 *     works regardless of which terminal hosts it, and webui already
 *     observes the JSONL by architecture (CLAUDE.md rule 2).
 *     `altScreenActive` + `lastPtyDataAt` are kept as supplementary
 *     OR-signals for the embedded-terminal-Claude path.
 */
import type { ExternalTask } from "../../lib/externalApi";

/**
 * JSONL mtime fresher than this ⇒ Claude is plausibly mid-work.
 *
 * 60 s is deliberately generous: JSONL writes are bursty — Claude pauses
 * between events (thinking, awaiting a tool result). The window covers
 * ordinary gaps while still surfacing Resume reasonably fast once Claude
 * exits. Known limitation: a tool call running > 60 s with no JSONL
 * append (a long build / test suite) lets Resume re-appear mid-turn —
 * annoying, not destructive (`claude --resume` on a live session merely
 * errors "Session ID already in use"). A precise "mid-turn" signal would
 * need the server to parse the last JSONL event type — deferred (ADR-102).
 */
export const JSONL_RECENT_ACTIVITY_MS = 60_000;

/**
 * Embedded-pty `onData` fresher than this ⇒ a foreground process is
 * engaged in the webui embedded terminal. Tighter than the JSONL window
 * because pty output is continuous while a process renders.
 */
export const PTY_RECENT_ACTIVITY_MS = 15_000;

/** The subset of `ExternalTask` the gate reads. */
export type ResumeGateFields = Pick<
  ExternalTask,
  "altScreenActive" | "lastPtyDataAt" | "lastJsonlSeenMtimeMs"
>;

/**
 * Returns `true` when Claude (or another foreground process) is plausibly
 * still active on the task — i.e. the Resume CTA should be HIDDEN.
 *
 * Intentionally does NOT consult `firstJsonlObservedAt` / `liveSession`
 * (both were guards in Iterate M's gate): a never-launched task has no
 * `lastJsonlSeenMtimeMs` and falls through to `false` (→ Resume shown)
 * anyway, so the guards were redundant.
 *
 * `now` is parameterised so tests can pin a deterministic clock; defaults
 * to `Date.now()`.
 */
export function isClaudeRecentlyActive(
  task: ResumeGateFields,
  now: number = Date.now(),
): boolean {
  // PRIMARY — JSONL mtime. The only signal that works in the Plan-D''
  // default (Claude in the user's own terminal; webui hosts no pty).
  // A future mtime (client clock behind the server) yields a negative
  // delta < the window → still counted as active. Conservative.
  if (
    task.lastJsonlSeenMtimeMs != null &&
    now - task.lastJsonlSeenMtimeMs < JSONL_RECENT_ACTIVITY_MS
  ) {
    return true;
  }
  // SECONDARY — embedded-terminal pty signals. Only meaningful when the
  // user launched Claude INTO the webui embedded terminal; harmless
  // (absent) otherwise.
  if (task.altScreenActive === true) return true;
  if (
    task.lastPtyDataAt != null &&
    now - task.lastPtyDataAt < PTY_RECENT_ACTIVITY_MS
  ) {
    return true;
  }
  return false;
}
