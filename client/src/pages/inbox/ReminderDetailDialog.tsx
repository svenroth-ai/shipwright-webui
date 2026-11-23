/*
 * ReminderDetailDialog — the light detail sheet a reminder / parked-triage row
 * opens (campaign reminders-webui, W3; mockup page 02). Same sheet as the Inbox
 * and Triage dialogs: title, chip + project + id, then the labelled fields
 * (empty ones are left out), then the actions. EVERY text is untrusted and is
 * rendered through React as plain text, never as HTML or markdown; a very long
 * "Still open" scrolls inside its own box. The stored command is shown as
 * inert text (never a link, never run). Only an http(s) `url` link is a live
 * link (W1 already drops other schemes; this re-checks); file / campaign /
 * triage refs are local paths or ids and stay plain text.
 *
 * Mounted by ReminderCard as a SIBLING of the row: a portaled dialog bubbles
 * React events up the React tree, and the row's click would reopen it.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { Play, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ReminderLink } from "../../lib/remindersApi";
import type { ReminderEntry, ReminderRowModel } from "./reminderModel";
import { ReminderSnoozePanel } from "../../components/reminders/ReminderSnoozePanel";
import type { ReminderUi } from "./useReminderActions";

const SECONDARY_BTN =
  "inline-flex h-9 items-center justify-center gap-1 rounded-[var(--radius-button)] border-[1.5px] border-[var(--surface-form-line,#8e847e)] bg-white px-4 text-[13px] font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] pointer-coarse:min-h-[44px]";

function isHttp(ref: string): boolean {
  try {
    const p = new URL(ref).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

function LinkLine({ link }: { link: ReminderLink }) {
  const label = link.label?.trim() || link.ref || "(link)";
  if (link.kind === "url" && link.ref && isHttp(link.ref)) {
    return (
      <a
        href={link.ref}
        target="_blank"
        rel="noopener noreferrer"
        title={link.ref}
        className="reminder-link underline [overflow-wrap:anywhere]"
      >
        {label}
      </a>
    );
  }
  // A file path, campaign slug or triage id: shown, never made clickable.
  return (
    <span className="[overflow-wrap:anywhere]">
      {label}
      {link.ref && link.ref !== label ? <span className="text-[var(--color-muted)]"> ({link.kind ?? "ref"}: {link.ref})</span> : null}
    </span>
  );
}

function Field({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <>
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="m-0 min-w-0 text-[var(--color-text)]" data-testid={testId}>
        {children}
      </dd>
    </>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: ReminderEntry;
  model: ReminderRowModel;
  projectName: string;
  ui: ReminderUi | undefined;
}

export function ReminderDetailDialog({ open, onOpenChange, entry, model, projectName, ui }: Props) {
  const { item, key } = entry;
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const busy = ui?.busyKeys.has(key) === true;
  const error = ui?.errors[key] ?? null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[4px]" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLElement>(`[data-testid="inbox-row-title-${CSS.escape(key)}"]`)?.focus();
          }}
          className="kbd-dialog fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[640px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-card)] bg-[var(--surface-form,#edeae7)] p-6 shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid={`inbox-detail-${key}`}
        >
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--surface-form-divider,#c3b8ae)] pb-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold leading-snug text-[var(--color-text)] [overflow-wrap:anywhere]">
                {model.title}
              </Dialog.Title>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-[var(--body,#44403c)]">
                <span className="[overflow-wrap:anywhere]" data-testid={`inbox-task-context-pill-${key}`}>
                  {projectName}
                </span>
                {model.idText && (
                  <code className="rounded border border-[var(--surface-form-divider,#c3b8ae)] bg-white px-1.5 py-px font-mono text-[12.5px]">
                    {model.idText}
                  </code>
                )}
                <span className={`inbox-dchip is-${model.chip.tone}`}>{model.chip.label}</span>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--body,#44403c)] transition-colors hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] hover:text-[var(--ink,#1c1917)]"
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <dl className="m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <Field label={model.dayLabel} testId={`reminder-day-${key}`}>
              {model.dayValue}
            </Field>
            {item.why && (
              <Field label="Why" testId={`reminder-why-${key}`}>
                <div className="inbox-long-text">{item.why}</div>
              </Field>
            )}
            {item.decided && (
              <Field label="Decided" testId={`reminder-decided-${key}`}>
                <div className="inbox-long-text">{item.decided}</div>
              </Field>
            )}
            {item.open && (
              <Field label="Still open" testId={`reminder-open-${key}`}>
                <div className="inbox-open-box">{item.open}</div>
              </Field>
            )}
            {item.command && (
              <Field label="Command" testId={`reminder-command-${key}`}>
                <code className="[overflow-wrap:anywhere] reminder-command font-mono text-[12.5px]">{item.command}</code>
              </Field>
            )}
            {item.links.length > 0 && (
              <Field label="Links" testId={`reminder-links-${key}`}>
                <div className="flex flex-col gap-1">
                  {item.links.map((l, i) => (
                    <LinkLine key={i} link={l} />
                  ))}
                </div>
              </Field>
            )}
          </dl>

          {!model.canAct && model.filter === "parked" && (
            <p className="mb-0 mt-4 text-[13px] text-[var(--color-muted)]">
              Fix now, Dismiss and Snooze for a parked item are done in Triage itself: one place to act on it.
            </p>
          )}

          {snoozeOpen && model.canAct && (
            <div className="mt-4 rounded-[var(--radius-button)] border border-[var(--surface-form-divider,#c3b8ae)] bg-[var(--surface-form-sunken,#e4dfda)] p-3">
              <ReminderSnoozePanel
                testIdBase={`reminder-dialog-${key}`}
                pending={busy}
                error={error}
                onSnooze={(day) => void ui?.snooze(entry, day).then((ok) => ok && onOpenChange(false))}
              />
            </div>
          )}
          {error && !snoozeOpen && (
            <p role="alert" className="mb-0 mt-3 text-xs text-[var(--color-error,#DC2626)] [overflow-wrap:anywhere]" data-testid={`reminder-error-${key}`}>
              {error}
            </p>
          )}

          {ui && (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--surface-form-divider,#c3b8ae)] pt-4">
              {model.canAct && (
                <>
                  <button
                    type="button"
                    className={SECONDARY_BTN}
                    aria-expanded={snoozeOpen}
                    disabled={busy}
                    onClick={() => setSnoozeOpen((v) => !v)}
                    data-testid={`reminder-dialog-snooze-${key}`}
                  >
                    Snooze {snoozeOpen ? "▴" : "▾"}
                  </button>
                  <button
                    type="button"
                    className={model.canStart ? SECONDARY_BTN : "btn-primary"}
                    disabled={busy}
                    onClick={() => void ui.done(entry).then((ok) => ok && onOpenChange(false))}
                    data-testid={`reminder-dialog-done-${key}`}
                  >
                    Done
                  </button>
                </>
              )}
              {model.canStart && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onOpenChange(false);
                    ui.startTask(entry);
                  }}
                  data-testid={`reminder-dialog-start-${key}`}
                >
                  <Play size={13} aria-hidden="true" /> Start task
                </button>
              )}
              {!model.canAct && model.filter === "parked" && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onOpenChange(false);
                    ui.openTriage(entry);
                  }}
                  data-testid={`reminder-dialog-open-triage-${key}`}
                >
                  Open in Triage
                </button>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
