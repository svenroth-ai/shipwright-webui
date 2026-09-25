/*
 * ClaimFilterToggle — FR-04.22 (iterate-2026-09-02-claim-chip-filter),
 * gated on org-chart presence since iterate-2026-09-26-runtime-badge-and-leads-gate.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";

import { ClaimFilterToggle } from "./ClaimFilterToggle";
import { useOrgChartPresence } from "../../hooks/useOrgChartPresence";

vi.mock("../../hooks/useOrgChartPresence");
const mockedPresence = vi.mocked(useOrgChartPresence);

describe("ClaimFilterToggle (FR-04.22)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  // @covers FR-04.22
  it("reflects the active flag via aria-pressed and data-active", () => {
    mockedPresence.mockReturnValue("present");
    render(<ClaimFilterToggle active={false} onToggle={() => {}} />);
    const btn = screen.getByTestId("board-claim-filter-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.dataset.active).toBeUndefined();
  });

  // @covers FR-04.22
  it("shows pressed state when active", () => {
    mockedPresence.mockReturnValue("present");
    render(<ClaimFilterToggle active={true} onToggle={() => {}} />);
    const btn = screen.getByTestId("board-claim-filter-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.dataset.active).toBe("true");
  });

  // @covers FR-04.22
  it("calls onToggle on click", async () => {
    mockedPresence.mockReturnValue("present");
    const onToggle = vi.fn();
    render(<ClaimFilterToggle active={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByTestId("board-claim-filter-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// @covers FR-04.11
describe("ClaimFilterToggle — org-chart presence gate (iterate-2026-09-26-runtime-badge-and-leads-gate)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("hides the toggle on a confirmed absent org chart — claims are exclusively a leadwright feature", () => {
    mockedPresence.mockReturnValue("absent");
    render(<ClaimFilterToggle active={false} onToggle={() => {}} />);
    expect(screen.queryByTestId("board-claim-filter-toggle")).toBeNull();
  });

  it.each(["loading", "broken", "present"] as const)(
    "still renders while presence is %s — fail visible, not fail hidden",
    (presence) => {
      mockedPresence.mockReturnValue(presence);
      render(<ClaimFilterToggle active={false} onToggle={() => {}} />);
      expect(screen.getByTestId("board-claim-filter-toggle")).toBeInTheDocument();
    },
  );
});
