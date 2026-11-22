/*
 * timer.ts — the reminder-mail check schedule (campaign reminders-webui, W4).
 *
 * A plain interval (CLAUDE.md rule 8: no chokidar, no SSE) that ticks every
 * minute and is cheap: it only decides whether a check is DUE, from the
 * configured interval, so a Settings change applies without a restart. One
 * check runs immediately at start. The clock and the interval functions are
 * injected so tests drive it with a fake clock and never wait.
 */

import { localDay } from "./ledger.js";
import type { CheckInterval } from "./settings.js";

export const TICK_MS = 60_000;
const INTERVAL_MS: Record<Exclude<CheckInterval, "daily">, number> = { "15m": 15 * 60_000, "1h": 60 * 60_000 };

export interface TimerDeps {
  run: () => Promise<unknown>;
  getSchedule: () => { checkInterval: CheckInterval; summaryTime: string };
  now?: () => Date;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (h: unknown) => void;
  log?: (line: Record<string, unknown>) => void;
}

export interface MailTimer {
  /** Resolves when the check at start has finished. */
  started: Promise<void>;
  /** One scheduling decision; resolves once a started check has finished. */
  tick(): Promise<void>;
  stop(): void;
}

export function startReminderMailTimer(deps: TimerDeps): MailTimer {
  const now = deps.now ?? (() => new Date());
  let lastRun: Date | null = null;
  let lastDailyDay: string | null = null;
  let running = false;

  const hhmm = (t: Date): string => `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;

  async function go(): Promise<void> {
    if (running) return;
    running = true;
    const t = now();
    try {
      const out = (await deps.run()) as { ran?: boolean } | undefined;
      // (a check that THREW falls to the catch below and counts as no run: it is tried again next tick)
      // A check that did not run (mail off / not complete) is NOT a run: turning mail on is picked up
      // within a minute, and a start check before the summary time never uses up today's daily slot.
      if (out?.ran !== false) {
        lastRun = t;
        if (hhmm(t) >= deps.getSchedule().summaryTime) lastDailyDay = localDay(t);
      }
    } catch (err) {
      // Never log the error object itself: it could carry transport detail.
      deps.log?.({ level: "warn", message: "reminder mail check failed", code: (err as { code?: unknown })?.code });
    } finally {
      running = false;
    }
  }

  function due(): boolean {
    if (lastRun === null) return true;
    const { checkInterval, summaryTime } = deps.getSchedule();
    const t = now();
    if (checkInterval === "daily") return hhmm(t) >= summaryTime && lastDailyDay !== localDay(t);
    return t.getTime() - lastRun.getTime() >= INTERVAL_MS[checkInterval];
  }

  const tick = async (): Promise<void> => {
    if (due()) await go();
  };

  const handle = (deps.setIntervalFn ?? setInterval)(() => void tick(), TICK_MS);
  (handle as { unref?: () => void } | undefined)?.unref?.();
  const started = go(); // once at start

  return {
    started,
    tick,
    stop: () => (deps.clearIntervalFn ?? ((h) => clearInterval(h as NodeJS.Timeout)))(handle),
  };
}
