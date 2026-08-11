/*
 * Per-body rendering tests for new-iterate. Payload tests live in
 * NewIssueModal.payload.test.tsx — including the description-thread
 * verification (memory `project_launch_description_needs_actionid`).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { ITERATE_ACTION, openMoreOptions, renderModal } from "./__testFixtures";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NewIterateModal — rendering", () => {
  it("renders new-iterate testid + AutonomyToggle always visible", () => {
    renderModal({ action: ITERATE_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-iterate")).toBeTruthy();
    expect(screen.getByTestId("autonomy-toggle")).toBeTruthy();
  });

  it("Iterate mode does NOT render the Phase dropdown", () => {
    renderModal({ action: ITERATE_ACTION });
    expect(screen.queryByTestId("new-issue-phase-select")).toBeNull();
  });

  it("Command preview is collapsed by default, inside the More options section", () => {
    renderModal({ action: ITERATE_ACTION });
    // Collapsed by default → not in the DOM until the section is expanded.
    expect(screen.getByTestId("new-issue-more-options-toggle")).toBeTruthy();
    expect(screen.queryByTestId("command-preview-panel")).toBeNull();
  });

  it("Iterate mode renders the live CommandPreviewPanel once More options is expanded (not the static generic hint)", () => {
    renderModal({ action: ITERATE_ACTION });
    openMoreOptions();
    expect(screen.getByTestId("command-preview-panel")).toBeTruthy();
    expect(screen.queryByTestId("command-preview-generic")).toBeNull();
  });

  it("offers the supported model overrides first, with project defaults and no finalization control", async () => {
    const { qc } = renderModal({
      action: {
        ...ITERATE_ACTION,
        parameters: [
          "plan-review-model",
          "review-model",
          "finalization-model",
          "custom-param",
        ].map((name) => ({
          name,
          type: "enum" as const,
          label: `${name} override`,
          enum: ["opus", "sonnet", "haiku", "inherit"],
          cli_flag: `--${name}`,
          value_separator: "space" as const,
          required: name === "plan-review-model" || name === "finalization-model",
        })),
      },
    });
    qc.setQueryData(["model-tier-config", "proj-1"], {
      tiers: {
        plan_review: { tier: "sonnet", source: "project_config" },
        review: { tier: "opus", source: "project_config" },
        finalization: { tier: "sonnet", source: "project_config" },
        execution: { tier: "sonnet", source: "project_config" },
      },
    });
    openMoreOptions();
    await waitFor(() => expect(screen.getByTestId("model-tier-override-fields")).toBeTruthy());
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveTextContent("Project default — Sonnet");
    expect(screen.getByTestId("model-tier-override-review-model")).toHaveTextContent("Project default — Opus");
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveValue("");
    expect(screen.getByTestId("model-tier-override-review-model")).toHaveValue("");
    expect(screen.getByText("plan-review-model override")).toBeTruthy();
    expect(screen.getByText("review-model override")).toBeTruthy();
    expect(screen.queryByTestId("new-issue-required-section")).toBeNull();
    fireEvent.click(screen.getByTestId("new-issue-advanced-toggle"));
    expect(screen.queryByTestId("paramfield-finalization-model")).toBeNull();
    expect(screen.getByTestId("paramfield-custom-param")).toBeTruthy();
    expect(screen.queryByText("Finalization")).toBeNull();
    expect(screen.queryByText("Execution")).toBeNull();
  });

  it("does not present inherited or unreadable configuration as a project default", async () => {
    const { qc } = renderModal({
      action: {
        ...ITERATE_ACTION,
        parameters: ["plan-review-model", "review-model"].map((name) => ({
          name,
          type: "enum" as const,
          label: name,
          enum: ["opus", "sonnet", "haiku", "inherit"],
          cli_flag: `--${name}`,
          value_separator: "space" as const,
        })),
      },
    });
    qc.setQueryData(["model-tier-config", "proj-1"], {
      tiers: {
        plan_review: { tier: "inherit", source: "unset" },
        review: { tier: "inherit", source: "unset" },
        finalization: { tier: "inherit", source: "unset" },
        execution: { tier: "inherit", source: "unset" },
      },
      warning: "model_config_missing",
    });
    openMoreOptions();
    await waitFor(() => expect(screen.getByTestId("model-tier-default-status")).toBeTruthy());
    expect(screen.getByTestId("model-tier-default-status")).toHaveTextContent("Project defaults are unavailable");
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveTextContent("Project default unavailable");
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveValue("");
  });

  it("keeps the project default blank while its configuration is loading", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderModal({
      action: {
        ...ITERATE_ACTION,
        parameters: ["plan-review-model", "review-model"].map((name) => ({
          name,
          type: "enum" as const,
          label: name,
          enum: ["opus", "sonnet", "haiku", "inherit"],
          cli_flag: `--${name}`,
          value_separator: "space" as const,
        })),
      },
    });
    openMoreOptions();
    await waitFor(() => expect(screen.getByTestId("model-tier-default-status")).toHaveTextContent("Loading project defaults"));
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveTextContent("Loading project default");
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveValue("");
  });

  it("does not label a failed configuration read as an inherited default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    renderModal({
      action: {
        ...ITERATE_ACTION,
        parameters: ["plan-review-model", "review-model"].map((name) => ({
          name,
          type: "enum" as const,
          label: name,
          enum: ["opus", "sonnet", "haiku", "inherit"],
          cli_flag: `--${name}`,
          value_separator: "space" as const,
        })),
      },
    });
    openMoreOptions();
    await waitFor(() => expect(screen.getByTestId("model-tier-default-status")).toHaveTextContent("Project defaults are unavailable"));
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveTextContent("Project default unavailable");
    expect(screen.getByTestId("model-tier-override-plan-review-model")).toHaveValue("");
  });

  it("title + description inputs are present", () => {
    renderModal({ action: ITERATE_ACTION });
    expect(screen.getByTestId("new-issue-title-input")).toBeTruthy();
    expect(screen.getByTestId("new-issue-description-input")).toBeTruthy();
  });
});
