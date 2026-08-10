/*
 * Body for `mode === "new-iterate"`. Renders the iterate form:
 *   - Project picker
 *   - Title (no auto-detect hint)
 *   - AutonomyToggle (always — action-driven)
 *   - Description textarea — persists per memory
 *     `project_launch_description_needs_actionid`: description flows to the
 *     create POST body AND the launch POST body, gated by trim().length > 0.
 *     The submit hook owns that wiring; the body just renders the textarea.
 *   - Leadwright fields (opt-in)
 *   - Advanced parameters
 *   - Live CommandPreviewPanel (no phase)
 */

import { CommandPreviewPanel } from "../CommandPreviewPanel";
import { FieldLabel } from "./FieldLabel";
import { LeadwrightFieldsFragment } from "./LeadwrightFields";
import {
  ModelTierOverrideFields,
} from "./ModelTierOverrideFields";
import {
  isModelOverrideField,
  isUnsupportedModelOverrideField,
} from "./modelTierOverrideSchema";
import { MoreOptionsDisclosure } from "./MoreOptionsDisclosure";
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
import type { UseNewIssueFormReturn } from "./useNewIssueForm";

export function NewIterateModal({ form }: { form: UseNewIssueFormReturn }) {
  const modelOverrideFields = form.currentSchema.filter(isModelOverrideField);
  const remainingAdvancedFields = form.advancedFields.filter(
    (field) => !isModelOverrideField(field) && !isUnsupportedModelOverrideField(field),
  );

  return (
    <>
      <ProjectFieldFragment
        scopedProject={form.scopedProject}
        selectedProjectId={form.selectedProjectId}
        setSelectedProjectId={form.setSelectedProjectId}
        realProjects={form.realProjects}
      />
      <TitleFieldFragment title={form.title} setTitle={form.setTitle} />

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

      {/* Required params stay visible — a hidden required field would
          disable Launch with no visible cause. */}
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

      <MoreOptionsDisclosure
        open={form.moreOptionsOpen}
        onToggle={() => form.setMoreOptionsOpen((v) => !v)}
      >
        <ModelTierOverrideFields
          fields={modelOverrideFields}
          projectId={form.selectedProject?.id}
          paramValues={form.paramValues}
          setParamValues={form.setParamValues}
          setParamEnabled={form.setParamEnabled}
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
        <AdvancedParamsFragment
          requiredFields={form.requiredFields}
          advancedFields={remainingAdvancedFields}
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
          hint="generated from .shipwright-webui/actions.json · auto-updates"
        >
          <CommandPreviewPanel
            mode="new-iterate"
            title={form.title}
            description={form.description}
            projectPath={form.selectedProject?.path ?? ""}
            sessionUuid="<session-uuid>"
            autonomy={form.showAutonomyToggle ? form.autonomy : undefined}
            parameters={paramsToPreview(
              form.currentSchema,
              form.paramValues,
              form.paramEnabled,
            )}
          />
        </FieldLabel>
      </MoreOptionsDisclosure>
    </>
  );
}
