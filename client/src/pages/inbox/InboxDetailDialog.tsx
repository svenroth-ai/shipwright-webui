/*
 * InboxDetailDialog — the light detail sheet an Inbox row opens
 * (iterate-2026-11-22-w2-inbox-triage-look). The same sheet as the Triage
 * detail / New Task: title, kind chip + session id, the FULL text, and the
 * actions. The row only shows the first line, so everything the operator needs
 * to decide lives here: the question (markdown only for the kinds that always
 * rendered it, through the XSS-safe MarkdownText; picker prompts in a mono box),
 * the option chips of an AskUserQuestion, the honesty line, "Answer in the
 * terminal" and "Open task". A lead question carries its answer form.
 *
 * Mounted by InboxCard as a SIBLING of the row: a portaled dialog bubbles React
 * events up the React tree, and the row's click would reopen it.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { MarkdownText } from "../../components/external/MarkdownText";
import type { ExternalTask, InboxItem } from "../../lib/externalApi";
import type { LeadQuestionInboxItem } from "../../lib/leadQuestionApi";
import { LeadAnswerPanel } from "./InboxCard.LeadQuestion";
import { InboxResumeButton } from "./InboxResumeButton";
import { InboxTerminalHonesty } from "./InboxHonesty";
import type { InboxRowModel } from "./inboxRowModel";

const SECONDARY_BTN =
  "inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--surface-form-line,#8e847e)] bg-white px-4 text-[13px] font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] pointer-coarse:min-h-[44px]";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InboxItem;
  itemKey: string;
  model: InboxRowModel;
  task: ExternalTask | undefined;
}

export function InboxDetailDialog({ open, onOpenChange, item, itemKey, model, task }: Props) {
  const navigate = useNavigate();
  const contextLine = task?.title ?? item.taskTitle;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[4px]" />
        <Dialog.Content
          aria-describedby={undefined}
          // No Dialog.Trigger here (the row opens it), so hand focus back to the row title.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLElement>(`[data-testid="inbox-row-title-${itemKey}"]`)?.focus();
          }}
          className="kbd-dialog fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[640px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-card)] bg-[var(--surface-form,#edeae7)] p-6 shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid={`inbox-detail-${itemKey}`}
        >
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--surface-form-divider,#c3b8ae)] pb-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold leading-snug text-[var(--color-text)] [overflow-wrap:anywhere]">
                {model.title || model.chip.label}
              </Dialog.Title>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-[var(--body,#44403c)]">
                <span className={`inbox-dchip is-${model.chip.tone}`}>{model.chip.label}</span>
                <span className="[overflow-wrap:anywhere]" data-testid={`inbox-task-context-pill-${itemKey}`}>
                  {contextLine}
                </span>
                <code title={`Session ${item.sessionUuid}`}>{item.sessionUuid.slice(0, 8)}</code>
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
            <dt className="text-[var(--color-muted)]">{model.textLabel}</dt>
            <dd className="m-0 min-w-0 text-[var(--color-text)]" data-testid={`inbox-question-text-${itemKey}`}>
              {model.asks.length > 0 ? (
                model.asks.map((ask, pi) => (
                  <div key={pi} className={pi > 0 ? "mt-4 border-t border-[var(--surface-form-divider,#c3b8ae)] pt-3" : undefined}>
                    {ask.header && <div className="mb-1 text-xs font-semibold uppercase tracking-wide">{ask.header}</div>}
                    <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{ask.question}</div>
                    {ask.context && <div className="mt-2 text-[13px] text-[var(--color-muted)]">{ask.context}</div>}
                    {ask.options && ask.options.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {ask.options.map((o, i) => (
                          <span
                            key={i}
                            data-testid={pi === 0 ? `inbox-option-chip-${i}` : `inbox-option-chip-${pi}-${i}`}
                            className="inline-flex items-center rounded-[10px] border border-[var(--color-border)] bg-white px-3 py-1 text-[13px] font-medium"
                          >
                            {o}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : model.format === "markdown" ? (
                <MarkdownText text={model.text} />
              ) : model.format === "mono" ? (
                <pre className="m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--color-border)] bg-white p-2.5 font-mono text-[12.5px] leading-relaxed">
                  {model.text}
                </pre>
              ) : (
                <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{model.text}</div>
              )}
            </dd>
          </dl>

          {model.answeredInTerminal && <InboxTerminalHonesty itemKey={itemKey} />}

          {item.kind === "lead_question" && (
            <div className="mt-4">
              <LeadAnswerPanel item={item as LeadQuestionInboxItem} itemKey={itemKey} />
            </div>
          )}

          {task && (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--surface-form-divider,#c3b8ae)] pt-4">
              <button
                type="button"
                className={SECONDARY_BTN}
                data-testid={`inbox-open-task-${itemKey}`}
                onClick={() => {
                  onOpenChange(false);
                  navigate(
                    `/tasks/${task.taskId}`,
                    item.kind === "lead_question" ? undefined : { state: { focusTerminal: true } },
                  );
                }}
              >
                Open task
              </button>
              {model.answeredInTerminal && (
                <InboxResumeButton task={task} idKey={`${itemKey}-dialog`} variant="dialog" />
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
