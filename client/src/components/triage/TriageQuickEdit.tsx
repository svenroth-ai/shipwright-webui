/*
 * TriageQuickEdit — the pencil on a card: change title and severity in
 * place (iterate-2026-11-08-triage-page-redesign, decision D). Priority is
 * shown read-only because the server derives it from severity; domain and
 * complexity cannot be amended yet. Uses the same amend hook as the detail
 * dialog's form, sends only what changed, and is gated by the project's
 * write availability exactly like that form.
 */

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2, Pencil } from "lucide-react";

import { useAmendTriageItem, useTriageDrift } from "../../hooks/useTriage";
import type { TriageItem, TriageSeverity } from "../../lib/triageApi";
import { SEVERITY_VALUES, getComplexity } from "../../lib/triageFilterSort";

interface Props {
  projectId: string;
  item: TriageItem;
}

function Body({ projectId, item, onDone }: Props & { onDone: () => void }) {
  const amend = useAmendTriageItem(projectId);
  const drift = useTriageDrift(projectId);
  const writeDisabled = drift.data?.write?.available === false;
  const writeReason = drift.data?.write?.reason ?? "Triage writing is unavailable.";
  const [initial] = useState(item);
  const [title, setTitle] = useState(item.title);
  const [severity, setSeverity] = useState<TriageSeverity>(item.severity);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const delta: { title?: string; severity?: TriageSeverity } = {};
    if (title !== initial.title) delta.title = title.trim();
    if (severity !== initial.severity) delta.severity = severity;
    if (Object.keys(delta).length === 0) {
      onDone();
      return;
    }
    try {
      const result = await amend.mutateAsync({ triageId: item.id, ...delta });
      if (!result.ok) {
        const body = result.body as { error?: string; message?: string };
        setError(body.message || `Save failed (${result.status}): ${body.error}`);
        return;
      }
      onDone();
    } catch (err) {
      setError(`Save failed — could not reach the server. ${String(err).slice(0, 120)}`);
    }
  };

  const field =
    "h-8 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]";
  const label = "grid gap-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--color-muted)]";

  return (
    <div
      className="grid max-h-[calc(var(--radix-popover-content-available-height,80vh)-24px)] gap-2.5 overflow-y-auto"
      data-testid="triage-quick-edit"
    >
      <label className={label}>
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`${field} normal-case tracking-normal font-normal`}
          data-testid="triage-quick-edit-title"
        />
      </label>
      <label className={label}>
        Severity
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as TriageSeverity)}
          className={`${field} normal-case tracking-normal font-normal`}
          data-testid="triage-quick-edit-severity"
        >
          {SEVERITY_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Priority <span className="font-normal normal-case tracking-normal">(follows severity)</span>
        <input disabled value={item.suggestedPriority} className={`${field} opacity-60`} />
      </label>
      <label className={label}>
        Domain
        <input disabled value={item.suggestedDomain} className={`${field} opacity-60`} />
      </label>
      <label className={label}>
        Complexity
        <input disabled value={getComplexity(item)} className={`${field} opacity-60`} />
      </label>
      {writeDisabled && (
        <div
          className="rounded border border-[var(--warn-line)] bg-warn-tint p-2 text-xs text-warn"
          data-testid="triage-quick-edit-unavailable"
        >
          Save is unavailable: {writeReason}
        </div>
      )}
      {error && (
        <div
          className="rounded border border-[var(--err-line)] bg-err-tint p-2 text-xs text-err"
          data-testid="triage-quick-edit-error"
        >
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={amend.isPending}
          className="h-8 rounded-[var(--radius-button)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-muted-bg)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={writeDisabled || amend.isPending || !title.trim()}
          title={writeDisabled ? writeReason : undefined}
          data-testid="triage-quick-edit-save"
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-3 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {amend.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}

const ICON_TRIGGER =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]";
const PILL_TRIGGER =
  "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--surface-form-sunken,#e4dfda)]";

/** `iconOnly` = the pencil as a square button (the Triage rows put it beside the action buttons). */
export function TriageQuickEdit({ projectId, item, iconOnly = false }: Props & { iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Edit title and severity (currently ${item.suggestedPriority} · ${item.suggestedDomain})`}
          title="Edit title and severity"
          onClick={(e) => e.stopPropagation()}
          data-testid={`triage-quick-edit-trigger-${item.id}`}
          className={iconOnly ? ICON_TRIGGER : PILL_TRIGGER}
        >
          <Pencil size={iconOnly ? 14 : 11} className="shrink-0" />
          {!iconOnly && <span className="truncate">{item.suggestedPriority} · {item.suggestedDomain}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onClick={(e) => e.stopPropagation()}
          className="z-[70] w-[min(300px,calc(100vw-16px))] rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]"
        >
          <Body projectId={projectId} item={item} onDone={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
