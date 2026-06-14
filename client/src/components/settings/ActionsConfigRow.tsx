/*
 * Per-project Actions JSON management row — Upload / Reset / state badge.
 *
 * Extracted from ActionsConfigCard (iterate-2026-06-14-actions-config-ux) so
 * the same surface is reusable in TWO places:
 *   - Settings page (ActionsConfigCard maps every real project)
 *   - Project edit modal (ProjectSettingsDialog renders one project)
 *
 * `hideProjectHeader` drops the project name + path block (the edit modal
 * already shows both) — only the state badge + Upload/Reset controls +
 * inline banners remain.
 *
 * Validation is server-side only; the client reads the file as text and POSTs
 * it. Structured server error codes render in an inline banner (role="alert").
 */

import { useState } from "react";
import type { Project } from "../../types";
import { readFileAsText } from "../../lib/readFile";
import { formatUploadError } from "../../lib/actionsUpload";
import {
  useProjectActions,
  useResetActionsJson,
  useUploadActionsJson,
} from "../../hooks/useProjectActions";
import { ResetActionsDialog } from "./ResetActionsDialog";

const MAX_UPLOAD_BYTES = 256 * 1024;

export interface ActionsConfigRowProps {
  project: Project;
  /**
   * When true, omit the project name + path header (the host already shows
   * them — e.g. the project edit modal). Badge + controls + banners stay.
   */
  hideProjectHeader?: boolean;
}

export function ActionsConfigRow({
  project,
  hideProjectHeader = false,
}: ActionsConfigRowProps) {
  const actionsQuery = useProjectActions(project.id);
  const upload = useUploadActionsJson();
  const reset = useResetActionsJson();
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const fromUser = actionsQuery.data?.fromUser === true;
  const malformed = (actionsQuery.data?.diagnostics ?? []).some(
    (d) => d.code === "actions_file_malformed",
  );
  const sourceState: "custom" | "bundled" | "malformed" = malformed
    ? "malformed"
    : fromUser
      ? "custom"
      : "bundled";

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-selected after an error.
    e.target.value = "";
    if (!file) return;

    setLocalError(null);
    setLocalSuccess(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(
        `File is ${file.size.toLocaleString()} bytes; the limit is ${MAX_UPLOAD_BYTES.toLocaleString()} bytes.`,
      );
      return;
    }

    let text: string;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      setLocalError(`Could not read file: ${String(err).slice(0, 200)}`);
      return;
    }

    try {
      await upload.mutateAsync({ projectId: project.id, jsonContent: text });
      setLocalSuccess(`Uploaded ${file.name}`);
    } catch (err) {
      setLocalError(formatUploadError(err));
    }
  }

  // Reset is enabled when the user file is in use OR malformed — the
  // malformed case is exactly when a user wants to delete the file from
  // the UI without opening a terminal.
  const canReset = fromUser || malformed;

  function handleReset() {
    if (!canReset) return;
    setConfirmResetOpen(true);
  }

  async function handleResetConfirmed() {
    setConfirmResetOpen(false);
    setLocalError(null);
    setLocalSuccess(null);
    try {
      await reset.mutateAsync({ projectId: project.id });
      setLocalSuccess("Reset to bundled default");
    } catch (err) {
      setLocalError(formatUploadError(err));
    }
  }

  return (
    <div
      data-testid={`actions-config-row-${project.id}`}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-button)",
        padding: "12px",
        background: "var(--color-bg)",
      }}
    >
      <div className="flex items-center justify-between" style={{ gap: "12px" }}>
        {hideProjectHeader ? (
          <StateBadge testId={`actions-config-state-${project.id}`} state={sourceState} />
        ) : (
          <div className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center" style={{ gap: "8px" }}>
              <span
                className="font-semibold"
                style={{ fontSize: "13px", color: "var(--color-text)" }}
              >
                {project.name}
              </span>
              <StateBadge testId={`actions-config-state-${project.id}`} state={sourceState} />
            </div>
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-muted)",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={project.path}
            >
              {project.path}
            </span>
          </div>
        )}

        <div className="flex items-center" style={{ gap: "8px" }}>
          <label
            className="inline-flex items-center"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-text)",
              padding: "6px 10px",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-button)",
              cursor: upload.isPending ? "not-allowed" : "pointer",
              background: "var(--color-surface)",
              opacity: upload.isPending ? 0.6 : 1,
            }}
          >
            {upload.isPending ? "Uploading…" : "Upload .json"}
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleFile}
              data-testid={`actions-config-file-${project.id}`}
              disabled={upload.isPending}
              style={{ display: "none" }}
            />
          </label>

          <button
            type="button"
            onClick={handleReset}
            data-testid={`actions-config-reset-${project.id}`}
            disabled={!canReset || reset.isPending}
            title={
              canReset
                ? "Remove .shipwright-webui/actions.json"
                : "Already on bundled default"
            }
            style={{
              fontSize: "12px",
              fontWeight: 600,
              padding: "6px 10px",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-button)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              cursor: !canReset || reset.isPending ? "not-allowed" : "pointer",
              opacity: !canReset || reset.isPending ? 0.5 : 1,
            }}
          >
            {reset.isPending ? "Resetting…" : "Reset to default"}
          </button>
        </div>
      </div>

      {localError && (
        <div
          data-testid={`actions-config-error-${project.id}`}
          role="alert"
          style={{
            marginTop: "8px",
            padding: "8px 10px",
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error)",
            color: "var(--color-error)",
            borderRadius: "var(--radius-button)",
            fontSize: "12px",
          }}
        >
          {localError}
        </div>
      )}
      {!localError && localSuccess && (
        <div
          data-testid={`actions-config-success-${project.id}`}
          role="status"
          style={{
            marginTop: "8px",
            padding: "8px 10px",
            background: "var(--color-success-bg, #e6f6ec)",
            border: "1px solid var(--color-success, #2f9e44)",
            color: "var(--color-success, #2f9e44)",
            borderRadius: "var(--radius-button)",
            fontSize: "12px",
          }}
        >
          {localSuccess}
        </div>
      )}

      <ResetActionsDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        projectName={project.name}
        onConfirm={handleResetConfirmed}
        testIdSuffix={project.id}
      />
    </div>
  );
}

function StateBadge({
  state,
  testId,
}: {
  state: "custom" | "bundled" | "malformed";
  testId: string;
}) {
  const palette: Record<typeof state, { bg: string; fg: string; label: string }> = {
    custom: { bg: "#dcefff", fg: "#0b4f8a", label: "Custom" },
    bundled: { bg: "#eee9df", fg: "#5a4d3b", label: "Bundled" },
    malformed: { bg: "#fde2e2", fg: "#9b1c1c", label: "Malformed" },
  };
  const c = palette[state];
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: "11px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "2px 8px",
        borderRadius: "9999px",
        background: c.bg,
        color: c.fg,
      }}
    >
      {c.label}
    </span>
  );
}
