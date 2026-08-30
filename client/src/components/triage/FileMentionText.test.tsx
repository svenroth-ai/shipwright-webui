import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileMentionText } from "./FileMentionText";

describe("FileMentionText", () => {
  it("renders plain text unchanged when no mention is detected", () => {
    render(<FileMentionText text="nothing to see here" onOpen={vi.fn()} existingPaths={new Set()} />);
    expect(screen.getByText("nothing to see here")).toBeTruthy();
    expect(screen.queryByTestId("triage-file-link")).toBeNull();
  });

  it("wraps a detected mention that resolves to a real file in a clickable link, preserving surrounding text", () => {
    const onOpen = vi.fn();
    render(
      <FileMentionText
        text="see architecture.md for detail"
        onOpen={onOpen}
        existingPaths={new Set(["architecture.md"])}
      />,
    );
    const link = screen.getByTestId("triage-file-link");
    expect(link).toHaveTextContent("architecture.md");
    expect(screen.getByText(/see/)).toBeTruthy();
    expect(screen.getByText(/for detail/)).toBeTruthy();

    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith("architecture.md");
  });

  it("renders one link per distinct mention that resolves to a real file", () => {
    render(
      <FileMentionText
        text="CLAUDE.md and architecture.md both mention this"
        onOpen={vi.fn()}
        existingPaths={new Set(["CLAUDE.md", "architecture.md"])}
      />,
    );
    expect(screen.getAllByTestId("triage-file-link")).toHaveLength(2);
  });

  it("renders a detected mention as PLAIN TEXT when it does not resolve to a real file (broken link)", () => {
    render(
      <FileMentionText
        text="see shipwright_ac_coverage_baseline.json for detail"
        onOpen={vi.fn()}
        existingPaths={new Set()}
      />,
    );
    expect(screen.queryByTestId("triage-file-link")).toBeNull();
    expect(screen.getByText(/shipwright_ac_coverage_baseline\.json/)).toBeTruthy();
  });

  it("renders a mention as plain text while existence is still unknown (existingPaths=null)", () => {
    render(
      <FileMentionText text="see architecture.md for detail" onOpen={vi.fn()} existingPaths={null} />,
    );
    expect(screen.queryByTestId("triage-file-link")).toBeNull();
    expect(screen.getByText(/architecture\.md/)).toBeTruthy();
  });

  it("mixed batch: only the resolving mention becomes a link, the other two stay plain text", () => {
    render(
      <FileMentionText
        text="real.md exists but planned.json and gone.py do not"
        onOpen={vi.fn()}
        existingPaths={new Set(["real.md"])}
      />,
    );
    const links = screen.getAllByTestId("triage-file-link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("real.md");
    expect(screen.getByText(/planned\.json/)).toBeTruthy();
    expect(screen.getByText(/gone\.py/)).toBeTruthy();
  });
});
