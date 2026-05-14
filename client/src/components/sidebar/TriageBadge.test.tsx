import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TriageBadge } from "./TriageBadge";

describe("TriageBadge", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<TriageBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the count when 1..99", () => {
    render(<TriageBadge count={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("clamps counts > 99 to '99+'", () => {
    render(<TriageBadge count={150} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("uses orange (NOT Inbox red) so the two badges are visually distinct", () => {
    render(<TriageBadge count={3} />);
    const badge = screen.getByTestId("triage-badge");
    expect(badge.className).toContain("bg-orange-500");
    expect(badge.className).not.toContain("bg-red-500");
  });
});
