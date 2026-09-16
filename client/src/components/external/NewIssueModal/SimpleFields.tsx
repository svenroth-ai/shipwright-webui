/*
 * Small presentational fragments used by every body component:
 *   - ProjectFieldFragment — context strip or project selector
 *   - TitleFieldFragment   — title input with optional auto-detect hint
 *   - DescriptionFieldFragment — textarea
 *   - AutonomyFieldFragment    — AutonomyToggle wrapper
 *   - RuntimeFieldFragment     — RuntimeToggle wrapper (Codex Light §3.5)
 *
 * Each fragment is a thin wrapper over an already-extracted primitive.
 */

import type { Dispatch, SetStateAction } from "react";

import { AutonomyToggle, type AutonomyValue } from "../AutonomyToggle";
import { RuntimeToggle, type RuntimeValue } from "../RuntimeToggle";
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
        className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--surface-form-line,#847a75)] bg-white px-3 py-2 text-[13px] pointer-coarse:text-[16px]"
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
        className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--surface-form-line,#847a75)] bg-white px-3 py-2 text-[13px] pointer-coarse:text-[16px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
        autoFocus
        required
      />
    </FieldLabel>
  );
}

// Mirrors the server's DESCRIPTION_MAX_LENGTH (server/src/external/_shared/
// helpers.ts) — a description longer than this risks the launch command
// exceeding the shell's interactive line-length limit, so the server
// rejects it with 400 regardless. This client-side cap just surfaces that
// limit before the user hits it, instead of after submit.
export const DESCRIPTION_MAX_LENGTH = 6_000;

export function DescriptionFieldFragment({
  description,
  setDescription,
  runtime,
}: {
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  /** Codex Light §3.5 — the hint names whichever runtime this task will
   *  actually run under. Defaults to Claude for callers that don't yet
   *  carry a runtime value (e.g. pre-Codex-Light form fixtures). */
  runtime?: RuntimeValue;
}) {
  const runtimeLabel = runtime === "codex" ? "Codex" : "Claude";
  return (
    <FieldLabel
      label="Description"
      hint={`optional — becomes the first prompt ${runtimeLabel} sees · ${description.length}/${DESCRIPTION_MAX_LENGTH}`}
    >
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        data-testid="new-issue-description-input"
        placeholder="What needs to be done? Link files, paste errors, reference FRs…"
        maxLength={DESCRIPTION_MAX_LENGTH}
        className="min-h-[108px] w-full resize-y rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--surface-form-line,#847a75)] bg-white px-3 py-2 text-[13px] pointer-coarse:text-[16px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
      />
    </FieldLabel>
  );
}

// Codex Light §3 — AutonomyToggle's default copy is Claude-specific
// ("AskUser"). Codex's own mapping (runtime-chokepoint.ts's
// `buildCodexCommands`): Guided enables `default_mode_request_user_input`
// plus `approval_policy=on-request`/`approvals.reviewer=user` (Codex asks
// before acting or when it needs input); Autonomous passes `--yolo` (no
// approval prompts at all).
const CODEX_GUIDED_HINT = (
  <>
    <strong>Guided</strong>: Codex asks before it acts or when it needs your
    input — you respond in the terminal. Slower, full oversight.
  </>
);
const CODEX_AUTONOMOUS_HINT = (
  <>
    <strong>Autonomous</strong>: Codex runs without asking for approval
    (<code>--yolo</code>). Fastest; good for well-scoped work you trust to
    its spec.
  </>
);

export function AutonomyFieldFragment({
  autonomy,
  setAutonomy,
  runtime,
}: {
  autonomy: AutonomyValue;
  setAutonomy: Dispatch<SetStateAction<AutonomyValue>>;
  /** Codex Light §3.5 — swaps in Codex-accurate hint copy when set. */
  runtime?: RuntimeValue;
}) {
  return (
    <FieldLabel label="Autonomy">
      <AutonomyToggle
        value={autonomy}
        onChange={setAutonomy}
        {...(runtime === "codex"
          ? { guidedHint: CODEX_GUIDED_HINT, autonomousHint: CODEX_AUTONOMOUS_HINT }
          : {})}
      />
    </FieldLabel>
  );
}

export function RuntimeFieldFragment({
  runtime,
  setRuntime,
}: {
  runtime: RuntimeValue;
  setRuntime: Dispatch<SetStateAction<RuntimeValue>>;
}) {
  return (
    <FieldLabel label="Runtime">
      <RuntimeToggle value={runtime} onChange={setRuntime} />
    </FieldLabel>
  );
}
