/*
 * TriageAmendForm.tsx — inline Edit (Amend) form for the Triage Detail
 * modal (iterate-2026-08-08-triage-amend-reader, AC7-AC9). Toggled by a
 * pencil icon-button in the modal header (see TriageDetailModal); swaps
 * the title/severity/detail READ display for this form in place.
 *
 * Delta-only: only the fields the operator actually changed are sent
 * (`buildDelta`) — an untouched field is omitted from the request body,
 * mirroring the server's `amend` event semantics (never a full rewrite).
 * `buildDelta` diffs against `initialItem`, a snapshot frozen at MOUNT
 * (`useState(item)`'s initializer runs once) — never the live `item` prop.
 * `item` keeps refreshing via `useTriageDisplayItem`'s poll while this form
 * is open; diffing against it would compare a stale local field (seeded once)
 * to a value that moved underneath the operator, silently re-sending an
 * untouched field as a revert of whatever changed it in the meantime
 * (doubt-review finding, iterate-2026-08-08-triage-amend-reader).
 *
 * AC9: when the write would land on the TRACKED store (HEAD is not the
 * project's default branch), the disclosure banner shows BEFORE the
 * operator can submit — `writesRouteToOutbox` is undefined (unknown,
 * degraded read / older server) or `false` both trigger it; only an
 * explicit `true` suppresses it.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { TriageItem, TriageSeverity } from "../../lib/triageApi";
import { useAmendTriageItem } from "../../hooks/useTriage";

const SEVERITY_VALUES: TriageSeverity[] = ["critical", "high", "medium", "low", "info"];

interface TriageAmendFormProps {
  projectId: string;
  item: TriageItem;
  /** From the origin drift signal — see TriageOrigin.writesRouteToOutbox. */
  writesRouteToOutbox: boolean | undefined;
  onCancel: () => void;
  onSaved: () => void;
}

interface AmendDelta {
  title?: string;
  detail?: string;
  severity?: TriageSeverity;
}

function buildDelta(
  item: TriageItem,
  title: string,
  detail: string,
  severity: TriageSeverity,
): AmendDelta {
  const delta: AmendDelta = {};
  if (title !== item.title) delta.title = title.trim();
  if (detail !== item.detail) delta.detail = detail;
  if (severity !== item.severity) delta.severity = severity;
  return delta;
}

export function TriageAmendForm({
  projectId,
  item,
  writesRouteToOutbox,
  onCancel,
  onSaved,
}: TriageAmendFormProps) {
  const amend = useAmendTriageItem(projectId);
  const [initialItem] = useState(item);
  const [title, setTitle] = useState(item.title);
  const [detail, setDetail] = useState(item.detail);
  const [severity, setSeverity] = useState<TriageSeverity>(item.severity);
  const [error, setError] = useState<string | null>(null);

  const discloseTrackedWrite = writesRouteToOutbox !== true;

  const onSave = async () => {
    setError(null);
    const delta = buildDelta(initialItem, title, detail, severity);
    if (Object.keys(delta).length === 0) {
      // Nothing actually changed — Save behaves like Cancel rather than
      // round-tripping a contentless amend the server would 400 on.
      onCancel();
      return;
    }
    try {
      const result = await amend.mutateAsync({ triageId: item.id, ...delta });
      if (!result.ok) {
        const body = result.body as { error?: string; message?: string };
        setError(body.message || `Save failed (${result.status}): ${body.error}`);
        return;
      }
      onSaved();
    } catch (err) {
      // Transport failure (server restarted mid-click / non-JSON body):
      // amendTriageItem's discriminated result only covers HTTP errors, so a
      // rejected fetch must be surfaced inline rather than becoming an
      // unhandled rejection that leaves the form open with no feedback
      // (external code-review finding, iterate-2026-08-08-triage-amend-reader
      // — same pattern as TriageDetailModal's onStartCampaign).
      setError(`Save failed — could not reach the server. ${String(err).slice(0, 120)}`);
    }
  };

  return (
    <div className="space-y-3" data-testid="triage-amend-form">
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-text)]">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full px-2 py-1.5 text-sm border border-[var(--color-border)] rounded"
          data-testid="triage-amend-title"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-text)]">Severity</span>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as TriageSeverity)}
          className="mt-1 w-full px-2 py-1.5 text-sm border border-[var(--color-border)] rounded bg-[var(--color-surface)]"
          data-testid="triage-amend-severity"
        >
          {SEVERITY_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-[var(--color-text)]">Detail</span>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={4}
          className="mt-1 w-full px-2 py-1.5 text-sm border border-[var(--color-border)] rounded whitespace-pre-wrap"
          data-testid="triage-amend-detail"
        />
      </label>

      {discloseTrackedWrite && (
        <div
          className="p-2 text-xs text-[var(--color-text)] bg-[var(--color-muted-bg)] border border-[var(--color-border)] rounded"
          data-testid="triage-amend-tracked-disclosure"
        >
          This edit will be written straight to the project's tracked triage
          log (not the delivery outbox), because the checkout isn't currently
          on the default branch. It will show up as an uncommitted file
          change.
        </div>
      )}
      {error && (
        <div
          className="p-2 text-xs text-err bg-err-tint border border-[var(--err-line)] rounded"
          data-testid="triage-amend-error"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={amend.isPending}
          className="h-9 px-4 text-sm font-medium rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-muted-bg)] transition-colors disabled:opacity-50"
          data-testid="triage-amend-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={amend.isPending || !title.trim()}
          className="h-9 px-4 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          data-testid="triage-amend-save"
        >
          {amend.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}
