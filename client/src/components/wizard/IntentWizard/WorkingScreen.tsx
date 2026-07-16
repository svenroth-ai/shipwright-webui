/*
 * WorkingScreen — step 2, the middle screen that used to be missing (A08). Both
 * new doors do minute-scale work; this screen is real: it lists the actual steps,
 * marks the current one, and — for a remote grade — shows the shallow-clone step
 * (never hide the cost). It states plainly what is NOT happening yet.
 *
 * Motion is garnish, never the signal: the current step is identifiable by
 * WEIGHT + COLOUR (`.iw-step.now`), so under `prefers-reduced-motion` (the spin
 * is disabled in CSS) it is still readable without a spinner.
 */

import { Check, RefreshCw, ChevronRight } from "lucide-react";

import { scanSteps } from "./stubData";
import { StepDots } from "./StepDots";
import type { WizardDoor } from "./types";

export function WorkingScreen({
  door,
  path,
  tick,
}: {
  door: WizardDoor;
  path: string | null;
  tick: number;
}) {
  const grade = door === "grade";
  const steps = scanSteps(door, path);

  return (
    <div className="wz-left wz-block" data-testid="wizard-working">
      <StepDots total={3} current={1} />
      <h2 className="wz-q wz-q-sub">{grade ? "Grading…" : "Reading your repo…"}</h2>
      <div className="wz-hint">
        {grade
          ? "About a minute. It reads the whole history — that is what makes the grade honest rather than a guess."
          : "About a minute. I read everything BEFORE I write anything — that is the whole point of adopting."}
      </div>
      <div
        data-testid="wizard-working-stub-note"
        className="iw-card pad"
        style={{ maxWidth: 620, marginBottom: 12, borderColor: "var(--warn-line)", background: "var(--warn-tint)" }}
      >
        <span style={{ fontSize: 12.5, color: "var(--ink)" }}>
          Sample walk-through — not a live read of your repo yet. A09 wires the real{" "}
          {grade ? "/shipwright-grade" : "/shipwright-adopt"} scan; these are the steps it will run.
        </span>
      </div>
      <div className="iw-card pad" style={{ maxWidth: 620 }}>
        {steps.map((s, i) => {
          const done = i < tick;
          const now = i === tick;
          const cls = now ? "iw-step now" : done ? "iw-step done" : "iw-step todo";
          return (
            <div className={cls} key={s} data-testid={now ? "wizard-step-current" : undefined}>
              {done ? (
                <Check size={14} style={{ color: "var(--ok-solid)" }} />
              ) : now ? (
                <RefreshCw className="iw-spin" size={14} style={{ color: "var(--accent)" }} />
              ) : (
                <ChevronRight size={14} style={{ color: "var(--faint)" }} />
              )}
              <span>{s}</span>
            </div>
          );
        })}
      </div>
      <div className="caption" style={{ marginTop: 12, maxWidth: 620, fontSize: 12, color: "var(--muted)" }}>
        {grade
          ? "Nothing is written. Nothing is uploaded. You can close this and come back."
          : "Nothing has been written yet — you will see exactly what it wants to write, and approve it."}
      </div>
    </div>
  );
}
