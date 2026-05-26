/*
 * Per-body rendering tests for the v0.4.0 Plain Claude mode.
 * Mandatory per Step 3.5 review OpenAI #7.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { PLAIN_ACTION, renderModal } from "./__testFixtures";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("NewPlainModal — rendering", () => {
  it("renders new-plain testid + the Plain Claude heading", () => {
    renderModal({ action: PLAIN_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-plain")).toBeTruthy();
    expect(screen.getByText("Plain Claude")).toBeTruthy();
  });

  it("does NOT render Phase, Autonomy, or parameter sections", () => {
    renderModal({ action: PLAIN_ACTION });
    expect(screen.queryByTestId("new-issue-phase-select")).toBeNull();
    expect(screen.queryByTestId("autonomy-toggle")).toBeNull();
    expect(screen.queryByTestId("new-issue-required-section")).toBeNull();
    expect(screen.queryByTestId("new-issue-advanced-section")).toBeNull();
  });

  it("still has Title and Description fields", () => {
    renderModal({ action: PLAIN_ACTION });
    expect(screen.getByTestId("new-issue-title-input")).toBeTruthy();
    expect(screen.getByTestId("new-issue-description-input")).toBeTruthy();
  });

  it("renders no live CommandPreviewPanel (Plain mode has no preview)", () => {
    renderModal({ action: PLAIN_ACTION });
    expect(screen.queryByTestId("command-preview-panel")).toBeNull();
    expect(screen.queryByTestId("command-preview-generic")).toBeNull();
  });
});
