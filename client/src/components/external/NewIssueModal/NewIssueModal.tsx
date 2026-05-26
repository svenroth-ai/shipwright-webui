/*
 * Top-level dispatcher for the NewIssueModal/ directory. Public surface
 * preserved: `import { NewIssueModal } from "./NewIssueModal"` still works
 * for both call-sites (TaskBoardPage, TriagePage) — index.tsx re-exports.
 *
 * Architecture:
 *   - Instantiates `useNewIssueForm` ONCE per modal lifetime (so the
 *     reset-on-open ref + classifyPhase debounce + schema-seed all live
 *     in one place).
 *   - Picks the body component by `mode`.
 *   - Wraps the chosen body in `<ModalShell>` (Radix Dialog + header + footer).
 *   - The body is keyed by `action?.id` so a mid-open action change
 *     remounts the body (preserving fresh-state-on-mode-switch — Step 3.5
 *     review Gemini #5). The hook itself stays mounted; the body just
 *     re-renders from scratch.
 *
 * Step 3.5 review OpenAI #2: lifecycle reset (open/close/reopen) goes
 * through the hook's reset-on-open effect; tests pin this in
 * NewIssueModal.test.tsx.
 */

import { NewGenericModal } from "./NewGenericModal";
import { NewIterateModal } from "./NewIterateModal";
import { NewPipelineModal } from "./NewPipelineModal";
import { NewPlainModal } from "./NewPlainModal";
import { NewTaskModal } from "./NewTaskModal";
import { ModalShell } from "./ModalShell";
import type { NewIssueModalProps } from "./types";
import { useNewIssueForm } from "./useNewIssueForm";

export type { NewIssueModalProps };

export function NewIssueModal(props: NewIssueModalProps) {
  const form = useNewIssueForm(props);

  if (!props.action) return null;

  let body;
  switch (form.mode) {
    case "new-task":
      body = <NewTaskModal key={props.action.id} form={form} />;
      break;
    case "new-pipeline":
      body = <NewPipelineModal key={props.action.id} form={form} />;
      break;
    case "new-iterate":
      body = <NewIterateModal key={props.action.id} form={form} />;
      break;
    case "new-plain":
      body = <NewPlainModal key={props.action.id} form={form} />;
      break;
    case "generic":
    default:
      body = <NewGenericModal key={props.action.id} form={form} />;
      break;
  }

  return (
    <ModalShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      mode={form.mode}
      action={props.action}
      palette={form.palette}
      canSubmit={form.canSubmit}
      submitting={form.submitting}
      error={form.error}
      onSubmit={form.onSubmit}
    >
      {body}
    </ModalShell>
  );
}
