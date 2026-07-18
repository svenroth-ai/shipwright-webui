/*
 * SimpleFields — Sven 2026-07-17 (AC1). The task form was white fields on a
 * white sheet with near-invisible borders. The sheet is now beige (ModalShell)
 * and the fields carry a white fill + a clearly-visible frame (--line-strong).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TitleFieldFragment, DescriptionFieldFragment } from "./SimpleFields";

describe("SimpleFields — visible frames on the beige sheet (AC1)", () => {
  // @covers FR-01.38
  it("the Title input has a white fill and the strong-line border", () => {
    render(<TitleFieldFragment title="" setTitle={() => {}} />);
    const input = screen.getByTestId("new-issue-title-input");
    expect(input.className).toContain("bg-white");
    expect(input.className).toContain("border-[var(--line-strong");
    // the faint default border token is gone
    expect(input.className).not.toContain("border-[var(--color-border");
  });

  // @covers FR-01.38
  it("the Description textarea has a white fill and the strong-line border", () => {
    render(<DescriptionFieldFragment description="" setDescription={() => {}} />);
    const ta = screen.getByTestId("new-issue-description-input");
    expect(ta.className).toContain("bg-white");
    expect(ta.className).toContain("border-[var(--line-strong");
  });
});
