/*
 * Body for `mode === "new-task"`. Renders the full task form:
 *   - Project picker (context strip OR dropdown)
 *   - Title (with auto-detects phase hint)
 *   - Phase dropdown (with auto-detected hint line + manual-override CTA)
 *   - Phase-aware AutonomyToggle (only when currentPhase.supports_autonomy)
 *   - Description textarea
 *   - Leadwright fields (opt-in via action.modal_fields)
 *   - Required + Advanced parameter sections (schema-driven)
 *   - Live CommandPreviewPanel
 */

import type { UseNewIssueFormReturn } from "./useNewIssueForm";
import { CommandPreviewPanel } from "../CommandPreviewPanel";
import { FieldLabel } from "./FieldLabel";
import { LeadwrightFieldsFragment } from "./LeadwrightFields";
import { PhaseDropdown } from "./PhaseDropdown";
import { paramsToPreview } from "./paramHelpers";
import {
  AdvancedParamsFragment,
  RequiredParamsFragment,
} from "./ParamSections";
import {
  AutonomyFieldFragment,
  DescriptionFieldFragment,
  ProjectFieldFragment,
  TitleFieldFragment,
} from "./SimpleFields";

export function NewTaskModal({ form }: { form: UseNewIssueFormReturn }) {
  const showAutoHint = true; // task mode always shows the hint per FR.
  return (
    <>
      <ProjectFieldFragment
        scopedProject={form.scopedProject}
        selectedProjectId={form.selectedProjectId}
        setSelectedProjectId={form.setSelectedProjectId}
        realProjects={form.realProjects}
      />
      <TitleFieldFragment
        title={form.title}
        setTitle={form.setTitle}
        showAutoHint={showAutoHint}
      />

      {form.phases.length > 0 && (
        <FieldLabel label="Phase" hint="from this project's actions.json">
          <PhaseDropdown
            phases={form.phases}
            value={form.phaseId}
            onChange={(id) => {
              form.setPhaseId(id);
              form.setPhaseOverridden(true);
            }}
          />
          {!form.phaseOverridden && form.currentPhase && (
            <div
              className="flex items-center gap-1.5 pl-0.5 text-[11px] text-[var(--color-muted,#6b7280)]"
              data-testid="new-issue-phase-autohint"
            >
              <span>Auto-detected from title:</span>
              <strong className="font-medium text-[var(--color-text,#1a1a1a)]">
                {form.detectedTrigger
                  ? `"${form.detectedTrigger}" → ${form.currentPhase.label}`
                  : form.currentPhase.label}
              </strong>
              <span>.</span>
              <button
                type="button"
                data-testid="new-issue-phase-override"
                onClick={() => form.setPhaseOverridden(true)}
                className="border-b border-dotted border-[var(--color-primary,#6b5e56)] text-[var(--color-primary,#6b5e56)]"
              >
                manually override
              </button>
            </div>
          )}
        </FieldLabel>
      )}

      {form.showAutonomyToggle && (
        <AutonomyFieldFragment
          autonomy={form.autonomy}
          setAutonomy={form.setAutonomy}
        />
      )}

      <DescriptionFieldFragment
        description={form.description}
        setDescription={form.setDescription}
      />

      <LeadwrightFieldsFragment
        showLeadDomain={form.showLeadDomain}
        showLeadPriority={form.showLeadPriority}
        showLeadComplexityHint={form.showLeadComplexityHint}
        showLeadTags={form.showLeadTags}
        showLeadBlockedBy={form.showLeadBlockedBy}
        leadDomain={form.leadDomain}
        setLeadDomain={form.setLeadDomain}
        leadPriority={form.leadPriority}
        setLeadPriority={form.setLeadPriority}
        leadComplexityHint={form.leadComplexityHint}
        setLeadComplexityHint={form.setLeadComplexityHint}
        leadTagsRaw={form.leadTagsRaw}
        setLeadTagsRaw={form.setLeadTagsRaw}
        leadBlockedByRaw={form.leadBlockedByRaw}
        setLeadBlockedByRaw={form.setLeadBlockedByRaw}
      />

      <RequiredParamsFragment
        requiredFields={form.requiredFields}
        advancedFields={form.advancedFields}
        paramValues={form.paramValues}
        setParamValues={form.setParamValues}
        revealedSecrets={form.revealedSecrets}
        setRevealedSecrets={form.setRevealedSecrets}
        paramEnabled={form.paramEnabled}
        onParamEnableToggle={form.onParamEnableToggle}
        advancedOpen={form.advancedOpen}
        setAdvancedOpen={form.setAdvancedOpen}
      />
      <AdvancedParamsFragment
        requiredFields={form.requiredFields}
        advancedFields={form.advancedFields}
        paramValues={form.paramValues}
        setParamValues={form.setParamValues}
        revealedSecrets={form.revealedSecrets}
        setRevealedSecrets={form.setRevealedSecrets}
        paramEnabled={form.paramEnabled}
        onParamEnableToggle={form.onParamEnableToggle}
        advancedOpen={form.advancedOpen}
        setAdvancedOpen={form.setAdvancedOpen}
      />

      <FieldLabel
        label="Command preview"
        hint="phase drives the slash command · auto-runs in the embedded terminal on Launch"
      >
        <CommandPreviewPanel
          mode="new-task"
          title={form.title}
          description={form.description}
          projectPath={form.selectedProject?.path ?? ""}
          sessionUuid="<session-uuid>"
          autonomy={form.showAutonomyToggle ? form.autonomy : undefined}
          phaseId={form.phaseId}
          phaseLabel={form.currentPhase?.label}
          parameters={paramsToPreview(
            form.currentSchema,
            form.paramValues,
            form.paramEnabled,
          )}
        />
      </FieldLabel>
    </>
  );
}
