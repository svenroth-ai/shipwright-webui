import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { MarkdownDiffView } from "./MarkdownDiffView";

describe("MarkdownDiffView", () => {
  it("shows 'No changes' when original equals edited", () => {
    const { getByTestId } = render(
      <MarkdownDiffView original={"# Hi\n"} edited={"# Hi\n"} />,
    );
    expect(getByTestId("markdown-diff-summary").textContent).toBe("No changes");
  });

  it("marks added and removed lines", () => {
    const { container, getByTestId } = render(
      <MarkdownDiffView original={"a\nb\n"} edited={"a\nc\n"} />,
    );
    expect(container.querySelector('[data-diff-kind="add"]')).toBeTruthy();
    expect(container.querySelector('[data-diff-kind="del"]')).toBeTruthy();
    expect(getByTestId("markdown-diff-summary").textContent).toContain("+1");
    expect(getByTestId("markdown-diff-summary").textContent).toContain("-1");
  });

  it("renders HTML/script content as escaped text (no live element — review #7)", () => {
    const { container } = render(
      <MarkdownDiffView original={"safe\n"} edited={"<script>alert(1)</script>\n"} />,
    );
    // The literal text is present…
    expect(container.textContent).toContain("<script>alert(1)</script>");
    // …but NOT as a real <script> element.
    expect(container.querySelector("script")).toBeNull();
  });
});
