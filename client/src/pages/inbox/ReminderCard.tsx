/*
 * ReminderCard — one due reminder / expired parked-triage entry: the compact row
 * plus the detail dialog it opens (campaign reminders-webui, W3). Mirrors
 * InboxCard: the dialog is a SIBLING of the row, never a child, because a
 * portaled dialog bubbles React events up the React tree and the row's click
 * would reopen it.
 */
import { useMemo, useState } from "react";

import { ReminderDetailDialog } from "./ReminderDetailDialog";
import { ReminderRow } from "./ReminderRow";
import { reminderRowModel, type ReminderEntry } from "./reminderModel";
import type { ReminderUi } from "./useReminderActions";

export function ReminderCard({
  entry,
  projectName,
  ui,
}: {
  entry: ReminderEntry;
  projectName: string;
  ui: ReminderUi | undefined;
}) {
  const [open, setOpen] = useState(false);
  const model = useMemo(() => reminderRowModel(entry), [entry]);
  return (
    <>
      <ReminderRow entry={entry} model={model} ui={ui} onOpen={() => setOpen(true)} />
      {open && (
        <ReminderDetailDialog
          open={open}
          onOpenChange={setOpen}
          entry={entry}
          model={model}
          projectName={projectName}
          ui={ui}
        />
      )}
    </>
  );
}
