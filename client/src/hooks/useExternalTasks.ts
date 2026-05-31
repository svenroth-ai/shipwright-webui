import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTaskToBacklog,
  renameTask,
  updateTask,
  type ExternalTask,
  type TaskUpdatePatch,
} from "../lib/externalApi";
import { reopenTask } from "../lib/taskReopenApi";

const LIST_KEY = ["external-tasks"] as const;
const detailKey = (taskId: string) => ["external-task", taskId] as const;

/**
 * List external tasks, optionally filtered by projectId (section 02).
 *
 * Passing `null` or omitting the arg = All Projects. Passing the reserved
 * literal "unassigned" narrows to the synthesized bucket. The query key
 * includes projectId so switching filters produces a fresh fetch without
 * stale overlap.
 */
export function useExternalTasks(args: { projectId?: string | null } = {}) {
  const projectId = args.projectId ?? null;
  return useQuery<ExternalTask[]>({
    queryKey: [...LIST_KEY, projectId] as const,
    queryFn: () => listTasks({ projectId }),
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });
}

export function useExternalTask(taskId: string | undefined) {
  return useQuery<ExternalTask>({
    queryKey: taskId ? detailKey(taskId) : ["external-task", "none"],
    queryFn: () => getTask(taskId!),
    enabled: Boolean(taskId),
  });
}

export function useCreateExternalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useCloseExternalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeTask,
    onSuccess: (task) => {
      qc.setQueryData(detailKey(task.taskId), task);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/**
 * iterate-2026-05-17-move-to-backlog (FR-01.32) — move an In-Progress
 * task back to the Backlog column. Mirrors `useCloseExternalTask`: the
 * `setQueryData(detailKey, …)` write is what flips the TaskDetailHeader
 * state badge in place (AC-5) without a refetch round-trip; the LIST_KEY
 * invalidation relocates the card on the TaskBoard.
 */
export function useMoveTaskToBacklog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: moveTaskToBacklog,
    onSuccess: (task) => {
      qc.setQueryData(detailKey(task.taskId), task);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/**
 * iterate-2026-05-31-reopen-done-task — re-open a done task back to the
 * Backlog (done → draft, session preserved). Mirrors useMoveTaskToBacklog:
 * the detail-cache write flips the TaskDetailHeader badge in place; the
 * LIST_KEY invalidation relocates the card to the Backlog column.
 */
export function useReopenExternalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reopenTask,
    onSuccess: (task) => {
      qc.setQueryData(detailKey(task.taskId), task);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useRenameTask() {
  const qc = useQueryClient();
  return useMutation<ExternalTask, Error, { taskId: string; title: string }>({
    mutationFn: ({ taskId, title }) => renameTask(taskId, title),
    onSuccess: (task) => {
      qc.setQueryData(detailKey(task.taskId), task);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/**
 * iterate-2026-05-18-edit-task-dialog — the Edit Task dialog's save
 * mutation. PATCHes the editable fields and, on success, writes the
 * fresh task into the detail cache + invalidates the board list so both
 * the TaskCard and the TaskDetail header reflect the edit without a
 * manual refresh (external review — cache-refresh coverage).
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation<
    ExternalTask,
    Error,
    { taskId: string; patch: TaskUpdatePatch }
  >({
    mutationFn: ({ taskId, patch }) => updateTask(taskId, patch),
    onSuccess: (task) => {
      qc.setQueryData(detailKey(task.taskId), task);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useDeleteExternalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}
