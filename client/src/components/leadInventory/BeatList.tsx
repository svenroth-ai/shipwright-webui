/*
 * BeatList — one lead's last-night beats, each with its ordered steps
 * (iterate-2026-09-08-lead-inventory-page, AC-1/AC-2a/AC-2b/AC-7/AC-8/AC-10).
 *
 * The server bounds `beats` to a cheap 48h window (Internal Plan Review
 * finding #3); this component narrows further to the exact "last night"
 * window (`computeLastNightWindow`, the same preset the Activity timeline
 * already uses) client-side, matching that existing "fetch fresh, filter
 * client-side, no stored cursor" pattern. A beat whose `startedAt` fails to
 * parse is INCLUDED rather than dropped by this filter (AC-7 — fail toward
 * showing more).
 *
 * `totalBeatsInRegister` (AC-8) is what lets the two empty states differ:
 * "this lead has never had a beat" vs. "has history, nothing in this
 * window" — collapsing them would be a silent lie either way.
 */

import type { BeatInventoryView, RegisterView } from "../../lib/leadInventoryApi";
import { computeLastNightWindow } from "../../lib/auditTimelineMerge";
import { BandChip } from "./BandChip";

function formatClockTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function withinWindow(startedAt: string, sinceMs: number, untilMs: number): boolean {
  const ms = Date.parse(startedAt);
  if (!Number.isFinite(ms)) return true;
  return ms >= sinceMs && ms <= untilMs;
}

function StepsBlock({ beat }: { beat: BeatInventoryView }) {
  const { steps } = beat;
  if (steps.status === "unreadable" || (steps.status === "ok" && steps.steps.length === 0 && steps.unreadableLines > 0)) {
    return (
      <p data-testid={`beat-steps-unavailable-${beat.beatId}`} className="text-[12px] italic text-[var(--color-muted)]">
        Steps unavailable
      </p>
    );
  }
  if (steps.status === "ok" && steps.steps.length === 0) {
    return (
      <p data-testid={`beat-steps-none-${beat.beatId}`} className="text-[12px] italic text-[var(--color-muted)]">
        No steps reported
      </p>
    );
  }
  if (steps.status !== "ok") return null;
  return (
    <>
      <ol data-testid={`beat-steps-${beat.beatId}`} className="flex flex-col gap-1">
        {steps.steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            <BandChip band={step.band} />
            <span className="text-[var(--color-text)]">{step.summary}</span>
          </li>
        ))}
      </ol>
      {steps.unreadableLines > 0 && (
        <p data-testid={`beat-steps-partial-${beat.beatId}`} className="text-[11px] italic text-[var(--color-muted)]">
          +{steps.unreadableLines} unreadable line{steps.unreadableLines === 1 ? "" : "s"}
        </p>
      )}
    </>
  );
}

function BeatCard({ beat }: { beat: BeatInventoryView }) {
  const inProgress = beat.closedAt === null;
  return (
    <li
      data-testid={`beat-card-${beat.beatId}`}
      className="flex flex-col gap-2 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="flex items-center gap-2 text-[12px] text-[var(--color-muted)]">
        <span>{formatClockTime(beat.startedAt)}</span>
        {inProgress && (
          <span data-testid={`beat-in-progress-${beat.beatId}`} className="font-medium text-[var(--color-info)]">
            in progress
          </span>
        )}
      </div>
      {beat.unclaimedEffect.status === "found" && (
        <div
          data-testid="unclaimed-effect-warning"
          role="alert"
          className="rounded-[8px] bg-[var(--color-warning-bg)] px-2 py-1.5 text-[12px] font-medium text-[var(--color-warning)]"
        >
          This beat produced an effect no step accounts for — needs a look.
        </div>
      )}
      {beat.unclaimedEffect.status === "unknown" && (
        <p
          data-testid={`unclaimed-effect-unknown-${beat.beatId}`}
          className="text-[12px] italic text-[var(--color-muted)]"
        >
          Effect check unavailable — could not confirm this beat is clear.
        </p>
      )}
      <StepsBlock beat={beat} />
    </li>
  );
}

export interface BeatListProps {
  beats: BeatInventoryView[];
  totalBeatsInRegister: number;
  /** Defaults to `{status:"ok"}` — callers predating this field (existing
   *  tests) keep working, but a real "unreadable" register must win over
   *  either empty state below (a corrupt register must never read as "this
   *  lead has simply never had a beat" — code review, Stage 2/high). */
  register?: RegisterView;
  now?: Date;
}

export function BeatList({ beats, totalBeatsInRegister, register = { status: "ok" }, now }: BeatListProps) {
  const { sinceMs, untilMs } = computeLastNightWindow(now ?? new Date());
  const windowed = beats.filter((b) => withinWindow(b.startedAt, sinceMs, untilMs));

  if (register.status === "unreadable") {
    return (
      <p data-testid="beat-list-empty-unreadable" role="alert" className="text-[13px] text-[var(--color-error)]">
        Could not read this lead's beat history — try again shortly.
      </p>
    );
  }

  if (windowed.length === 0) {
    if (totalBeatsInRegister === 0) {
      return (
        <p data-testid="beat-list-empty-never" className="text-[13px] text-[var(--color-muted)]">
          No beats yet
        </p>
      );
    }
    const since = new Date(sinceMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const until = new Date(untilMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return (
      <p data-testid="beat-list-empty-window" className="text-[13px] text-[var(--color-muted)]">
        No beats between {since} and {until}
      </p>
    );
  }

  return (
    <ol data-testid="beat-list" className="flex flex-col gap-2">
      {windowed.map((beat) => (
        <BeatCard key={beat.beatId} beat={beat} />
      ))}
    </ol>
  );
}
