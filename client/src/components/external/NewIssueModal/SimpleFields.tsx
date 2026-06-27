/*
 * Small presentational fragments used by every body component:
 *   - ProjectFieldFragment — context strip or project selector
 *   - TitleFieldFragment   — title input with optional auto-detect hint
 *   - DescriptionFieldFragment — textarea
 *   - AutonomyFieldFragment    — AutonomyToggle wrapper
 *
 * Each fragment is a thin wrapper over an already-extracted primitive.
 */

import type { Dispatch, SetStateAction } from "react";

import { AutonomyToggle, type AutonomyValue } from "../AutonomyToggle";
import { ProjectContextStrip } from "../ProjectContextStrip";
import type { Project } from "../../../types";

import { FieldLabel } from "./FieldLabel";

export function ProjectFieldFragment({
  scopedProject,
  selectedProjectId,
  setSelectedProjectId,
  realProjects,
}: {
  scopedProject: Project | undefined;
  selectedProjectId: string;
  setSelectedProjectId: Dispatch<SetStateAction<string>>;
  realProjects: Project[];
}) {
  if (scopedProject) {
    return (
      <ProjectContextStrip
        name={scopedProject.name}
        color={scopedProject.settings?.color}
        path={scopedProject.path}
      />
    );
  }
  return (
    <FieldLabel label="Project" required>
      <select
        value={selectedProjectId}
        onChange={(e) => setSelectedProjectId(e.target.value)}
        data-testid="new-issue-project-select"
        className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-white px-3 py-2 text-[13px] pointer-coarse:text-[16px]"
        required
      >
        <option value="">Select project…</option>
        {realProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

export function TitleFieldFragment({
  title,
  setTitle,
  showAutoHint,
}: {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  showAutoHint?: boolean;
}) {
  return (
    <FieldLabel
      label="Title"
      required
      hint={showAutoHint ? "auto-detects phase" : undefined}
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        data-testid="new-issue-title-input"
        placeholder="e.g. Fix login redirect bug"
        className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] px-3 py-2 text-[13px] pointer-coarse:text-[16px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
        autoFocus
        required
      />
    </FieldLabel>
  );
}

export function DescriptionFieldFragment({
  description,
  setDescription,
}: {
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
}) {
  return (
    <FieldLabel
      label="Description"
      hint="optional — becomes the first prompt Claude sees"
    >
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        data-testid="new-issue-description-input"
        placeholder="What needs to be done? Link files, paste errors, reference FRs…"
        className="min-h-[108px] w-full resize-y rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] px-3 py-2 text-[13px] pointer-coarse:text-[16px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
      />
    </FieldLabel>
  );
}

export function AutonomyFieldFragment({
  autonomy,
  setAutonomy,
}: {
  autonomy: AutonomyValue;
  setAutonomy: Dispatch<SetStateAction<AutonomyValue>>;
}) {
  return (
    <FieldLabel label="Autonomy">
      <AutonomyToggle value={autonomy} onChange={setAutonomy} />
    </FieldLabel>
  );
}
