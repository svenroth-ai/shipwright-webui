/*
 * ClaimFilterToggle — FR-04.22 (iterate-2026-09-02-claim-chip-filter).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { ClaimFilterToggle } from "./ClaimFilterToggle";

describe("ClaimFilterToggle (FR-04.22)", () => {
  // @covers FR-04.22
  it("reflects the active flag via aria-pressed and data-active", () => {
    render(<ClaimFilterToggle active={false} onToggle={() => {}} />);
    const btn = screen.getByTestId("board-claim-filter-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.dataset.active).toBeUndefined();
  });

  // @covers FR-04.22
  it("shows pressed state when active", () => {
    render(<ClaimFilterToggle active={true} onToggle={() => {}} />);
    const btn = screen.getByTestId("board-claim-filter-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.dataset.active).toBe("true");
  });

  // @covers FR-04.22
  it("calls onToggle on click", async () => {
    const onToggle = vi.fn();
    render(<ClaimFilterToggle active={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByTestId("board-claim-filter-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
