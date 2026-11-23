/*
 * useReminderActions — what the buttons on a reminder row / dialog do
 * (campaign reminders-webui, W3). Done and Snooze call the W1 routes (which run
 * the Shipwright reminder tool; the WebUI never edits the reminder file).
 * "Start task" resolves the project's action catalog and hands the page a
 * pre-filled New Task dialog (`startModal`) exactly like Fix now in Triage: a
 * task card is created only when the operator confirms there, and nothing
 * launches by itself (CLAUDE.md DO-NOT #19: auto-execute stays behind the
 * explicit Launch click that core/launcher.ts serves). Open in Triage is a
 * plain navigation. The tool's own refusal text is shown unchanged. Errors are
 * kept per entry so a failure under one row never hides under another.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useProjectActions } from "../../hooks/useProjectActions";
import { useReminderDone, useReminderSnooze } from "../../hooks/useReminders";
import { triageDeepLink } from "../../hooks/useTriageDeepLink";
import type { ResolvedProjectActions } from "../../lib/externalApi";
import type { ReminderEntry } from "./reminderModel";
import { buildReminderStartIntent, type ReminderStartIntent } from "./reminderStartIntent";

export interface ReminderUi {
  /** Entries with a write in flight: each row is locked on its own, others stay usable. */
  busyKeys: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  done: (entry: ReminderEntry) => Promise<boolean>;
  snooze: (entry: ReminderEntry, day: string) => Promise<boolean>;
  startTask: (entry: ReminderEntry) => void;
  /** Opens that parked item's own detail in Triage (not just the list). */
  openTriage: (entry: ReminderEntry) => void;
  clearError: (key: string) => void;
}

/** What the page mounts the New Task dialog with. */
export interface ReminderStartModal {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: ReminderStartIntent | null;
  projectActions: ResolvedProjectActions | undefined;
}

export function useReminderActions(): { ui: ReminderUi; startModal: ReminderStartModal } {
  const navigate = useNavigate();
  const doneMut = useReminderDone();
  const snoozeMut = useReminderSnooze();
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ReminderEntry | null>(null);
  const [intent, setIntent] = useState<ReminderStartIntent | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // The new click wins over the last intent, so a second project never borrows the first one's catalog.
  const catalog = useProjectActions(pending?.projectId ?? intent?.projectId ?? null);

  const setError = useCallback((key: string, message: string | null) => {
    setErrors((prev) => {
      if (message === null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: message };
    });
  }, []);

  // Start task: wait for the project's catalog, then open the pre-filled dialog (or say why not).
  useEffect(() => {
    if (!pending || catalog.isLoading || catalog.isFetching) return;
    const result = buildReminderStartIntent(pending, catalog.data);
    if (result.kind === "failed") {
      setError(pending.key, result.message);
    } else {
      setIntent(result.intent);
      setModalOpen(true);
    }
    setPending(null);
  }, [pending, catalog.isLoading, catalog.isFetching, catalog.data, setError]);

  const run = useCallback(
    async (entry: ReminderEntry, call: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      if (entry.item.id === null) return false;
      if (busyRef.current.has(entry.key)) return false;
      busyRef.current.add(entry.key);
      setBusyKeys(new Set(busyRef.current));
      setError(entry.key, null);
      try {
        const r = await call();
        if (!r.ok) {
          setError(entry.key, r.message);
          return false;
        }
        return true;
      } finally {
        busyRef.current.delete(entry.key);
        setBusyKeys(new Set(busyRef.current));
      }
    },
    [setError],
  );

  const ui: ReminderUi = {
    busyKeys,
    errors,
    done: (entry) => run(entry, () => doneMut.mutateAsync({ projectId: entry.projectId, id: entry.item.id ?? "" })),
    snooze: (entry, day) =>
      run(entry, () => snoozeMut.mutateAsync({ projectId: entry.projectId, id: entry.item.id ?? "", until: day })),
    startTask: (entry) => {
      setError(entry.key, null);
      setPending(entry);
    },
    openTriage: (entry) => navigate(triageDeepLink(entry.projectId, entry.item.id)),
    clearError: (key) => setError(key, null),
  };

  return {
    ui,
    startModal: { open: modalOpen, onOpenChange: setModalOpen, intent, projectActions: catalog.data },
  };
}
