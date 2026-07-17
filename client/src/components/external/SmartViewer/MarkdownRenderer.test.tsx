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
  // @covers FR-01.35
  it("renders the pop-out button when onPopOut is provided", () => {
    render(<MarkdownRenderer text="# hi" onPopOut={() => {}} />);
    expect(screen.getByTestId("smart-viewer-popout")).toBeTruthy();
  });

  // @covers FR-01.35
  it("invokes onPopOut on click and never calls window.open", () => {
    const onPopOut = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MarkdownRenderer text="# hi" onPopOut={onPopOut} />);

    fireEvent.click(screen.getByTestId("smart-viewer-popout"));

    expect(onPopOut).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  // @covers FR-01.35
  it("hides the pop-out button when onPopOut is omitted (modal-nested instance)", () => {
    render(<MarkdownRenderer text="# hi" />);
    expect(screen.queryByTestId("smart-viewer-popout")).toBeNull();
  });
});

describe("MarkdownRenderer — Edit button (FR-01.34 AC1)", () => {
  // @covers FR-01.35
  it("renders the Edit button when projectId + path + onSaved are all provided", () => {
    render(
      <MarkdownRenderer text="# hi" projectId="p1" path="README.md" onSaved={() => {}} />,
    );
    expect(screen.getByTestId("smart-viewer-edit")).toBeTruthy();
  });

  // @covers FR-01.35
  it("hides the Edit button in the nested instance (onSaved omitted)", () => {
    render(<MarkdownRenderer text="# hi" projectId="p1" path="README.md" />);
    expect(screen.queryByTestId("smart-viewer-edit")).toBeNull();
  });

  // @covers FR-01.35
  it("hides the Edit button when projectId/path are missing", () => {
    render(<MarkdownRenderer text="# hi" onSaved={() => {}} />);
    expect(screen.queryByTestId("smart-viewer-edit")).toBeNull();
  });
});

describe("MarkdownRenderer — Edit / Pop out legibility (Sven 2026-07-17, AC7)", () => {
  // @covers FR-01.35
  it("Edit + Pop out use BLACK text and a BLACK border (not muted grey)", () => {
    render(
      <MarkdownRenderer
        text="# hi"
        onPopOut={() => {}}
        projectId="p1"
        path="README.md"
        onSaved={() => {}}
      />,
    );
    for (const testid of ["smart-viewer-edit", "smart-viewer-popout"]) {
      const btn = screen.getByTestId(testid);
      // Inline styles carry the token; jsdom normalises var() to its raw string.
      expect(btn.style.color).toContain("--color-text");
      expect(btn.style.border).toContain("--color-text");
      // The old muted-grey token must be gone.
      expect(btn.style.color).not.toContain("--color-muted");
    }
  });
});
