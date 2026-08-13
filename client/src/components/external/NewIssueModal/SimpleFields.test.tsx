/*
 * SimpleFields — Sven 2026-07-17 (AC1). The task form was white fields on a
 * white sheet with near-invisible borders. The sheet is now beige (ModalShell)
 * and the fields carry a white fill + a clearly-visible frame (--surface-form-line, >=3:1).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  TitleFieldFragment,
  DescriptionFieldFragment,
  DESCRIPTION_MAX_LENGTH,
} from "./SimpleFields";

describe("SimpleFields — visible frames on the grey-beige sheet (WCAG 1.4.11)", () => {
  // @covers FR-01.38
  it("the Title input has a white fill and a WCAG-1.4.11 visible frame", () => {
    render(<TitleFieldFragment title="" setTitle={() => {}} />);
    const input = screen.getByTestId("new-issue-title-input");
    expect(input.className).toContain("bg-white");
    expect(input.className).toContain("border-[var(--surface-form-line");
    // the faint tokens (--color-border 1.6:1, --line-strong 1.4:1 vs white) are gone
    expect(input.className).not.toContain("border-[var(--color-border");
  });

  // @covers FR-01.38
  it("the Description textarea has a white fill and a WCAG-1.4.11 visible frame", () => {
    render(<DescriptionFieldFragment description="" setDescription={() => {}} />);
    const ta = screen.getByTestId("new-issue-description-input");
    expect(ta.className).toContain("bg-white");
    expect(ta.className).toContain("border-[var(--surface-form-line");
  });
});

describe("SimpleFields — description length cap (iterate-2026-08-13-task-description-length-cap)", () => {
  it("caps the textarea's maxLength at DESCRIPTION_MAX_LENGTH", () => {
    render(<DescriptionFieldFragment description="" setDescription={() => {}} />);
    const ta = screen.getByTestId("new-issue-description-input") as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(DESCRIPTION_MAX_LENGTH);
  });

  it("shows a live character-count hint reflecting the current length and the cap", () => {
    render(<DescriptionFieldFragment description="hello" setDescription={() => {}} />);
    expect(screen.getByText(new RegExp(`5/${DESCRIPTION_MAX_LENGTH}`))).toBeInTheDocument();
  });
});
