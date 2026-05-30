import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ChevronRight, ChevronDown } from 'lucide-react';
import { StepIndicator } from './StepIndicator';
import { ProjectInfoStep } from './ProjectInfoStep';
import { StackProfileStep } from './StackProfileStep';
import { EnvVarsStep } from './EnvVarsStep';
import { ConfirmationStep } from './ConfirmationStep';
import { ProjectColorPicker } from './ProjectColorPicker';
import { useCreateProject } from '../../hooks/useCreateProject';
import {
  useSaveActionsStub,
  useUploadActionsJson,
} from '../../hooks/useProjectActions';
import { useSettings } from '../../hooks/useSettings';
import { readFileAsText } from '../../lib/readFile';
import { formatUploadError } from '../../lib/actionsUpload';

interface ProjectWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOCS_ACTIONS_URL = 'https://github.com/svenroth-ai/shipwright#actions-schema';

/** Section 03 (iterate 3) — "Which workflow plugin?" radio options. */
type WorkflowChoice = 'shipwright' | 'custom';

/**
 * ProjectWizard — Phase B5 chrome rebuild (iterate 3.7b-5, 2026-04-20).
 *
 * Mockup: webui/designs/screens/05-project-wizard.html.
 *
 * Visual-only refactor:
 *   - Modal uses warm-beige `--color-surface` + `--shadow-card` + `--radius-card`.
 *   - Header padding = 24px 28px; title is `text-xl font-semibold`.
 *   - All legacy `text-gray-*` / `bg-gray-*` / `border-gray-*` utilities were
 *     swapped for `--color-muted` / `--color-muted-bg` / `--color-border`.
 *   - Advanced-options accordion: hand-rolled controlled disclosure (no
 *     Radix Collapsible — `@radix-ui/react-collapsible` is NOT in
 *     package.json and Phase B5 forbids adding deps). Closed shows a
 *     chevron-right and muted-hover-primary label; open shows chevron-down
 *     plus a `--color-muted-bg` content pane with 12px padding.
 *
 * Step flow, validation, submit handler and workflow-choice semantics are
 * UNCHANGED from iterate 3.3 — purely cosmetic refactor.
 */
export function ProjectWizard({ open, onOpenChange }: ProjectWizardProps) {
  const { data: settings } = useSettings();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [profile, setProfile] = useState(settings?.defaultProfile ?? 'custom');
  // Iterate 3.7e-b3 — project color. `null` === "Auto" (hash-derived).
  const [color, setColor] = useState<string | null>(null);
  // Section 03 — workflow choice lives in the wizard's Confirmation step
  // behind a "Show advanced options" accordion. Default is "shipwright" so
  // the overwhelming majority never sees the toggle. "custom" writes an
  // empty .shipwright-webui/actions.json stub + opens the docs page.
  const [workflowChoice, setWorkflowChoice] = useState<WorkflowChoice>('shipwright');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Iterate iterate-20260501-wizard-actions-upload — when workflowChoice
  // is "custom" the user can optionally drop their own actions.json
  // here, instead of waiting for the empty-stub flow + Settings round-trip.
  const [pendingActionsFile, setPendingActionsFile] = useState<File | null>(null);
  const [pendingActionsError, setPendingActionsError] = useState<string | null>(null);
  const [postCreateError, setPostCreateError] = useState<string | null>(null);
  const createProject = useCreateProject();
  const saveStub = useSaveActionsStub();
  const uploadActions = useUploadActionsJson();

  function handleNext() {
    if (step < 3) setStep(step + 1);
  }

  function handleBack() {
    if (step > 0) setStep(step - 1);
  }

  function handleCreate() {
    setPostCreateError(null);
    createProject.mutate(
      {
        name,
        path,
        profile,
        // Iterate 3.7e-b3 — include `settings.color` in the POST body
        // iff the user picked a preset. "Auto" (color === null) sends
        // nothing so the server keeps `settings` minimal.
        ...(color ? { settings: { color } } : {}),
      },
      {
        onSuccess: async (created) => {
          // Section 03 — Custom branch writes the .shipwright-webui/actions.json stub
          // on the just-created project and pops the docs page.
          // iterate-20260501 — when the user picked a file in the advanced
          // step, upload that instead of writing the empty stub. Server
          // validation runs the same pipeline as Settings (JSON-parse +
          // schema + placeholder dry-run); if the upload fails, the
          // project still exists — surface the error and keep the wizard
          // open so the user can pick another file or skip to Settings.
          if (workflowChoice === 'custom') {
            if (pendingActionsFile) {
              try {
                const text = await readFileAsText(pendingActionsFile);
                await uploadActions.mutateAsync({
                  projectId: created.id,
                  jsonContent: text,
                });
              } catch (err) {
                setPostCreateError(
                  `Project created, but actions.json upload failed: ${formatUploadError(err)}. Fix the file and retry from Settings.`,
                );
                return; // keep wizard open
              }
            } else {
              try {
                await saveStub.mutateAsync({ projectId: created.id });
                if (typeof window !== 'undefined') {
                  window.open(DOCS_ACTIONS_URL, '_blank', 'noopener,noreferrer');
                }
              } catch (err) {
                // Non-fatal — the project is created; the user can re-trigger
                // the stub later via Settings. Log and continue closing.
                console.error('saveActionsStub failed', err);
              }
            }
          }
          onOpenChange(false);
          resetForm();
        },
      },
    );
  }

  async function handleActionsFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-picking the same file after a fix
    setPendingActionsError(null);
    setPostCreateError(null);
    if (!file) {
      setPendingActionsFile(null);
      return;
    }
    if (file.size > 256 * 1024) {
      setPendingActionsError(
        `File is ${file.size.toLocaleString()} bytes; the limit is ${(256 * 1024).toLocaleString()} bytes.`,
      );
      setPendingActionsFile(null);
      return;
    }
    // Pre-flight JSON parse so the user gets feedback before clicking
    // Create. Server still validates schema + placeholders on upload.
    try {
      const text = await readFileAsText(file);
      JSON.parse(text);
    } catch (err) {
      setPendingActionsError(
        `Could not read or parse JSON: ${String(err).slice(0, 200)}`,
      );
      setPendingActionsFile(null);
      return;
    }
    setPendingActionsFile(file);
  }

  function resetForm() {
    setStep(0);
    setName('');
    setPath('');
    setProfile('custom');
    setColor(null);
    setWorkflowChoice('shipwright');
    setShowAdvanced(false);
    setPendingActionsFile(null);
    setPendingActionsError(null);
    setPostCreateError(null);
    createProject.reset();
    saveStub.reset();
    uploadActions.reset();
  }

  // iterate-20260501 — block Create when the picked actions.json failed
  // pre-flight parse. Other steps just require name + path on step 0.
  const canProceed =
    step === 0
      ? !!(name.trim() && path.trim())
      : step === 3
        ? !pendingActionsError
        : true;
  const isLastStep = step === 3;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-40" />
        <Dialog.Content
          data-testid="wizard-modal"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--color-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] w-full max-w-[560px] max-h-[90vh] overflow-hidden flex flex-col z-50"
        >
          {/* Header — 24px 28px padding per mockup; 20px semibold title. */}
          <div className="flex items-center justify-between px-7 pt-6">
            <Dialog.Title className="text-xl font-semibold text-[var(--color-text)] tracking-tight">
              New Project
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Create a new Shipwright project
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          {/* Step indicator — separate component, mockup-faithful 10px dots. */}
          <StepIndicator currentStep={step} />

          {/* Body — flex-1 so footer sticks, min-height keeps step switches stable. */}
          <div className="px-7 py-6 flex-1 overflow-y-auto min-h-[200px]">
            {step === 0 && (
              <ProjectInfoStep
                name={name}
                path={path}
                onNameChange={setName}
                onPathChange={setPath}
              />
            )}
            {step === 1 && (
              <StackProfileStep profile={profile} onProfileChange={setProfile} />
            )}
            {step === 2 && <EnvVarsStep profile={profile} />}
            {step === 3 && (
              <>
                <ConfirmationStep name={name} path={path} profile={profile} />

                {/* Iterate 3.7e-b3 — error banner shown on create failure.
                    Dialog stays open; user can tweak + retry. role="alert"
                    so screen readers announce the failure immediately. */}
                {createProject.error && (
                  <div
                    data-testid="wizard-create-error"
                    role="alert"
                    className="mt-4 rounded-[var(--radius-button)] border px-4 py-3 text-[13px]"
                    style={{
                      background: 'var(--color-error-bg)',
                      borderColor: 'var(--color-error)',
                      color: 'var(--color-error)',
                    }}
                  >
                    <strong className="font-semibold">
                      Couldn't create project:
                    </strong>{' '}
                    {createProject.error instanceof Error
                      ? createProject.error.message
                      : String(createProject.error)}
                  </div>
                )}

                {/* Iterate 3.7e-b3 — color picker on the confirmation step
                    so it's the last choice before Create. Avoids cluttering
                    the identity / profile / env-var earlier steps. */}
                <div className="mt-4" data-testid="wizard-color-section">
                  <ProjectColorPicker
                    value={color}
                    onChange={setColor}
                    testidPrefix="wizard-color-swatch"
                  />
                </div>

                {/* Section 03 — Workflow plugin selection, behind an
                    accordion so the defaults-first path is frictionless (G2).
                    Hand-rolled Collapsible (no Radix) — see file header. */}
                <div
                  className="mt-4"
                  data-testid="wizard-advanced-accordion"
                  data-open={showAdvanced ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    aria-expanded={showAdvanced}
                    aria-controls="wizard-advanced-panel"
                    className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-primary)] transition-colors select-none"
                  >
                    {showAdvanced ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
                  </button>
                  {showAdvanced && (
                    <div
                      id="wizard-advanced-panel"
                      className="mt-3 rounded-[var(--radius-button)] bg-[var(--color-muted-bg)] p-3"
                    >
                      <div className="space-y-3" data-testid="wizard-workflow-choice">
                        <p className="text-xs font-medium text-[var(--color-text)]">
                          Which workflow plugin?
                        </p>
                        <label className="flex items-start gap-2 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs cursor-pointer hover:border-[var(--color-accent)] transition-colors">
                          <input
                            type="radio"
                            name="workflow-choice"
                            checked={workflowChoice === 'shipwright'}
                            onChange={() => setWorkflowChoice('shipwright')}
                            data-testid="wizard-workflow-shipwright"
                            className="mt-0.5 accent-[var(--color-primary)]"
                          />
                          <span>
                            <strong className="font-semibold text-[var(--color-text)]">
                              Shipwright (recommended)
                            </strong>
                            <br />
                            <span className="text-[var(--color-muted)]">
                              Use the bundled actions preset — 3 actions, 9 phases, preview gate.
                            </span>
                          </span>
                        </label>
                        <label className="flex items-start gap-2 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs cursor-pointer hover:border-[var(--color-accent)] transition-colors">
                          <input
                            type="radio"
                            name="workflow-choice"
                            checked={workflowChoice === 'custom'}
                            onChange={() => setWorkflowChoice('custom')}
                            data-testid="wizard-workflow-custom"
                            className="mt-0.5 accent-[var(--color-primary)]"
                          />
                          <span>
                            <strong className="font-semibold text-[var(--color-text)]">
                              Custom
                            </strong>
                            <br />
                            <span className="text-[var(--color-muted)]">
                              Write your own{' '}
                              <code className="rounded bg-[var(--color-muted-bg)] px-1 font-mono">
                                .shipwright-webui/actions.json
                              </code>
                              . An empty structured stub is created on project creation; docs open in a new tab.
                            </span>
                          </span>
                        </label>

                        {/* iterate-20260501 — optional upload-now path. Only
                            offered when "Custom" is the active radio so the
                            shipwright-default flow stays distraction-free. */}
                        {workflowChoice === 'custom' && (
                          <div
                            data-testid="wizard-actions-upload"
                            className="rounded-[var(--radius-button)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
                          >
                            <p className="text-xs text-[var(--color-muted)]">
                              Optional: upload your{' '}
                              <code className="rounded bg-[var(--color-muted-bg)] px-1 font-mono">
                                actions.json
                              </code>{' '}
                              now. If you skip this, an empty stub is written and you can
                              upload later from Settings.
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <label
                                className="inline-flex items-center text-xs font-semibold text-[var(--color-text)]"
                                style={{
                                  padding: '6px 10px',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-button)',
                                  background: 'var(--color-surface)',
                                  cursor: 'pointer',
                                }}
                              >
                                Choose file…
                                <input
                                  type="file"
                                  accept="application/json,.json"
                                  onChange={handleActionsFilePick}
                                  data-testid="wizard-actions-file"
                                  style={{ display: 'none' }}
                                />
                              </label>
                              {pendingActionsFile ? (
                                <span
                                  data-testid="wizard-actions-filename"
                                  className="text-xs text-[var(--color-text)] truncate"
                                  title={pendingActionsFile.name}
                                  style={{ maxWidth: '260px' }}
                                >
                                  ✓ {pendingActionsFile.name}
                                </span>
                              ) : (
                                <span className="text-xs text-[var(--color-muted)]">
                                  No file selected
                                </span>
                              )}
                              {pendingActionsFile && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingActionsFile(null);
                                    setPendingActionsError(null);
                                  }}
                                  data-testid="wizard-actions-clear"
                                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors"
                                >
                                  remove
                                </button>
                              )}
                            </div>
                            {pendingActionsError && (
                              <div
                                data-testid="wizard-actions-pre-error"
                                role="alert"
                                className="mt-2 rounded-[var(--radius-button)] border px-2.5 py-2 text-xs"
                                style={{
                                  background: 'var(--color-error-bg)',
                                  borderColor: 'var(--color-error)',
                                  color: 'var(--color-error)',
                                }}
                              >
                                {pendingActionsError}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {postCreateError && (
                  <div
                    data-testid="wizard-actions-upload-error"
                    role="alert"
                    className="mt-4 rounded-[var(--radius-button)] border px-4 py-3 text-[13px]"
                    style={{
                      background: 'var(--color-error-bg)',
                      borderColor: 'var(--color-error)',
                      color: 'var(--color-error)',
                    }}
                  >
                    {postCreateError}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer — 0 28px 24px per mockup. Cancel/Back on the left pattern
              from the mockup (Back replaces Cancel from step 2 onward), primary
              Next / Create on the right. */}
          <div className="flex items-center justify-end gap-2.5 px-7 pb-6">
            <button
              data-testid="wizard-back"
              type="button"
              onClick={step === 0 ? () => onOpenChange(false) : handleBack}
              className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-muted-bg)] hover:border-[var(--color-accent)] transition-colors"
            >
              {step === 0 ? 'Cancel' : 'Back'}
            </button>
            <button
              data-testid="wizard-next"
              type="button"
              disabled={!canProceed || createProject.isPending}
              onClick={isLastStep ? handleCreate : handleNext}
              className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-primary)]"
            >
              {isLastStep
                ? createProject.isPending
                  ? 'Creating...'
                  : 'Create Project'
                : 'Next'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
