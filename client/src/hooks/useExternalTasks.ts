import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
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
import { setBoardColumn, type BoardColumn } from "../lib/boardColumnApi";

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
    // Explicit arity — `reopenTask` gained an optional `column` (board-drag-
    // done-reopen). React Query's `MutationFunction` type (v5) declares a 2nd
    // `context` param, so `mutationFn: reopenTask` fails `tsc` (context ≠
    // BoardColumn) and could forward a runtime context as `column`. Wrap so
    // only `taskId` is passed; the ⋯-menu "Reopen" omits the column, so the
    // server defaults to Backlog.
    mutationFn: (taskId: string) => reopenTask(taskId),
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

/**
 * iterate-2026-06-17-board-dnd-status-decouple — set the sticky board-column
 * override (drag-and-drop on the board). Race-safe optimistic update: the
 * ~2 s list poll can land mid-mutation, so onMutate cancels in-flight list
 * fetches, snapshots every `["external-tasks", *]` cache, and flips the
 * card's boardColumn in place; onError rolls back; onSettled invalidates.
 * This prevents the visible snap-back the external plan review flagged
 * (HIGH). For a pure column move `state` is never touched — Status ↔ Resume
 * stay decoupled (rule 23). The one exception is `reopen` (a Done card moved
 * OUT of Done — see `moveReopensTask`): that routes to /reopen, which flips
 * state → draft so the card lands UNLOCKED in the dropped column instead of
 * stranded "done" + locked (board-drag-done-reopen).
 */
export function useSetBoardColumn() {
  const qc = useQueryClient();
  return useMutation<
    ExternalTask,
    Error,
    { taskId: string; column: BoardColumn; reopen?: boolean },
    { snapshot: Array<[QueryKey, ExternalTask[] | undefined]> }
  >({
    mutationFn: ({ taskId, column, reopen }) =>
      reopen ? reopenTask(taskId, column) : setBoardColumn(taskId, column),
    onMutate: async ({ taskId, column, reopen }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const snapshot = qc.getQueriesData<ExternalTask[]>({ queryKey: LIST_KEY });
      for (const [key, list] of snapshot) {
        if (!list) continue;
        // On reopen, optimistically flip state→draft too so the card un-locks
        // immediately (no "done"-in-In-Progress flash before the round-trip).
        qc.setQueryData<ExternalTask[]>(
          key,
          list.map((t) =>
            t.taskId === taskId
              ? { ...t, boardColumn: column, ...(reopen ? { state: "draft" as const } : {}) }
              : t,
          ),
        );
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, list]) => qc.setQueryData(key, list));
    },
    onSuccess: (task) => {
      qc.setQueryData(detailKey(task.taskId), task);
    },
    onSettled: () => {
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
