/*
 * IntentWizardPage — the route host for /wizard, /wizard/adopt, /wizard/grade
 * (A08). The deep-link segment picks the entry door: /wizard → picker,
 * /wizard/adopt|grade → land INSIDE that door's flow at step 1 (AC4).
 *
 * `key={pathname}` remounts the wizard on a route change so a deep-link entry
 * always starts from the right, fresh state. Renders as the flex child of the
 * scene-fore, so the `.wz` grid fills the backdrop.
 */

import { useLocation, useParams } from "react-router-dom";

import { IntentWizard } from "./IntentWizard";
import type { WizardDoor } from "./types";
import "./intent-wizard.css";
import "./intent-wizard-panels.css";

function doorFromParam(seg: string | undefined): WizardDoor | null {
  if (seg === "adopt") return "adopt";
  if (seg === "grade") return "grade";
  return null;
}

export default function IntentWizardPage() {
  const { door } = useParams();
  const { pathname } = useLocation();
  return <IntentWizard key={pathname} initialDoor={doorFromParam(door)} />;
}
