/*
 * Per-body rendering tests for new-iterate. Payload tests live in
 * NewIssueModal.payload.test.tsx — including the description-thread
 * verification (memory `project_launch_description_needs_actionid`).
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { ITERATE_ACTION, renderModal } from "./__testFixtures";

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

  it("Iterate mode renders the live CommandPreviewPanel (not the static generic hint)", () => {
    renderModal({ action: ITERATE_ACTION });
    expect(screen.getByTestId("command-preview-panel")).toBeTruthy();
    expect(screen.queryByTestId("command-preview-generic")).toBeNull();
  });

  it("title + description inputs are present", () => {
    renderModal({ action: ITERATE_ACTION });
    expect(screen.getByTestId("new-issue-title-input")).toBeTruthy();
    expect(screen.getByTestId("new-issue-description-input")).toBeTruthy();
  });
});
