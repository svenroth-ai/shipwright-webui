/*
 * Per-body rendering tests for new-pipeline. Payload tests live in
 * NewIssueModal.payload.test.tsx.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { PIPELINE_ACTION, SAMPLE_ACTIONS, renderModal } from "./__testFixtures";
import type { ResolvedProjectActions } from "../../../lib/externalApi";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("NewPipelineModal — rendering", () => {
  it("renders new-pipeline testid + AutonomyToggle always visible", () => {
    renderModal({ action: PIPELINE_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-pipeline")).toBeTruthy();
    expect(screen.getByTestId("autonomy-toggle")).toBeTruthy();
  });

  it("Pipeline mode does NOT render the Phase dropdown", () => {
    renderModal({ action: PIPELINE_ACTION });
    expect(screen.queryByTestId("new-issue-phase-select")).toBeNull();
  });

  it("Pipeline mode renders the CommandPreviewPanel (live, not the static generic hint)", () => {
    renderModal({ action: PIPELINE_ACTION });
    expect(screen.getByTestId("command-preview-panel")).toBeTruthy();
    expect(screen.queryByTestId("command-preview-generic")).toBeNull();
  });

  it("AutonomyToggle stays visible even when phases array is empty", () => {
    const ACTIONS_NO_PHASES: ResolvedProjectActions = {
      ...SAMPLE_ACTIONS,
      phases: [],
    };
    renderModal({
      action: PIPELINE_ACTION,
      projectActions: ACTIONS_NO_PHASES,
    });
    expect(screen.getByTestId("autonomy-toggle")).toBeTruthy();
  });
});
