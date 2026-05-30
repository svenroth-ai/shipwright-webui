/*
 * iterate iterate-20260430-actions-upload-ui (FR-01.27).
 *
 * Per-project Actions JSON management surface in Settings. Lists every
 * registered (non-synthesized) project as a row showing:
 *   - state badge: Custom / Bundled / Malformed
 *   - file picker → POST /api/projects/:id/actions-upload
 *   - reset button → DELETE /api/projects/:id/actions-upload
 *
 * Validation is server-side only; the client just reads the file as text
 * and posts it. Structured error codes from the server are rendered in
 * an inline error banner per row (role="alert").
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Project } from "../../types";
import { readFileAsText } from "../../lib/readFile";
import { formatUploadError } from "../../lib/actionsUpload";
import {
  useProjectActions,
  useResetActionsJson,
  useUploadActionsJson,
} from "../../hooks/useProjectActions";

const MAX_UPLOAD_BYTES = 256 * 1024;

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

function ActionsConfigRow({ project }: { project: Project }) {
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

/**
 * Reset confirmation modal. Uses Radix to match the rest of the WebUI
 * (see `external/ConfirmDeleteDialog.tsx`) instead of `window.confirm`,
 * which doesn't render in the WebUI palette and is awkward to test.
 */
function ResetActionsDialog({
  open,
  onOpenChange,
  projectName,
  onConfirm,
  testIdSuffix,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  onConfirm: () => void;
  testIdSuffix: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          data-testid={`actions-config-reset-confirm-${testIdSuffix}`}
          className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 p-4 shadow-xl"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-card-hover)",
          }}
        >
          <Dialog.Title className="text-base font-semibold text-neutral-900">
            Reset actions.json?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-700">
            Remove <span className="font-mono text-xs">.shipwright-webui/actions.json</span>{" "}
            from <span className="font-medium">{projectName}</span>? The project
            will fall back to the bundled default. The file on disk will be
            deleted.
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="bg-white px-3 py-1 text-sm text-neutral-800 hover:bg-neutral-50"
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-button)",
                }}
                data-testid={`actions-config-reset-cancel-${testIdSuffix}`}
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              className="bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
              style={{ borderRadius: "var(--radius-button)" }}
              data-testid={`actions-config-reset-confirm-button-${testIdSuffix}`}
            >
              Reset
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

const inlineCodeStyle: React.CSSProperties = {
  background: "var(--color-muted-bg)",
  borderRadius: "4px",
  padding: "1px 6px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: "12px",
};

