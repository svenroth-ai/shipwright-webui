import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TextRenderer } from "./TextRenderer";

// @covers FR-01.66
describe("line focus (File.ts:98 chip -> viewer opens at that line)", () => {
  it("TextRenderer marks the requested logical line and leaves the view unmarked without one", () => {
    const text = "a\nb\nc";
    const { rerender } = render(<TextRenderer text={text} />);
    expect(screen.queryByTestId("sv-line-mark")).toBeNull();
    rerender(<TextRenderer text={text} line={2} focusKey={1} />);
    expect(screen.getByTestId("sv-line-mark")).toHaveAttribute("data-line", "2");
    rerender(<TextRenderer text={text} line={99} focusKey={1} />);
    expect(screen.queryByTestId("sv-line-mark")).toBeNull(); // past the end: nothing to mark
  });
});
