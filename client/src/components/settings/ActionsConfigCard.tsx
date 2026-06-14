/*
 * iterate iterate-20260430-actions-upload-ui (FR-01.27).
 *
 * Per-project Actions JSON management surface in Settings. Lists every
 * registered (non-synthesized) project as a row (see ActionsConfigRow)
 * showing a state badge (Custom / Bundled / Malformed) + Upload .json +
 * Reset.
 *
 * iterate-2026-06-14-actions-config-ux — the per-project row was extracted
 * into `./ActionsConfigRow` so the project edit modal (ProjectSettingsDialog)
 * can reuse the same surface. This card now just renders the multi-project
 * list; the row owns all upload/reset behavior + validation banners.
 */

import type { Project } from "../../types";
import { ActionsConfigRow } from "./ActionsConfigRow";

export interface ActionsConfigCardProps {
  projects: Project[];
}

export function ActionsConfigCard({ projects }: ActionsConfigCardProps) {
  const realProjects = projects.filter((p) => !p.synthesized && p.path);

  return (
    <section
      className="flex flex-col gap-2"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
        padding: "20px",
      }}
      data-testid="settings-configure-actions"
    >
      <h2
        className="font-semibold"
        style={{ fontSize: "15px", color: "var(--color-text)", margin: 0 }}
      >
        Configure actions
      </h2>
      <p
        style={{
          fontSize: "13px",
          color: "var(--color-muted)",
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        Replace each project&rsquo;s <code style={inlineCodeStyle}>.shipwright-webui/actions.json</code>{" "}
        to customize the <code style={inlineCodeStyle}>+ New ▾</code> dropdown,
        phase allowlist, and preview gate. Files are validated against the
        actions schema before they overwrite anything on disk.
      </p>

      {realProjects.length === 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "var(--color-muted)",
            fontStyle: "italic",
            margin: "8px 0 0 0",
          }}
        >
          Register a project on the Projects page to configure its actions.
        </p>
      ) : (
        <div className="flex flex-col" style={{ marginTop: "8px", gap: "12px" }}>
          {realProjects.map((p) => (
            <ActionsConfigRow key={p.id} project={p} />
          ))}
        </div>
      )}
    </section>
  );
}

const inlineCodeStyle: React.CSSProperties = {
  background: "var(--color-muted-bg)",
  borderRadius: "4px",
  padding: "1px 6px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: "12px",
};
