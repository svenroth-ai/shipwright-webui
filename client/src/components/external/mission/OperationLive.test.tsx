import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OperationLive } from "./OperationLive";
import type { Paragraph } from "../../../lib/narrator-prose";

const story: Paragraph[] = [
  [{ kind: "text", text: "You asked: “Make the New button match the others”" }],
  [
    { kind: "text", text: "Twelve files were then changed. The " },
    { kind: "link", text: "tests", artifact: "tests" },
    { kind: "text", text: " were run, and three of them failed." },
  ],
];

describe("OperationLive — the middle card tells a story (FR-01.68 AC1)", () => {
  // @covers FR-01.66
  it("renders paragraphs of prose, not a list of activity lines", () => {
    const { container } = render(<OperationLive paragraphs={story} />);
    const hero = screen.getByTestId("mission-narration");
    expect(hero).toHaveTextContent("You asked: “Make the New button match the others”");
    expect(hero).toHaveTextContent("Twelve files were then changed.");
    expect(hero).not.toHaveAttribute("data-empty");
    expect(screen.getAllByTestId("mission-narration-paragraph")).toHaveLength(2);
    // The rolling-window list is gone, not merely restyled.
    expect(container.querySelector(".mc-hero-line")).toBeNull();
  });

  // @covers FR-01.66
  it("keeps the honest waiting line when nothing is evidenced (AC7 / AC7b)", () => {
    render(<OperationLive paragraphs={[]} />);
    const hero = screen.getByTestId("mission-narration");
    expect(hero).toHaveAttribute("data-empty", "true");
    expect(hero).toHaveTextContent(/waiting/i);
    expect(screen.queryAllByTestId("mission-narration-paragraph")).toHaveLength(0);
  });

  // @covers FR-01.66
  it("stays a scrollable, focusable log region (pre-existing behaviour)", () => {
    render(<OperationLive paragraphs={story} />);
    const hero = screen.getByTestId("mission-narration");
    expect(hero).toHaveAttribute("tabindex", "0");
    expect(hero).toHaveAttribute("role", "log");
  });
});

describe("OperationLive — links live inside the sentences (AC5)", () => {
  // @covers FR-01.66
  it("a link span is a real button that selects the SAME artifact node", async () => {
    const onArtifactClick = vi.fn();
    render(<OperationLive paragraphs={story} onArtifactClick={onArtifactClick} />);
    const link = screen.getByRole("button", { name: "tests" });
    // `type="button"` matters: an implicit submit inside a form would navigate.
    expect(link).toHaveAttribute("type", "button");
    await userEvent.click(link);
    expect(onArtifactClick).toHaveBeenCalledWith("tests");
  });

  // @covers FR-01.66
  it("is reachable and activatable by keyboard, like the left rail", async () => {
    const onArtifactClick = vi.fn();
    render(<OperationLive paragraphs={story} onArtifactClick={onArtifactClick} />);
    await userEvent.tab(); // the log region
    await userEvent.tab(); // the inline link
    expect(screen.getByRole("button", { name: "tests" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onArtifactClick).toHaveBeenCalledWith("tests");
  });

  // @covers FR-01.66
  it("renders plain text — never a dead button — when no handler is wired", () => {
    render(<OperationLive paragraphs={story} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("mission-narration")).toHaveTextContent("The tests were run");
  });
});

describe("OperationLive — is NOT the terminal (rule 1)", () => {
  // @covers FR-01.66
  it("has no xterm/canvas/textarea and constructs no WebSocket", () => {
    const wsSpy = vi.spyOn(globalThis, "WebSocket");
    const { container } = render(<OperationLive paragraphs={story} />);
    expect(container.querySelector(".xterm")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("[data-testid='embedded-terminal']")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(wsSpy).not.toHaveBeenCalled();
    wsSpy.mockRestore();
  });
});
