/*
 * Per-body rendering tests for new-iterate. Payload tests live in
 * NewIssueModal.payload.test.tsx — including the description-thread
 * verification (memory `project_launch_description_needs_actionid`).
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { ITERATE_ACTION, openMoreOptions, renderModal } from "./__testFixtures";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
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

  it("title + description inputs are present", () => {
    renderModal({ action: ITERATE_ACTION });
    expect(screen.getByTestId("new-issue-title-input")).toBeTruthy();
    expect(screen.getByTestId("new-issue-description-input")).toBeTruthy();
  });
});
