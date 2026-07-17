/*
 * GraduationCard — the dismissable proof line under the Ship's-Log promptbox
 * (A16, FR-01.60): "Baseline set <date> — small changes now take minutes."
 *
 * Honesty: rendered ONLY when a REAL baseline date exists (the project's first
 * recorded run). No date → no card (never a fabricated "Baseline set —"). The
 * dismissal persists per-project via localStorage, so a user who closes it on
 * one project still sees it on another.
 */

import { Check, X } from "lucide-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";

const DISMISS_KEY = (projectId: string) => `webui.shipslog.grad-dismissed.${projectId}`;

/** ISO/date string → "Jul 12, 2026"; returns null for an unparseable input. */
function fmtBaselineDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function GraduationCard({
  projectId,
  date,
}: {
  projectId: string;
  /** The baseline date (the earliest recorded run's ts), or null when unknown. */
  date: string | null;
}) {
  const [dismissed, setDismissed] = useLocalStorage<boolean>(DISMISS_KEY(projectId), false);
  const label = date ? fmtBaselineDate(date) : null;
  if (!label || dismissed) return null;

  return (
    <div className="sl-grad" data-testid="shipslog-graduation">
      <Check size={14} style={{ color: "var(--ok)" }} aria-hidden="true" />
      <span>Baseline set {label} — small changes now take minutes.</span>
      <button
        type="button"
        className="sl-grad-x"
        aria-label="Dismiss"
        data-testid="shipslog-graduation-dismiss"
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
