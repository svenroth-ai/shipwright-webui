import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dismissInboxItem,
  listInbox,
  type ExternalTask,
  type InboxItem,
} from "../lib/externalApi";
import { answerLeadQuestion } from "../lib/leadQuestionApi";

const KEY = ["external-inbox"] as const;

export function useExternalInbox() {
  return useQuery<InboxItem[]>({
    queryKey: KEY,
    queryFn: listInbox,
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
  });
}

export function useDismissInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dismissInboxItem,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

/** FR-04.17/18 — answer a `lead_question` inbox item (PATCHes `poFeedback`). */
export function useAnswerLeadQuestion() {
  const qc = useQueryClient();
  return useMutation<
    ExternalTask,
    Error,
    { taskId: string; answerText: string }
  >({
    mutationFn: ({ taskId, answerText }) =>
      answerLeadQuestion(taskId, answerText),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
