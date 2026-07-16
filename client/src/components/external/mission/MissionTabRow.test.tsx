import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { MissionTabRow, SHIPS_LOG_ROUTE } from "./MissionTabRow";

function setup(value: "mission" | "files" = "files") {
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <MissionTabRow value={value} onChange={onChange} />
    </MemoryRouter>,
  );
  return { onChange };
}

describe("MissionTabRow", () => {
  it("renders the Mission | Files & Terminal segmented switch with the A11 testids", () => {
    setup("files");
    expect(screen.getByTestId("mission-tab-mission")).toBeInTheDocument();
    expect(screen.getByTestId("mission-tab-files")).toBeInTheDocument();
    // Files & Terminal is selected by default in this fixture.
    expect(screen.getByTestId("mission-tab-files")).toHaveAttribute("aria-checked", "true");
  });

  it("switching a tab calls onChange", () => {
    const { onChange } = setup("files");
    fireEvent.click(screen.getByTestId("mission-tab-mission"));
    expect(onChange).toHaveBeenCalledWith("mission");
  });

  it("renders the glass 'Open Ship's Log' button routing to a real surface (never dead)", () => {
    setup();
    const link = screen.getByTestId("mission-open-ships-log");
    expect(link).toHaveAttribute("href", SHIPS_LOG_ROUTE);
    expect(link).toHaveClass("btn-glass");
  });

  it("does NOT expose a role=tab (keeps getByRole('tab',{name:/terminal/i}) at 1)", () => {
    setup();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
