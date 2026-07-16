/*
 * Settings — minimal stub for Plan D'' variant-a.
 *
 * The pre-Plan-D'' SettingsPage managed chat-mode / autonomy / phase-mapping
 * / model selector config. All of those vanish in the external-launch
 * architecture (the user's own Claude client owns them).
 *
 * iterate-2026-06-14-actions-config-ux — the stale "Launcher preferences"
 * stub card was removed (it described a "Copy command launcher" that no
 * longer exists; Launch/Resume auto-execute via the embedded-terminal header
 * CTA, ADR-068-A1). The page now hosts only the actions-config surface.
 *
 * Iterate 3 remediation v2 Phase 0 (2026-04-21) — visual rebuild:
 *   - Sidebar-consistent header (matches InboxPage: 24px/700 title +
 *     muted subtitle, 20px/32px padding, surface bg + bottom border).
 *   - Content wrapped in .page-container (1280 max-width, centered).
 *   - Each settings group is a warm-beige card (surface bg, border,
 *     shadow-sm, 20px padding). No neutral-* / gray-* classes.
 *   - No new CSS tokens introduced — only palette tokens already in
 *     index.css are used.
 *
 * iterate-20260430-actions-upload-ui (FR-01.27) — the static "Configure
 * actions" paragraph is replaced by <ActionsConfigCard />, which lists
 * every registered project with a state badge + file picker + reset.
 */
import { useProjects } from "../hooks/useProjects";
import { ActionsConfigCard } from "../components/settings/ActionsConfigCard";
import { TerminalSettingsCard } from "../components/settings/TerminalSettingsCard";
import { PageHead } from "../components/common/PageHead";

export default function SettingsPage() {
  const { data: projects = [] } = useProjects();
  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "var(--color-bg)" }}
      data-testid="settings-page"
    >
      {/* A05: shared <PageHead> — 92px anthracite bar, uniform across pages. The
          sub-line (13px --muted) reads light on taupe via the .on-photo flip. */}
      <PageHead
        title="Settings"
        sub="Configure preferences in your own Claude client."
        testId="settings-header"
      />

      {/* Body — .page-container centers to 1280px and applies 24px
          horizontal padding. Top padding gives a little breathing room
          under the header. */}
      <div
        className="page-container flex flex-col gap-4"
        style={{ paddingTop: "24px", paddingBottom: "24px" }}
      >
        {/* Terminal preferences (client-local). */}
        <TerminalSettingsCard />
        {/* FR-01.27 — per-project actions.json upload + reset. */}
        <ActionsConfigCard projects={projects} />
      </div>
    </div>
  );
}
