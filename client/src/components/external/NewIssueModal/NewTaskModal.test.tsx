/*
 * Per-body rendering tests for the new-task body. Behavior + payload-shape
 * tests live in NewIssueModal.payload.test.tsx (Step 3.5 review OpenAI #4).
 *
 * Covers:
 *   - Phase dropdown renders with first phase as default.
 *   - AutonomyToggle gating (supports_autonomy phase only).
 *   - Adopt-phase gate (adopted project hides Adopt option).
 *   - FR-03.21 baseline: no priority/domain/etc. fields when modal_fields omits them.
 *   - Required + Advanced parameter sections layout (P2: required outside collapsible).
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { screen, act, fireEvent, cleanup } from "@testing-library/react";

import {
  PIPELINE_ACTION,
  SAMPLE_ACTIONS,
  TASK_ACTION,
  renderModal,
} from "./__testFixtures";
import type {
  ActionDefinition,
  ResolvedProjectActions,
} from "../../../lib/externalApi";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("NewTaskModal — rendering", () => {
  it("renders the new-task testid + AutonomyToggle hidden by default", () => {
    renderModal({ action: TASK_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-task")).toBeTruthy();
    expect(screen.getByText("New Task")).toBeTruthy();
    expect(screen.queryByTestId("autonomy-toggle")).toBeNull();
  });

  it("Phase dropdown trigger labels the first phase", () => {
    renderModal({ action: TASK_ACTION });
    const trigger = screen.getByTestId("new-issue-phase-select");
    expect(trigger.textContent).toContain("Build");
  });

  it("AutonomyToggle visible when current phase has supports_autonomy", () => {
    const PHASES_WITH_AUTONOMY: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      phases: [
        { id: "build", label: "Build", supports_autonomy: true },
        { id: "design", label: "Design" },
      ],
    };
    renderModal({
      action: TASK_ACTION,
      projectActions: PHASES_WITH_AUTONOMY,
    });
    expect(screen.getByTestId("autonomy-toggle")).toBeTruthy();
  });

  it("AutonomyToggle hidden when current phase does not declare supports_autonomy", () => {
    const PHASES_CHANGELOG_FIRST: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      phases: [
        { id: "changelog", label: "Changelog" },
        { id: "build", label: "Build", supports_autonomy: true },
      ],
    };
    renderModal({
      action: TASK_ACTION,
      projectActions: PHASES_CHANGELOG_FIRST,
    });
    expect(screen.queryByTestId("autonomy-toggle")).toBeNull();
  });

  it("no priority field when modal_fields omits leadwright (FR-03.21 baseline)", () => {
    renderModal({ action: TASK_ACTION });
    expect(screen.queryByTestId("new-issue-priority-select")).toBeNull();
    expect(screen.queryByTestId("new-issue-domain-input")).toBeNull();
    expect(screen.queryByTestId("new-issue-tags-input")).toBeNull();
    expect(screen.queryByTestId("new-issue-blocked-by-input")).toBeNull();
  });

  it("all 5 leadwright inputs render when modal_fields opts in", () => {
    const TASK_WITH_LEAD: ActionDefinition = {
      ...TASK_ACTION,
      modal_fields: [
        "title",
        "phase",
        "description",
        "domain",
        "priority",
        "complexityHint",
        "tags",
        "blockedBy",
      ],
    };
    renderModal({
      action: TASK_WITH_LEAD,
      projectActions: { ...SAMPLE_ACTIONS, actions: [TASK_WITH_LEAD] },
    });
    expect(screen.getByTestId("new-issue-domain-input")).toBeTruthy();
    expect(screen.getByTestId("new-issue-priority-select")).toBeTruthy();
    expect(screen.getByTestId("new-issue-complexity-hint-select")).toBeTruthy();
    expect(screen.getByTestId("new-issue-tags-input")).toBeTruthy();
    expect(screen.getByTestId("new-issue-blocked-by-input")).toBeTruthy();
  });
});

describe("NewTaskModal — adopt-phase gate", () => {
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

  it("hides Adopt when project is already adopted", () => {
    renderModal({
      action: TASK_ACTION,
      projectActions: ACTIONS_WITH_ADOPT,
      projectsOverride: [{ ...baseProject, adopted: true }],
    });
    const trigger = screen.getByTestId("new-issue-phase-select");
    expect(trigger.textContent).toContain("Build");
    expect(trigger.textContent).not.toContain("Adopt");
  });
  it("shows Adopt when project is NOT adopted", () => {
    renderModal({
      action: TASK_ACTION,
      projectActions: ACTIONS_WITH_ADOPT,
      projectsOverride: [{ ...baseProject, adopted: false }],
    });
    const trigger = screen.getByTestId("new-issue-phase-select");
    expect(trigger.textContent).toContain("Adopt");
  });
  it("treats missing adopted field as not-adopted (legacy API shape)", () => {
    renderModal({
      action: TASK_ACTION,
      projectActions: ACTIONS_WITH_ADOPT,
      projectsOverride: [baseProject],
    });
    const trigger = screen.getByTestId("new-issue-phase-select");
    expect(trigger.textContent).toContain("Adopt");
  });
});

describe("NewTaskModal — Advanced + Required parameters (P2)", () => {
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

  it("required field visible without opening Advanced (P2)", () => {
    renderModal({
      action: PARAM_TASK_ACTION,
      projectActions: PARAM_ACTIONS,
    });
    expect(screen.getByTestId("new-issue-required-section")).toBeTruthy();
    expect(screen.getByTestId("paramfield-section")).toBeTruthy();
    expect(screen.queryByTestId("new-issue-advanced-content")).toBeNull();
  });

  it("Advanced count shows OPTIONAL params only (P2 — excludes required)", () => {
    renderModal({
      action: PARAM_TASK_ACTION,
      projectActions: PARAM_ACTIONS,
    });
    const toggle = screen.getByTestId("new-issue-advanced-toggle");
    expect(toggle.textContent).toContain("Advanced parameters (1)");
  });

  it("required+default seeds the input with the default value", () => {
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

  it("Launch button disabled when required field empty; enables on fill", async () => {
    renderModal({
      action: PARAM_TASK_ACTION,
      projectActions: PARAM_ACTIONS,
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Build something" },
      });
    });
    const launchBtn = screen.getByTestId(
      "new-issue-launch-btn",
    ) as HTMLButtonElement;
    expect(launchBtn.disabled).toBe(true);
    const sectionField = screen.getByTestId("paramfield-section");
    const input = sectionField.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await act(async () => {
      fireEvent.change(input, { target: { value: "planning/03.md" } });
    });
    expect(launchBtn.disabled).toBe(false);
  });
});
