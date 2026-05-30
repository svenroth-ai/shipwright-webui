/*
 * Per-body rendering tests for the v0.4 generic mode (custom actions
 * from .shipwright-webui/actions.json). Mandatory per Step 3.5 review OpenAI #7.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import {
  GENERIC_ACTION,
  SAMPLE_ACTIONS,
  TASK_ACTION,
  renderModal,
} from "./__testFixtures";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("NewGenericModal — rendering", () => {
  it("renders action.label as heading + action.description as subheading", () => {
    renderModal({
      action: GENERIC_ACTION,
      projectActions: {
        ...SAMPLE_ACTIONS,
        actions: [TASK_ACTION, GENERIC_ACTION],
      },
    });
    expect(screen.getByText("New Content Orchestrator")).toBeTruthy();
    expect(screen.getByText("Run the content pipeline.")).toBeTruthy();
  });

  it("does NOT render Phase, Autonomy, or the live CommandPreviewPanel", () => {
    renderModal({
      action: GENERIC_ACTION,
      projectActions: {
        ...SAMPLE_ACTIONS,
        actions: [TASK_ACTION, GENERIC_ACTION],
      },
    });
    expect(screen.queryByTestId("new-issue-phase-select")).toBeNull();
    expect(screen.queryByTestId("autonomy-toggle")).toBeNull();
    expect(screen.queryByTestId("command-preview-panel")).toBeNull();
    expect(screen.getByTestId("command-preview-generic")).toBeTruthy();
  });
});
