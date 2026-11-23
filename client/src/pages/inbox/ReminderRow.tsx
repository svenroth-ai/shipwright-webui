/*
 * ReminderRow — one due reminder or expired parked-triage entry as a compact
 * Triage-style row (campaign reminders-webui, W3; mockup pages 01 + 06). Same
 * layout as InboxRow: chip + title left; a fixed, otherwise EMPTY action zone
 * that fills on hover / keyboard focus (always visible on touch / narrow
 * rows); the due text and the copyable id on the right. Actions: a reminder
 * with a stored command offers "Start task" (the command is NEVER run or
 * parsed — see useReminderActions), every reminder offers Done and Snooze; a
 * parked triage entry offers only "Open in Triage" (Fix now / Dismiss / Snooze
 * happen there, in one place). The title and every other text are untrusted and
 * render as plain text. Dark glass: explicit white tints, never a flipping token.
 */
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Play } from "lucide-react";

import { TriageIdCopy } from "../../components/triage/TriageIdCopy";
import { MENU_CONTENT } from "../../components/triage/triageMenuStyles";
import type { ReminderRowModel, ReminderEntry } from "./reminderModel";
import { ReminderSnoozePanel } from "../../components/reminders/ReminderSnoozePanel";
import type { ReminderUi } from "./useReminderActions";

/** Clicks on interactive bits and on the selectable id must not open the dialog. */
const NO_OPEN = "button,a,input,select,textarea,label,[data-no-open]";

const PRIMARY =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] pointer-coarse:min-h-[44px]";

interface Props {
  entry: ReminderEntry;
  model: ReminderRowModel;
  ui: ReminderUi | undefined;
  onOpen: () => void;
}

export function ReminderRow({ entry, model, ui, onOpen }: Props) {
  const { key } = entry;
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const busy = ui?.busyKeys.has(key) === true;
  const error = ui?.errors[key] ?? null;

  return (
    <div
      role="listitem"
      className="triage-row inbox-row is-rem relative block rounded-[10px] border border-white/[0.09] bg-white/[0.055] text-white/95 transition-colors hover:border-white/20 hover:bg-white/10 focus-within:border-white/20 focus-within:bg-white/10"
      data-testid={`inbox-card-${key}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(NO_OPEN)) return;
        // Dragging across the row's text to select it must not open the dialog.
        const sel = window.getSelection();
        if (sel?.toString() && sel.anchorNode && e.currentTarget.contains(sel.anchorNode)) return;
        onOpen();
      }}
    >
      <div className="triage-row-in">
        <div className="triage-row-main flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={`inbox-chip is-${model.chip.tone}`} data-testid={`inbox-chip-${key}`}>
            {model.chip.label}
          </span>
          <h3 className="m-0 min-w-0 flex-1 basis-full text-sm font-medium leading-snug [overflow-wrap:anywhere] md:basis-0">
            <button
              type="button"
              onClick={onOpen}
              data-nav-item
              data-testid={`inbox-row-title-${key}`}
              className="inbox-row-title text-left hover:underline focus-visible:underline"
            >
              {model.title}
            </button>
          </h3>
        </div>

        <div className="triage-row-actions flex-wrap gap-2" data-no-open data-testid={`inbox-row-actions-${key}`}>
          {ui && model.canStart && (
            <button
              type="button"
              className={PRIMARY}
              onClick={() => ui.startTask(entry)}
              data-testid={`reminder-start-${key}`}
            >
              <Play size={13} aria-hidden="true" />
              Start task
            </button>
          )}
          {ui && model.canAct && (
            <>
              <button
                type="button"
                className="inbox-row-btn"
                disabled={busy}
                onClick={() => void ui.done(entry)}
                data-testid={`reminder-done-${key}`}
              >
                Done
              </button>
              <Popover.Root open={snoozeOpen} onOpenChange={(o) => { if (o) ui?.clearError(key); setSnoozeOpen(o); }}>
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    className="inbox-row-btn"
                    disabled={busy}
                    aria-haspopup="dialog"
                    data-testid={`reminder-snooze-${key}`}
                  >
                    Snooze
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={6}
                    collisionPadding={8}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`reminder-snooze-popover-${key}`}
                    className={`${MENU_CONTENT} z-[70] w-[min(33rem,92vw)] p-3`}
                  >
                    <ReminderSnoozePanel
                      testIdBase={`reminder-row-${key}`}
                      pending={busy}
                      error={error}
                      onSnooze={(day) => void ui.snooze(entry, day).then((ok) => ok && setSnoozeOpen(false))}
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </>
          )}
          {ui && !model.canAct && model.filter === "parked" && (
            <button type="button" className={PRIMARY} onClick={() => ui.openTriage(entry)} data-testid={`reminder-open-triage-${key}`}>
              Open in Triage
            </button>
          )}
        </div>

        <div className="triage-row-meta">
          <span className="inbox-row-due" data-testid={`inbox-row-due-${key}`}>
            {model.dueText}
          </span>
          {model.idText && (
            <TriageIdCopy
              id={model.idText}
              testIdBase={`inbox-row-${key}`}
              title={model.idText}
              label={`Copy ${model.idText}`}
            />
          )}
        </div>

        {error && !snoozeOpen && (
          <p role="alert" className="triage-row-wide inbox-row-error" data-testid={`inbox-row-error-${key}`}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
