import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileMentionText } from "./FileMentionText";

describe("FileMentionText", () => {
  it("renders plain text unchanged when no mention is detected", () => {
    render(<FileMentionText text="nothing to see here" onOpen={vi.fn()} />);
    expect(screen.getByText("nothing to see here")).toBeTruthy();
    expect(screen.queryByTestId("triage-file-link")).toBeNull();
  });

  it("wraps a detected mention in a clickable link, preserving surrounding text", () => {
    const onOpen = vi.fn();
    render(
      <FileMentionText
        text="see architecture.md for detail"
        onOpen={onOpen}
      />,
    );
    const link = screen.getByTestId("triage-file-link");
    expect(link).toHaveTextContent("architecture.md");
    expect(screen.getByText(/see/)).toBeTruthy();
    expect(screen.getByText(/for detail/)).toBeTruthy();

    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith("architecture.md");
  });

  it("renders one link per distinct mention", () => {
    render(
      <FileMentionText
        text="CLAUDE.md and architecture.md both mention this"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("triage-file-link")).toHaveLength(2);
  });
});
