/*
 * DoorGrid — the shared First-Contact door primitive: the three canonical doors
 * (Build new · Adopt · Grade), the "Register a project manually…" escape hatch,
 * and the readiness GATE. Extracted verbatim from DoorPicker so the wizard's
 * step-0 picker (DoorPicker) and the First Contact hero (FirstContact) render the
 * IDENTICAL doors + gate from ONE source — no duplicated door list or readiness
 * copy (iterate-2026-07-23-first-contact-hero).
 *
 * Returns a Fragment: the two consumers own their own heading / hero chrome and
 * layout wrapper. `onPickDoor` is the seam — the wizard dispatches into its
 * reducer; First Contact navigates to the door's wizard route. Neither spawns
 * Claude (CLAUDE.md rule 1): a door only navigates.
 *
 * Readiness is real: when the environment is not ready the doors are INERT (a
 * disabled <button>, aria-disabled) — not merely styled dim. A door that opens
 * into a broken run is worse than a closed one.
 */

import { Sparkles, Wrench, Target, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { DOORS, type DoorDef } from "./stubData";
import { ReadinessGate } from "./ReadinessGate";
import type { ReadinessState } from "./useReadiness";
import type { WizardDoor } from "./types";

const ICONS = { sparkles: Sparkles, wrench: Wrench, target: Target } as const;

export function DoorGrid({
  readiness,
  onPickDoor,
}: {
  readiness: ReadinessState;
  onPickDoor: (door: WizardDoor) => void;
}) {
  const navigate = useNavigate();
  const ready = readiness.ready;

  return (
    <>
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
          adopting it would re-adopt an adopted repo. Quiet line, not a 4th door.
          Permanent escape hatch (iterate-2026-07-23-intent-launcher-front-door):
          opens the expert ProjectWizard via /projects?new=1 — the same target
          every "Register a project manually…" menu item uses — so the wizard is
          the single, always-complete project-creation hub. */}
      <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--muted)" }}>
        Already set up with Shipwright?{" "}
        <button
          type="button"
          data-testid="wizard-add-existing"
          onClick={() => navigate("/projects?new=1")}
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
          Register a project manually…
        </button>{" "}
        — no adopting needed.
      </div>

      {ready ? null : <ReadinessGate state={readiness} />}
    </>
  );
}
