import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { NewIssueModal } from "./NewIssueModal";
import type {
  ActionDefinition,
  ResolvedProjectActions,
} from "../../lib/externalApi";

const PIPELINE_ACTION: ActionDefinition = {
  id: "new-pipeline",
  label: "New pipeline",
  kind: "external_launch",
  command_template: "claude /shipwright-run",
};
const TASK_ACTION: ActionDefinition = {
  id: "new-task",
  label: "New task",
  kind: "external_launch",
  command_template: "claude /shipwright-{task.phase}",
};

const SAMPLE_ACTIONS: ResolvedProjectActions = {
  actions: [TASK_ACTION, PIPELINE_ACTION],
  phases: [
    { id: "build", label: "Build" },
    { id: "design", label: "Design" },
  ],
  defaults: { autonomy: "guided" },
  preview: {
    enabled: false,
    command: null,
    port: null,
    ready_path: null,
    ready_timeout_seconds: null,
  },
  diagnostics: [],
};

interface RenderModalOpts {
  /** Optional override for seeded projects[] in the React Query cache. */
  projectsOverride?: Array<Record<string, unknown>>;
}

function renderModal(
  overrides: Partial<React.ComponentProps<typeof NewIssueModal>> & RenderModalOpts = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { projectsOverride, ...props_ } = overrides;
  // Mock useProjects list via the fetch layer — but useProjects queries
  // `/projects`. Seed the query cache directly so we skip the network.
  qc.setQueryData(
    ["projects"],
    projectsOverride ?? [
      {
        id: "proj-1",
        name: "demo",
        path: "/tmp/demo",
        profile: "supabase-nextjs",
        status: "active",
        createdAt: "2026-04-01",
        lastActive: "2026-04-20",
      },
    ],
  );
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    action: TASK_ACTION,
    projectActions: SAMPLE_ACTIONS,
    ...props_,
  };
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <NewIssueModal {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("NewIssueModal", () => {
  it("renders with mode=new-task by default", () => {
    renderModal();
    expect(screen.getByTestId("new-issue-modal-new-task")).toBeTruthy();
    expect(screen.getByText("New Task")).toBeTruthy();
  });

  it("renders mode=new-pipeline with the AutonomyToggle", () => {
    renderModal({ action: PIPELINE_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-pipeline")).toBeTruthy();
    expect(screen.getByTestId("autonomy-toggle")).toBeTruthy();
  });

  it("Task mode does NOT render the AutonomyToggle (FR-03.72)", () => {
    renderModal({ action: TASK_ACTION });
    expect(screen.queryByTestId("autonomy-toggle")).toBeNull();
  });

  it("footer is exactly 'Esc to cancel' (FR-03.92)", () => {
    renderModal();
    const hint = screen.getByTestId("new-issue-footer-hint");
    expect(hint.textContent?.replace(/\s+/g, " ").trim()).toBe("Esc to cancel");
  });

  it("has NO priority field anywhere (FR-03.21 regression)", () => {
    renderModal();
    expect(screen.queryByText(/priority/i)).toBeNull();
  });

  it("returns null when action is null (closed dropdown state)", () => {
    const { container } = renderModal({ action: null });
    expect(container.firstChild).toBeNull();
  });

  it("Save-to-Backlog path closes modal without navigation + writes no clipboard", async () => {
    const write = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    renderModal({
      writeToClipboard: write,
      onOpenChange,
      onToast: () => {},
    });

    // Stub createTask + launchExternalTask by mocking the global fetch.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/external/tasks") && !String(url).includes("/launch")) {
        return new Response(
          JSON.stringify({
            task: {
              taskId: "task-1",
              sessionUuid: "00000000-0000-0000-0000-000000000001",
              cwd: "/tmp/demo",
              pluginDirs: [],
              title: "x",
              projectId: "proj-1",
              state: "draft",
              createdAt: "",
              inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Save test" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(write).not.toHaveBeenCalled();
  });

  // 2026-04-23 — Adopt phase gate. `/shipwright-adopt` is one-shot; once
  // a project is adopted (shipwright_run_config.json exists) the phase
  // option disappears so users can't re-trigger it. We assert on the
  // trigger's visible label (which reflects phases[0] via the reset
  // effect) because Radix DropdownMenu.Content only mounts under a real
  // pointer event; JSDOM + fireEvent.click doesn't open it. The existing
  // Playwright spec `70-h-actions-endpoint.spec.ts` exercises the open
  // menu path.
  describe("adopt phase gating (2026-04-23)", () => {
    const ACTIONS_WITH_ADOPT: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      phases: [
        { id: "adopt", label: "Adopt", color: "#64748B" },
        { id: "build", label: "Build", color: "#F59E0B" },
        { id: "design", label: "Design", color: "#A855F7" },
      ],
    };

    const baseProject = {
      id: "proj-1",
      name: "demo",
      path: "/tmp/demo",
      profile: "supabase-nextjs",
      status: "active",
      createdAt: "2026-04-01",
      lastActive: "2026-04-20",
    };

    it("hides the Adopt phase when selected project is already adopted", () => {
      renderModal({
        projectActions: ACTIONS_WITH_ADOPT,
        projectsOverride: [{ ...baseProject, adopted: true }],
      });
      // Trigger shows the first visible phase. Adopt was first in the
      // source list; with the gate active it's filtered out, so the
      // trigger reflects "Build" (next phase in the array).
      const trigger = screen.getByTestId("new-issue-phase-select");
      expect(trigger.textContent).toContain("Build");
      expect(trigger.textContent).not.toContain("Adopt");
    });

    it("shows the Adopt phase when selected project is NOT adopted", () => {
      renderModal({
        projectActions: ACTIONS_WITH_ADOPT,
        projectsOverride: [{ ...baseProject, adopted: false }],
      });
      const trigger = screen.getByTestId("new-issue-phase-select");
      expect(trigger.textContent).toContain("Adopt");
    });

    it("treats missing adopted field as not-adopted (legacy API shape)", () => {
      // A server that hasn't been upgraded yet may omit the field. Showing
      // Adopt in that ambiguous case is safer than hiding it — the skill's
      // own pre-flight check will refuse to run if run_config is already
      // present, so false positives are recoverable.
      renderModal({
        projectActions: ACTIONS_WITH_ADOPT,
        projectsOverride: [baseProject], // no `adopted` field
      });
      const trigger = screen.getByTestId("new-issue-phase-select");
      expect(trigger.textContent).toContain("Adopt");
    });
  });

  // ── iterate/launch-cli-parameters — Tests #23-#25 ──
  // Schema-driven Advanced parameters Section behaviour.
  describe("Advanced parameters — schema-driven (iterate/launch-cli-parameters)", () => {
    const PARAM_TASK_ACTION: ActionDefinition = {
      id: "new-task",
      label: "New task",
      kind: "external_launch",
      command_template: "claude /shipwright-{task.phase} {task.parameters?}",
      phase_parameters: {
        build: [
          {
            name: "section",
            label: "Section",
            type: "string",
            required: true,
            placeholder: "planning/03.md",
          },
          {
            name: "from",
            label: "From",
            type: "string",
          },
        ],
        test: [
          { name: "fix", label: "Fix", type: "boolean" },
        ],
      },
    };

    const PARAM_ACTIONS: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      actions: [PARAM_TASK_ACTION, PIPELINE_ACTION],
      phases: [
        { id: "build", label: "Build" },
        { id: "test", label: "Test" },
      ],
    };

    // Test #23
    it("required field empty → Launch button disabled, field-level error visible", async () => {
      renderModal({
        action: PARAM_TASK_ACTION,
        projectActions: PARAM_ACTIONS,
      });
      // Title is required at the top level — give it a value so we isolate
      // the param-required gate.
      await act(async () => {
        fireEvent.change(screen.getByTestId("new-issue-title-input"), {
          target: { value: "Build something" },
        });
      });
      // Open Advanced — the required field "section" should be there.
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      const launchBtn = screen.getByTestId("new-issue-launch-btn") as HTMLButtonElement;
      expect(launchBtn.disabled).toBe(true);
      // Field renders with an aria-invalid input + Required label.
      const sectionField = screen.getByTestId("paramfield-section");
      const input = sectionField.querySelector("input");
      expect(input).toBeTruthy();
      expect(input?.getAttribute("aria-invalid")).toBe("true");
      // Once filled, button enables.
      await act(async () => {
        fireEvent.change(input!, { target: { value: "planning/03.md" } });
      });
      expect(launchBtn.disabled).toBe(false);
    });

    // Test #24 — Phase-switch reset is exercised via fresh-mount with a
    // different default phase (Radix DropdownMenu can't be opened from
    // JSDOM/fireEvent.click — see existing comment at line 174 — so we
    // verify the reset via the schema-source-change path which fires the
    // same useEffect branch).
    it("schema source change → fresh paramValues, no carry-over", async () => {
      const ACTIONS_BUILD_FIRST: ResolvedProjectActions = {
        ...PARAM_ACTIONS,
        phases: [
          { id: "build", label: "Build" },
          { id: "test", label: "Test" },
        ],
      };
      const ACTIONS_TEST_FIRST: ResolvedProjectActions = {
        ...PARAM_ACTIONS,
        phases: [
          { id: "test", label: "Test" },
          { id: "build", label: "Build" },
        ],
      };

      const { unmount } = renderModal({
        action: PARAM_TASK_ACTION,
        projectActions: ACTIONS_BUILD_FIRST,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      const sectionInput = screen
        .getByTestId("paramfield-section")
        .querySelector("input")!;
      await act(async () => {
        fireEvent.change(sectionInput, { target: { value: "build/03.md" } });
      });
      expect((sectionInput as HTMLInputElement).value).toBe("build/03.md");

      // Tear down the build-first instance, mount the test-first variant.
      unmount();

      renderModal({
        action: PARAM_TASK_ACTION,
        projectActions: ACTIONS_TEST_FIRST,
      });
      // Reset puts advancedOpen back to false (fresh state). Open it
      // again to verify the new schema renders, with no carry-over from
      // the previous instance.
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      // Fresh schema → different paramfield rendered, no carry-over.
      expect(screen.queryByTestId("paramfield-section")).toBeNull();
      expect(screen.queryByTestId("paramfield-fix")).toBeTruthy();
    });

    // Test #25
    it("modal close + reopen produces fresh paramValues (no stale state)", async () => {
      const onOpenChange = vi.fn();
      const { rerender } = renderModal({
        action: PARAM_TASK_ACTION,
        projectActions: PARAM_ACTIONS,
        onOpenChange,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      const input = screen
        .getByTestId("paramfield-section")
        .querySelector("input")!;
      await act(async () => {
        fireEvent.change(input, { target: { value: "stale.md" } });
      });
      // Close the modal.
      rerender(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <NewIssueModal
              open={false}
              onOpenChange={onOpenChange}
              action={PARAM_TASK_ACTION}
              projectActions={PARAM_ACTIONS}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      // Re-open. The reset useEffect fires on `open === true`.
      rerender(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <NewIssueModal
              open={true}
              onOpenChange={onOpenChange}
              action={PARAM_TASK_ACTION}
              projectActions={PARAM_ACTIONS}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      // Advanced should be collapsed again (advancedOpen reset to false).
      const advancedSection = screen.getByTestId("new-issue-advanced-section");
      // Content div is only rendered when open — ensure it's gone.
      expect(
        advancedSection.querySelector('[data-testid="new-issue-advanced-content"]'),
      ).toBeNull();
    });

    it("Pipeline mode renders Advanced section only when parameters[] non-empty", () => {
      // PIPELINE_ACTION has no parameters — section should NOT render.
      renderModal({
        action: PIPELINE_ACTION,
        projectActions: PARAM_ACTIONS,
      });
      expect(screen.queryByTestId("new-issue-advanced-section")).toBeNull();
    });
  });

  // ── iterate/v030-five-ux-fixes — P1 + P2 + P3 ──
  describe("v0.3.0 — required out of Advanced (P2)", () => {
    const PARAM_TASK_ACTION: ActionDefinition = {
      id: "new-task",
      label: "New task",
      kind: "external_launch",
      command_template: "claude /shipwright-{task.phase} {task.parameters?}",
      phase_parameters: {
        build: [
          {
            name: "section",
            label: "Section",
            type: "string",
            required: true,
            placeholder: "planning/03.md",
          },
          { name: "from", label: "From", type: "string" },
        ],
      },
    };
    const PARAM_ACTIONS: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      actions: [PARAM_TASK_ACTION, PIPELINE_ACTION],
      phases: [{ id: "build", label: "Build" }],
    };

    it("required field is visible WITHOUT clicking the Advanced toggle", () => {
      renderModal({
        action: PARAM_TASK_ACTION,
        projectActions: PARAM_ACTIONS,
      });
      // The required-section wraps required fields and is always visible.
      expect(screen.getByTestId("new-issue-required-section")).toBeTruthy();
      expect(screen.getByTestId("paramfield-section")).toBeTruthy();
      // The Advanced collapsible is closed by default — so its content is
      // NOT rendered. The required field must be visible from outside.
      expect(screen.queryByTestId("new-issue-advanced-content")).toBeNull();
    });

    it("required-section renders the 'Required' badge instead of an enable-checkbox", () => {
      renderModal({
        action: PARAM_TASK_ACTION,
        projectActions: PARAM_ACTIONS,
      });
      expect(
        screen.getByTestId("paramfield-section-required-badge"),
      ).toBeTruthy();
      expect(screen.queryByTestId("paramfield-section-enable")).toBeNull();
    });

    it("Advanced count shows only OPTIONAL params (excludes required)", () => {
      renderModal({
        action: PARAM_TASK_ACTION,
        projectActions: PARAM_ACTIONS,
      });
      const toggle = screen.getByTestId("new-issue-advanced-toggle");
      // PARAM_TASK_ACTION has 2 phase_parameters (section required, from optional).
      // The Advanced count should be 1 (from), not 2.
      expect(toggle.textContent).toContain("Advanced parameters (1)");
    });

    it("required+default schema seeds the input with the default", () => {
      const ACTION_WITH_DEFAULT: ActionDefinition = {
        ...PARAM_TASK_ACTION,
        phase_parameters: {
          build: [
            {
              name: "section",
              label: "Section",
              type: "string",
              required: true,
              default: "planning/01-default.md",
            },
          ],
        },
      };
      renderModal({
        action: ACTION_WITH_DEFAULT,
        projectActions: { ...PARAM_ACTIONS, actions: [ACTION_WITH_DEFAULT] },
      });
      const input = screen
        .getByTestId("paramfield-section")
        .querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("planning/01-default.md");
    });
  });

  describe("v0.3.0 — phase-aware AutonomyToggle (P3)", () => {
    const PHASES_WITH_BUILD_AUTO: Array<{
      id: string;
      label: string;
      supports_autonomy?: boolean;
    }> = [
      { id: "build", label: "Build", supports_autonomy: true },
      { id: "changelog", label: "Changelog" },
    ];
    const ACTIONS_WITH_AUTO_PHASES: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      phases: PHASES_WITH_BUILD_AUTO,
    };

    it("Task mode WITH supports_autonomy phase (build) → AutonomyToggle visible", () => {
      renderModal({
        action: TASK_ACTION,
        projectActions: ACTIONS_WITH_AUTO_PHASES,
      });
      expect(screen.getByTestId("autonomy-toggle")).toBeTruthy();
    });

    it("Task mode WITHOUT supports_autonomy phase → AutonomyToggle hidden", () => {
      // Re-order so changelog is the first / default phase.
      const PHASES_CHANGELOG_FIRST = [
        { id: "changelog", label: "Changelog" },
        { id: "build", label: "Build", supports_autonomy: true },
      ];
      renderModal({
        action: TASK_ACTION,
        projectActions: {
          ...SAMPLE_ACTIONS,
          phases: PHASES_CHANGELOG_FIRST,
        },
      });
      expect(screen.queryByTestId("autonomy-toggle")).toBeNull();
    });

    it("Pipeline mode always renders AutonomyToggle (action-driven)", () => {
      renderModal({
        action: PIPELINE_ACTION,
        projectActions: { ...SAMPLE_ACTIONS, phases: [] },
      });
      expect(screen.getByTestId("autonomy-toggle")).toBeTruthy();
    });
  });

  // ── v0.4.0 — Plain Claude mode ──
  describe("v0.4.0 — Plain Claude mode", () => {
    const PLAIN_ACTION: ActionDefinition = {
      id: "new-plain",
      label: "Plain Claude",
      kind: "external_launch",
      command_template:
        'cd "p" && claude --session-id {task.uuid} --name "{task.title}" {plugin.dirs}{task.description?}',
    };

    it("renders the Plain Claude header + subheading", () => {
      renderModal({ action: PLAIN_ACTION });
      expect(screen.getByTestId("new-issue-modal-new-plain")).toBeTruthy();
      expect(screen.getByText("Plain Claude")).toBeTruthy();
    });

    it("does NOT render Phase, Autonomy, or Advanced sections", () => {
      renderModal({ action: PLAIN_ACTION });
      // No phase dropdown.
      expect(screen.queryByTestId("new-issue-phase-select")).toBeNull();
      // No autonomy toggle.
      expect(screen.queryByTestId("autonomy-toggle")).toBeNull();
      // No required parameters section, no advanced section.
      expect(screen.queryByTestId("new-issue-required-section")).toBeNull();
      expect(screen.queryByTestId("new-issue-advanced-section")).toBeNull();
    });

    it("still has Title and Description fields (so the user can name + pre-seed the chat)", () => {
      renderModal({ action: PLAIN_ACTION });
      expect(screen.getByTestId("new-issue-title-input")).toBeTruthy();
      expect(screen.getByTestId("new-issue-description-input")).toBeTruthy();
    });
  });

  describe("v0.3.0 — explicit enable-checkbox per Advanced param (P1)", () => {
    const ACTION_WITH_OPTIONAL: ActionDefinition = {
      id: "new-task",
      label: "New task",
      kind: "external_launch",
      command_template: "claude /shipwright-{task.phase} {task.parameters?}",
      phase_parameters: {
        build: [
          {
            name: "depth",
            label: "Crawl depth",
            type: "string",
            cli_flag: "--depth",
            value_separator: "space",
            default: "3",
          },
        ],
      },
    };
    const ACTIONS_WITH_OPTIONAL: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      actions: [ACTION_WITH_OPTIONAL, PIPELINE_ACTION],
      phases: [{ id: "build", label: "Build" }],
    };

    it("optional Advanced param starts with enable-checkbox unchecked + value disabled", async () => {
      renderModal({
        action: ACTION_WITH_OPTIONAL,
        projectActions: ACTIONS_WITH_OPTIONAL,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      const enable = screen.getByTestId(
        "paramfield-depth-enable",
      ) as HTMLInputElement;
      expect(enable.checked).toBe(false);
      const valueInput = screen
        .getByTestId("paramfield-depth")
        .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
      expect(valueInput.disabled).toBe(true);
    });

    it("toggling enable-checkbox ON pre-fills value with schema.default", async () => {
      renderModal({
        action: ACTION_WITH_OPTIONAL,
        projectActions: ACTIONS_WITH_OPTIONAL,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("paramfield-depth-enable"));
      });
      const valueInput = screen
        .getByTestId("paramfield-depth")
        .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
      expect(valueInput.disabled).toBe(false);
      expect(valueInput.value).toBe("3");
    });

    it("disabled optional param with value is NOT in command preview", async () => {
      renderModal({
        action: ACTION_WITH_OPTIONAL,
        projectActions: ACTIONS_WITH_OPTIONAL,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      // Toggle enable on, then off — leaves value in state but disables.
      await act(async () => {
        fireEvent.click(screen.getByTestId("paramfield-depth-enable"));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("paramfield-depth-enable"));
      });
      const preview = screen.getByTestId("command-preview-panel");
      // After disabling, the --depth flag must not appear in the preview.
      expect(preview.textContent).not.toContain("--depth");
    });

    it("React-Query refetch with identical param names does NOT wipe user input (regression guard for HIGH review finding)", async () => {
      // Simulate the React-Query refetch path: a fresh ResolvedProjectActions
      // object with structurally identical phase_parameters (same names) but
      // a new array reference. The reset effect must NOT fire — only schemaKey
      // (name-derived hash) is in deps.
      const ACTION_V1: ActionDefinition = {
        id: "new-task",
        label: "New task",
        kind: "external_launch",
        command_template:
          "claude /shipwright-{task.phase} {task.parameters?}",
        phase_parameters: {
          build: [
            {
              name: "depth",
              label: "Crawl depth",
              type: "string",
              cli_flag: "--depth",
              default: "3",
            },
          ],
        },
      };
      const ACTIONS_V1: ResolvedProjectActions = {
        ...SAMPLE_ACTIONS,
        actions: [ACTION_V1, PIPELINE_ACTION],
        phases: [{ id: "build", label: "Build" }],
      };
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      qc.setQueryData(
        ["projects"],
        [
          {
            id: "proj-1",
            name: "demo",
            path: "/tmp/demo",
            profile: "supabase-nextjs",
            status: "active",
            createdAt: "2026-04-01",
            lastActive: "2026-04-20",
          },
        ],
      );
      const { rerender } = render(
        <MemoryRouter>
          <QueryClientProvider client={qc}>
            <NewIssueModal
              open={true}
              onOpenChange={vi.fn()}
              action={ACTION_V1}
              projectActions={ACTIONS_V1}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      // Open Advanced + enable + type a custom value (not the default).
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("paramfield-depth-enable"));
      });
      const input = screen
        .getByTestId("paramfield-depth")
        .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "10" } });
      });
      expect(input.value).toBe("10");

      // Simulate a refetch — fresh objects, identical content (same names).
      const ACTION_V2: ActionDefinition = JSON.parse(
        JSON.stringify(ACTION_V1),
      );
      const ACTIONS_V2: ResolvedProjectActions = {
        ...ACTIONS_V1,
        actions: [ACTION_V2, PIPELINE_ACTION],
      };
      rerender(
        <MemoryRouter>
          <QueryClientProvider client={qc}>
            <NewIssueModal
              open={true}
              onOpenChange={vi.fn()}
              action={ACTION_V2}
              projectActions={ACTIONS_V2}
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      // The user's custom value MUST survive the refetch. If reset fired
      // on currentSchema identity change, the value would be wiped to
      // empty (optional fields are not seeded with defaults).
      const inputAfter = screen
        .getByTestId("paramfield-depth")
        .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
      expect(inputAfter.value).toBe("10");
    });

    it("sensitive optional param: clearing value on toggle-OFF (audit hardening)", async () => {
      const SENSITIVE_ACTION: ActionDefinition = {
        id: "new-task",
        label: "New task",
        kind: "external_launch",
        command_template:
          "claude /shipwright-{task.phase} {task.parameters?}",
        phase_parameters: {
          build: [
            {
              name: "token",
              label: "Auth token",
              type: "string",
              cli_flag: "--token",
              value_separator: "space",
              sensitive: true,
            },
          ],
        },
      };
      renderModal({
        action: SENSITIVE_ACTION,
        projectActions: {
          ...SAMPLE_ACTIONS,
          actions: [SENSITIVE_ACTION, PIPELINE_ACTION],
          phases: [{ id: "build", label: "Build" }],
        },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
      });
      // Enable, type a value.
      await act(async () => {
        fireEvent.click(screen.getByTestId("paramfield-token-enable"));
      });
      const input = screen
        .getByTestId("paramfield-token")
        .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "secret-123" } });
      });
      expect(input.value).toBe("secret-123");
      // Disable — value must be cleared from internal state. Re-enabling
      // shows an empty input (the sensitive default exception applies).
      await act(async () => {
        fireEvent.click(screen.getByTestId("paramfield-token-enable"));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("paramfield-token-enable"));
      });
      const inputAfter = screen
        .getByTestId("paramfield-token")
        .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
      expect(inputAfter.value).toBe("");
    });
  });
});
