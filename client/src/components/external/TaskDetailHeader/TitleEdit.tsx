/*
 * TitleEdit — extracted from TaskDetailHeader (Campaign C / C6).
 *
 * Thin forwardRef wrapper around `EditableTaskTitle`. Owned concerns:
 *   - exposes `startEdit` via imperative handle so the shell can pass
 *     the ref to HeaderMenu's "Rename" item.
 *
 * Per C6 plan-review finding OAI-4 / GEM-3: ref ownership stays in the
 * shell (owned by the shell's `titleRef`), passed down via `forwardRef`.
 * HeaderMenu receives an `onRename` callback (the shell's
 * `titleRef.current?.startEdit()`).
 *
 * No new wrapping DOM node is introduced — TitleEdit returns whatever
 * `EditableTaskTitle` returns. The interactor + title sit on the same
 * flex row as the StateBadge sibling (GEM-1 — preserved DOM nesting).
 *
 * The actual editing UX (ENTER commits, ESC reverts, blur saves,
 * length-200 cap, server PATCH via useRenameTask) lives in
 * `EditableTaskTitle.tsx` — TitleEdit deliberately does NOT duplicate
 * that logic. Tests below assert the wrapper passes through.
 */
import { forwardRef } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import {
  EditableTaskTitle,
  type EditableTaskTitleHandle,
} from "../EditableTaskTitle";

export type TitleEditHandle = EditableTaskTitleHandle;

export interface TitleEditProps {
  task: ExternalTask;
}

export const TitleEdit = forwardRef<TitleEditHandle, TitleEditProps>(
  function TitleEdit({ task }, ref) {
    return <EditableTaskTitle ref={ref} task={task} />;
  },
);
