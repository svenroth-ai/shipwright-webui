/*
 * reminderStartIntent — what "Start task" on a reminder hands to the New Task
 * dialog (campaign reminders-webui, W3). It works like Fix now in Triage: the
 * dialog opens pre-filled, a task card is created only when the operator
 * confirms there, and the operator presses Launch themselves.
 *
 * The launch is built from the reminder's KIND and ID (it is a reminder, in
 * this project) through the same action catalog Fix now uses; the stored
 * `command` text is NEVER read here, parsed, or passed on (it is inert display
 * text). The pre-filled title and description are the reminder's own text, put
 * in plain fields the operator can read and edit before anything is created.
 */
import type { ActionDefinition, ResolvedProjectActions } from "../../lib/externalApi";
import { DESCRIPTION_MAX_LENGTH } from "../../components/external/NewIssueModal/SimpleFields";
import type { ReminderEntry } from "./reminderModel";

/** The same action Fix now uses for iterate-flow work. */
const START_ACTION_ID = "new-iterate";

export interface ReminderStartIntent {
  action: ActionDefinition;
  projectId: string;
  initialTitle: string;
  initialDescription: string;
}

export type ReminderStartResolution =
  | { kind: "ok"; intent: ReminderStartIntent }
  | { kind: "failed"; message: string };

function describe(entry: ReminderEntry): string {
  const { item } = entry;
  const parts = [`From reminder ${item.id ?? ""}`.trim() + "."];
  if (item.why) parts.push(`Why: ${item.why}`);
  if (item.decided) parts.push(`Decided: ${item.decided}`);
  if (item.open) parts.push(`Still open: ${item.open}`);
  return parts.join("\n\n").slice(0, DESCRIPTION_MAX_LENGTH);
}

export function buildReminderStartIntent(
  entry: ReminderEntry,
  catalog: ResolvedProjectActions | undefined,
): ReminderStartResolution {
  if (!catalog) {
    return { kind: "failed", message: "Action catalog not loaded - try again in a moment, or refresh the page." };
  }
  const action = catalog.actions.find((a) => a.id === START_ACTION_ID);
  if (!action) {
    return { kind: "failed", message: `Action "${START_ACTION_ID}" missing from this project's catalog.` };
  }
  return {
    kind: "ok",
    intent: {
      action,
      projectId: entry.projectId,
      initialTitle: entry.item.title?.trim() || "Reminder",
      initialDescription: describe(entry),
    },
  };
}
