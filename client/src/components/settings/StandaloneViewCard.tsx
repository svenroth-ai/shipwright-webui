/*
 * Settings card — "Standalone view" (iterate-2026-10-30-hide-shipwright-views).
 * Per-browser switch that hides the pages that only make sense for Shipwright
 * projects. It does NOT change what the webui writes to a repo; that is the
 * per-project "Standalone" flag in the project's settings.
 */
import { useStandaloneView, setStandaloneViewEnabled } from "../../lib/standaloneView";

export function StandaloneViewCard() {
  const enabled = useStandaloneView();
  return (
    <section
      className="flex flex-col gap-2"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md, 12px)",
        padding: "20px",
      }}
      data-testid="standalone-view-card"
    >
      <h2 className="text-base font-semibold text-[var(--color-text)]">Standalone view</h2>
      <p className="text-sm text-[var(--color-muted)]">
        Using the Command Center without Shipwright? Turn this on to hide the pages that only
        make sense for Shipwright projects.
      </p>
      <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled}
          onChange={(e) => setStandaloneViewEnabled(e.target.checked)}
          data-testid="standalone-view-toggle"
        />
        <span>Hide Triage and Ship's Log</span>
      </label>
      <ul className="list-disc pl-5 text-xs text-[var(--color-muted)]">
        <li>
          <strong>Triage</strong> — the findings inbox of a Shipwright project disappears from the
          sidebar and the command palette.
        </li>
        <li>
          <strong>Ship's Log</strong> — a project's logbook page is hidden; opening a project takes
          you to the task board, filtered to that project.
        </li>
      </ul>
      <p className="text-xs text-[var(--color-muted)]">
        This only changes what you see, in this browser. To keep a repository untouched, tick
        "Standalone" on the project itself.
      </p>
    </section>
  );
}
