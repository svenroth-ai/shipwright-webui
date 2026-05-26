/*
 * Body for `mode === "new-plain"`. Plain Claude (no skill, no slash command).
 *
 * v0.4.0: project picker + title + description only. No phase, no autonomy,
 * no params, no leadwright. Submit still goes through the same hook so
 * the createPayload / launchBody shape is identical to other modes for
 * all keys that apply (title / cwd / pluginDirs / projectId / actionId
 * / description?).
 */

import {
  DescriptionFieldFragment,
  ProjectFieldFragment,
  TitleFieldFragment,
} from "./SimpleFields";
import type { UseNewIssueFormReturn } from "./useNewIssueForm";

export function NewPlainModal({ form }: { form: UseNewIssueFormReturn }) {
  return (
    <>
      <ProjectFieldFragment
        scopedProject={form.scopedProject}
        selectedProjectId={form.selectedProjectId}
        setSelectedProjectId={form.setSelectedProjectId}
        realProjects={form.realProjects}
      />
      <TitleFieldFragment title={form.title} setTitle={form.setTitle} />
      <DescriptionFieldFragment
        description={form.description}
        setDescription={form.setDescription}
      />
    </>
  );
}
