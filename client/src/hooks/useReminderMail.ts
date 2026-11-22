/*
 * useReminderMail — the one shared read of the reminder-mail settings + last
 * send status (campaign reminders-webui, W4). Used by the Settings card and by
 * the Inbox banner for a failed send, so both show the same answer.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchReminderMail,
  saveReminderMail,
  sendReminderTestMail,
  type ReminderMailSaveBody,
  type ReminderMailView,
} from "../lib/reminderMailApi";

export const REMINDER_MAIL_KEY = ["reminder-mail"] as const;

export function useReminderMail() {
  return useQuery<ReminderMailView>({
    queryKey: REMINDER_MAIL_KEY,
    queryFn: fetchReminderMail,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSaveReminderMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReminderMailSaveBody) => saveReminderMail(body),
    onSuccess: (res) => {
      if (res.ok) qc.setQueryData(REMINDER_MAIL_KEY, res.view);
    },
  });
}

export function useSendReminderTestMail() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: sendReminderTestMail, onSettled: () => qc.invalidateQueries({ queryKey: REMINDER_MAIL_KEY }) });
}
