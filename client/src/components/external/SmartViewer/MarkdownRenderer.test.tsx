/*
 * MarkdownRenderer.test — pop-out trigger contract
 * (iterate-2026-05-31-smartviewer-popout-modal).
 *
 * The pop-out button no longer opens a new browser tab (window.open) — it
 * delegates to an `onPopOut` callback so the parent can open the centered
 * in-app modal. When `onPopOut` is omitted (the modal-nested instance), no
 * button renders, so the expanded view shows no further pop-out control.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer — pop-out trigger", () => {
  it("renders the pop-out button when onPopOut is provided", () => {
    render(<MarkdownRenderer text="# hi" onPopOut={() => {}} />);
    expect(screen.getByTestId("smart-viewer-popout")).toBeTruthy();
  });

  it("invokes onPopOut on click and never calls window.open", () => {
    const onPopOut = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MarkdownRenderer text="# hi" onPopOut={onPopOut} />);

    fireEvent.click(screen.getByTestId("smart-viewer-popout"));

    expect(onPopOut).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("hides the pop-out button when onPopOut is omitted (modal-nested instance)", () => {
    render(<MarkdownRenderer text="# hi" />);
    expect(screen.queryByTestId("smart-viewer-popout")).toBeNull();
  });
});
