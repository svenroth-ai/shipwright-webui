import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HandbackCard, HANDBACK_NOTICE } from "./HandbackCard";
import { TranscriptRow } from "./BubbleTranscript/TranscriptRow";

describe("HandbackCard (V2)", () => {
  // @covers FR-01.66
  it("shows tag, title, 8-char sender chip, report and the fixed notice", () => {
    render(<HandbackCard origin="subagent" sender="a798d6e7922ba0bd9" title="Review and merge M4 PR" text="Merged **#548**." />);
    expect(screen.getByText("Subagent report")).toBeInTheDocument();
    expect(screen.getByText("Review and merge M4 PR")).toBeInTheDocument();
    expect(screen.getByText("a798d6e7")).toBeInTheDocument();
    expect(screen.getByText("#548")).toBeInTheDocument();
    expect(screen.getByText(HANDBACK_NOTICE)).toHaveTextContent("Reply from a subagent, not a message from you.");
  });

  it("labels another session distinctly and makes the chip a button only when openable", async () => {
    const open = vi.fn();
    const { rerender } = render(<HandbackCard origin="session" sender="a20d8407c7" text="hi" />);
    expect(screen.getByText("Other session")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<HandbackCard origin="subagent" sender="a20d8407c7" text="hi" onSenderClick={open} />);
    await userEvent.click(screen.getByRole("button", { name: "Open agent a20d8407" }));
    expect(open).toHaveBeenCalledWith("a20d8407c7");
  });

  it("BubbleTranscript renders a handback event as the card, not a user bubble", () => {
    const event = { kind: "handback" as const, sender: "abc12345678", origin: "subagent" as const, text: "All done." };
    render(<TranscriptRow entry={event} previous={null} resolved={new Set()} toolResultsById={new Map()} visibleToolUseIds={new Set()} allToolUses={[]} isLatest={false} />);
    expect(screen.getByTestId("handback-card")).toBeInTheDocument();
    expect(screen.queryByTestId("bubble-user")).toBeNull();
  });
});
