/*
 * Body for `mode === "generic"`. Custom action from .shipwright-webui/actions.json.
 *
 * No phase, no autonomy, no leadwright UI (the action-driven gating reads
 * `modal_fields` so a custom action CAN opt in — but bundled wording for
 * leadwright UI is Shipwright-specific, so we conservatively keep the
 * fields enabled only when the action declares modal_fields explicitly).
 *
 * Command preview is a STATIC hint, not the live CommandPreviewPanel,
 * because the live panel hardcodes the Shipwright slash shapes.
 * The TaskDetail page renders the actual generated command after Launch
 * (the source of truth).
 *
 * Launch POSTs the real `action.id` (e.g. "new-content-orchestrator")
 * so the server resolves the right `command_template`.
 */

import { CommandPreviewPanel } from "../CommandPreviewPanel";
import { FieldLabel } from "./FieldLabel";
import { LeadwrightFieldsFragment } from "./LeadwrightFields";
import { MoreOptionsDisclosure } from "./MoreOptionsDisclosure";
import { paramsToPreview } from "./paramHelpers";
import {
  AdvancedParamsFragment,
  RequiredParamsFragment,
} from "./ParamSections";
import {
  DescriptionFieldFragment,
  ProjectFieldFragment,
  TitleFieldFragment,
} from "./SimpleFields";
import type { UseNewIssueFormReturn } from "./useNewIssueForm";

// CommandPreviewPanel kept imported but unused intentionally — generic
// mode replaces it with a static hint. Mark with void to silence the
// no-unused-import lint without restructuring.
void CommandPreviewPanel;
void paramsToPreview;

export function NewGenericModal({ form }: { form: UseNewIssueFormReturn }) {
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
          hint="generated from action.command_template at Launch"
        >
          <div
            data-testid="command-preview-generic"
            className="rounded-[var(--radius-button,8px)] border-[1.5px] border-dashed border-[var(--color-border,#e0dbd4)] bg-white px-3 py-3 text-[12px] leading-[1.55] text-[var(--color-muted,#6b7280)]"
          >
            The exact command is generated server-side from this action's{" "}
            <code className="rounded-[3px] bg-white px-1 py-0.5 font-mono text-[11px]">
              command_template
            </code>{" "}
            in{" "}
            <code className="rounded-[3px] bg-white px-1 py-0.5 font-mono text-[11px]">
              .shipwright-webui/actions.json
            </code>
            . It will appear on the TaskDetail page after Launch.
          </div>
        </FieldLabel>
      </MoreOptionsDisclosure>
    </>
  );
}
