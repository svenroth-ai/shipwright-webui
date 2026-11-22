/*
 * NewReminderDialog — "+ New reminder" in the New Task look (campaign
 * reminders-webui, W3; mockup page 03): the same light sheet, a "Creating in"
 * project row (or a project picker when the board shows All projects), the
 * three required fields (Title, Due day, Why) and a "More options" bar holding
 * Decided, Still open, Command and one Link. A DAY only, no time. The tool
 * (reminder_cli.py add, through the W1 route) stays the authority: its plain
 * refusal, e.g. "looks like it contains a secret", is shown as-is, the form
 * stays filled, and nothing retries around it. The WebUI never writes the
 * reminder file. Everything typed is sent as plain text.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { Bell, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { FieldLabel } from "../external/NewIssueModal/FieldLabel";
import { MoreOptionsDisclosure } from "../external/NewIssueModal/MoreOptionsDisclosure";
import { ProjectContextStrip } from "../external/ProjectContextStrip";
import { ModalScrollBody } from "../common/ModalScrollBody";
import { useReminderAdd } from "../../hooks/useReminders";
import type { ReminderAddBody } from "../../lib/remindersApi";
import type { Project } from "../../types";

const INPUT =
  "w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--surface-form-line,#847a75)] bg-white px-3 py-2 text-[13px] pointer-coarse:text-[16px] outline-none focus:border-[var(--color-primary,#6b5e56)]";
const AREA = `${INPUT} min-h-[72px] resize-y`;
const MAX_TEXT = 2000;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registered projects (no synthesized rows). */
  projects: readonly Project[];
  /** The one project the board is scoped to, or undefined when it shows All projects. */
  scopedProject: Project | undefined;
  onCreated: (info: { due: string; projectName: string }) => void;
}

export function NewReminderDialog({ open, onOpenChange, projects, scopedProject, onCreated }: Props) {
  const add = useReminderAdd();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [why, setWhy] = useState("");
  const [decided, setDecided] = useState("");
  const [stillOpen, setStillOpen] = useState("");
  const [command, setCommand] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkRef, setLinkRef] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetId = scopedProject?.id ?? projectId;
  const target = projects.find((p) => p.id === targetId);
  const canSubmit = Boolean(target) && title.trim() !== "" && due !== "" && why.trim() !== "" && !add.isPending;

  const submit = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    if (!target || !canSubmit) return;
    const hasLabel = linkLabel.trim() !== "";
    const hasRef = linkRef.trim() !== "";
    if (hasLabel !== hasRef) {
      setMoreOpen(true);
      setError("Not saved. A link needs both a label and an address.");
      return;
    }
    const body: ReminderAddBody = { title: title.trim(), due, why: why.trim() };
    if (decided.trim()) body.decided = decided.trim();
    if (stillOpen.trim()) body.open = stillOpen.trim();
    if (command.trim()) body.command = command.trim();
    if (hasLabel) body.links = [{ label: linkLabel.trim(), ref: linkRef.trim() }];
    setError(null);
    const r = await add.mutateAsync({ projectId: target.id, body });
    if (!r.ok) {
      // The tool's own wording, as is (e.g. the secret refusal). No retry, the form stays filled.
      setError(`Not saved. ${r.message}`);
      return;
    }
    onCreated({ due, projectName: target.name });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby="new-reminder-sub"
          className="kbd-dialog fixed left-1/2 top-[10%] z-50 flex max-h-[80dvh] w-[560px] max-w-[95vw] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--surface-form,#edeae7)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="new-reminder-dialog"
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--surface-form-divider,#c3b8ae)] px-5 py-4">
            <div
              className="reminder-dialog-icon flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px]"
              aria-hidden
            >
              <Bell size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[16px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]">
                New Reminder
              </Dialog.Title>
              <Dialog.Description id="new-reminder-sub" className="mt-0.5 text-[12px] leading-[1.4] text-[var(--body,#44403c)]">
                Remind yourself of something on a day. It shows up in the Inbox that day, and by mail if you turned mail on.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-[6px] p-1 text-[var(--body,#44403c)] hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] hover:text-[var(--ink,#1c1917)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col" data-testid="new-reminder-form">
            <div className="flex min-h-0 flex-1 flex-col">
              <ModalScrollBody className="max-h-full gap-4" data-testid="new-reminder-body">
                {scopedProject ? (
                  <ProjectContextStrip name={scopedProject.name} color={scopedProject.settings?.color} path={scopedProject.path} />
                ) : (
                  <FieldLabel label="Project" required hint="the board shows All projects, so pick one">
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      data-testid="new-reminder-project"
                      className={INPUT}
                      required
                    >
                      <option value="">Select a project...</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </FieldLabel>
                )}
                <FieldLabel label="Title" required>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    autoFocus
                    required
                    data-testid="new-reminder-title"
                    className={INPUT}
                  />
                </FieldLabel>
                <FieldLabel label="Due day" required>
                  <input
                    type="date"
                    value={due}
                    min={localToday()}
                    onChange={(e) => setDue(e.target.value)}
                    required
                    data-testid="new-reminder-due"
                    className={`${INPUT} !w-[11rem]`}
                  />
                </FieldLabel>
                <FieldLabel label="Why" required hint="why does this matter">
                  <textarea
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    maxLength={MAX_TEXT}
                    required
                    data-testid="new-reminder-why"
                    className={AREA}
                  />
                </FieldLabel>
                <MoreOptionsDisclosure
                  open={moreOpen}
                  onToggle={() => setMoreOpen((v) => !v)}
                  hint="decided, still open, command & link"
                >
                  <FieldLabel label="Decided">
                    <textarea value={decided} onChange={(e) => setDecided(e.target.value)} maxLength={MAX_TEXT} data-testid="new-reminder-decided" className={AREA} />
                  </FieldLabel>
                  <FieldLabel label="Still open">
                    <textarea value={stillOpen} onChange={(e) => setStillOpen(e.target.value)} maxLength={MAX_TEXT} data-testid="new-reminder-open" className={AREA} />
                  </FieldLabel>
                  <FieldLabel label="Command">
                    <input
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      maxLength={MAX_TEXT}
                      placeholder="optional - e.g. /shipwright-iterate ..."
                      data-testid="new-reminder-command"
                      className={INPUT}
                    />
                    <span className="text-[11px] text-[var(--body,#44403c)]">
                      Normally filled in by Shipwright when it creates a reminder for you. Leave empty for your own reminders.
                    </span>
                  </FieldLabel>
                  <FieldLabel label="Link">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label" aria-label="Link label" data-testid="new-reminder-link-label" className={INPUT} />
                      <input type="text" value={linkRef} onChange={(e) => setLinkRef(e.target.value)} placeholder="Address (https://...)" aria-label="Link address" data-testid="new-reminder-link-ref" className={INPUT} />
                    </div>
                  </FieldLabel>
                </MoreOptionsDisclosure>
                {error && (
                  <div
                    role="alert"
                    data-testid="new-reminder-error"
                    className="reminder-error-box rounded-[var(--radius-button,8px)] px-3 py-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere]"
                  >
                    {error}
                  </div>
                )}
              </ModalScrollBody>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--surface-form-divider,#c3b8ae)] bg-[var(--surface-form-sunken,#e4dfda)] px-5 py-3">
              <div className="flex-1 text-[11px] text-[var(--body,#44403c)]">
                <kbd className="rounded-[3px] border border-[var(--surface-form-line,#847a75)] bg-white px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> to cancel
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--surface-form-line,#847a75)] bg-white px-4 text-[13px] font-semibold text-[var(--ink,#1c1917)] hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] pointer-coarse:min-h-[44px]"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="btn-primary" disabled={!canSubmit} data-testid="new-reminder-submit">
                Create reminder
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
