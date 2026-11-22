/*
 * ReminderStartDialog — mounts the New Task dialog for "Start task" on a
 * reminder (campaign reminders-webui, W3). The page owns this mount (like
 * TriagePage owns the Fix-now one) so it survives the reminder's detail dialog
 * closing. Nothing here creates or launches a task: the operator confirms in
 * the dialog (Save to Backlog / Launch), exactly as with Fix now.
 */
import { NewIssueModal } from "../../components/external/NewIssueModal";
import type { ReminderStartModal } from "./useReminderActions";

export function ReminderStartDialog({ modal }: { modal: ReminderStartModal }) {
  const { intent } = modal;
  return (
    <NewIssueModal
      open={modal.open}
      onOpenChange={modal.onOpenChange}
      action={intent?.action ?? null}
      projectActions={modal.projectActions}
      initialTitle={intent?.initialTitle}
      initialDescription={intent?.initialDescription}
      initialProjectId={intent?.projectId}
    />
  );
}
