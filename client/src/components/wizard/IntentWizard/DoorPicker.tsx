/*
 * DoorPicker — step 0 of the wizard (A08). The three canonical First-Contact
 * doors, the "add existing project" line (registration, not a 4th door), and
 * the readiness GATE.
 *
 * Readiness is real: when the environment is not ready the doors are INERT (a
 * disabled <button>, pointer-events none, aria-disabled) — not merely styled
 * dim. A door that opens into a broken run is worse than a closed one.
 */

import { Sparkles, Wrench, Target, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { DOORS, type DoorDef } from "./stubData";
import { StepDots } from "./StepDots";
import { ReadinessGate } from "./ReadinessGate";
import type { ReadinessState } from "./useReadiness";
import type { WizardDoor } from "./types";

const ICONS = { sparkles: Sparkles, wrench: Wrench, target: Target } as const;

export function DoorPicker({
  readiness,
  onPickDoor,
}: {
  readiness: ReadinessState;
  onPickDoor: (door: WizardDoor) => void;
}) {
  const navigate = useNavigate();
  const ready = readiness.ready;

  return (
    <div className="wz-left" data-testid="wizard-door-picker">
      <div style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
        <StepDots total={5} current={0} />
        <h1 className="wz-q">What do you want to do?</h1>
        <div className="wz-hint">One question per screen. Plain words. Smart defaults already picked.</div>
        <div className="wz-opts">
          {DOORS.map((d: DoorDef) => {
            const Icon = ICONS[d.icon];
            return (
              <button
                type="button"
                key={d.id}
                className="wz-opt"
                data-testid={`wizard-door-${d.id}`}
                disabled={!ready}
                aria-disabled={!ready}
                onClick={() => ready && onPickDoor(d.id)}
              >
                <span className="iw-ic">
                  <Icon size={26} />
                </span>
                <div>
                  <div className="ol">{d.label}</div>
                  <div className="od">{d.desc}</div>
                </div>
                <span style={{ marginLeft: "auto", color: "var(--faint)", alignSelf: "center" }}>
                  <ChevronRight size={18} />
                </span>
              </button>
            );
          })}
        </div>

        {/* A repo that ALREADY uses Shipwright is REGISTERED, not adopted —
            adopting it would re-adopt an adopted repo. Quiet line, not a 4th door. */}
        <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--muted)" }}>
          Already set up with Shipwright?{" "}
          <button
            type="button"
            data-testid="wizard-add-existing"
            onClick={() => navigate("/projects")}
            style={{
              color: "var(--accent-deep)",
              textDecoration: "underline",
              cursor: "pointer",
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
            }}
          >
            Add the existing project
          </button>{" "}
          — no adopting needed.
        </div>

        {ready ? null : <ReadinessGate state={readiness} />}
      </div>
    </div>
  );
}
