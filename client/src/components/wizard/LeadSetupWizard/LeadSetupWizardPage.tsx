/*
 * LeadSetupWizardPage — the route host for /org/new-lead (W14). Reuses
 * IntentWizard's CSS files for the shared `.wz`/`wz-*` idiom rather than
 * duplicating them.
 */
import { LeadSetupWizard } from "./LeadSetupWizard";
import "../IntentWizard/intent-wizard.css";
import "../IntentWizard/intent-wizard-panels.css";
import "../IntentWizard/flightplan-mobile.css";

export default function LeadSetupWizardPage() {
  return <LeadSetupWizard />;
}
