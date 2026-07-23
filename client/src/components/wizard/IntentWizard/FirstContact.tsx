/*
 * FirstContact — the dedicated first-run hero (iterate-2026-07-23-first-contact-
 * hero, FR-01.51 delta). The first screen a brand-new user sees right after
 * `npx @svenroth-ai/shipwright@latest` installs and opens the browser: the
 * lighthouse hero + the welcome promise, framing the SAME three doors + readiness
 * gate the wizard uses (via the shared <DoorGrid>). The three doors deep-link into
 * the wizard flow; the register-manually line comes for free from DoorGrid.
 *
 * The lighthouse image + left-weighted scrim are painted by the scene backdrop
 * (SceneBackdrop BACKDROPS['first-contact']) — First Contact is exempt from the
 * deck-golden signature backdrop. This component paints only the hero COPY over
 * it, so there is no second image fetch.
 *
 * Rule 1 (webui spawns no Claude): a door only NAVIGATES. Static by design — no
 * entrance motion — so under prefers-reduced-motion the hero already renders its
 * complete, opaque final state (CLAUDE.md A20).
 */

import { useNavigate } from "react-router-dom";

import { DoorGrid } from "./DoorGrid";
import { useReadiness } from "./useReadiness";
import { DOORS } from "./stubData";
import type { WizardDoor } from "./types";
import "./intent-wizard.css";
import "./intent-wizard-panels.css";
import "./first-contact.css";

/** Deep-link route for a door (Build new → /wizard, Adopt → /wizard/adopt,
 *  Grade → /wizard/grade). */
function doorRoute(id: WizardDoor): string {
  return DOORS.find((d) => d.id === id)?.route ?? "/wizard";
}

export default function FirstContact() {
  const readiness = useReadiness();
  const navigate = useNavigate();

  return (
    <div className="fc-hero" data-testid="first-contact">
      <div className="fc-in">
        <div className="fc-eyebrow">Welcome to the Command Center</div>
        <h1 className="fc-h1">
          Say what you want.
          <br />
          A competent room takes it from here.
        </h1>
        <p className="fc-lead">
          You describe the change in normal words. Shipwright plans it, explains what it’s doing
          and why, and only asks when it genuinely needs you. You keep control — and the proof.
        </p>
        <DoorGrid readiness={readiness} onPickDoor={(d) => navigate(doorRoute(d))} />
      </div>
    </div>
  );
}
