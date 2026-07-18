import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// S1 (AC4) — the tab row asks the resolver whether this project should have a
// Mission tab. Stubbed to "no answer" here so these cases keep asserting the
// DEFAULT (both tabs present); the hide behaviour has its own cases below.
const missionContextMock = vi.fn<() => { data: { missionTabVisible: boolean } | undefined }>(
  () => ({ data: undefined }),
);
vi.mock("../../../hooks/useMissionContext", () => ({
  useMissionContext: () => missionContextMock(),
}));

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
  // @covers FR-01.66
  it("renders the Mission | Files & Terminal segmented switch with the A11 testids", () => {
    setup("files");
    expect(screen.getByTestId("mission-tab-mission")).toBeInTheDocument();
    expect(screen.getByTestId("mission-tab-files")).toBeInTheDocument();
    // Files & Terminal is selected by default in this fixture.
    expect(screen.getByTestId("mission-tab-files")).toHaveAttribute("aria-checked", "true");
  });

  // @covers FR-01.66
  it("switching a tab calls onChange", () => {
    const { onChange } = setup("files");
    fireEvent.click(screen.getByTestId("mission-tab-mission"));
    expect(onChange).toHaveBeenCalledWith("mission");
  });

  // @covers FR-01.66
  it("renders the glass 'Open Ship's Log' button routing to a real surface (never dead)", () => {
    setup();
    const link = screen.getByTestId("mission-open-ships-log");
    expect(link).toHaveAttribute("href", SHIPS_LOG_ROUTE);
    expect(link).toHaveClass("btn-glass");
  });

  // @covers FR-01.66
  it("does NOT expose a role=tab (keeps getByRole('tab',{name:/terminal/i}) at 1)", () => {
    setup();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});

/*
 * S1 (AC4) — a VALIDATED custom-actions project has no Mission tab at all.
 *
 * The asymmetry is deliberate: hide ONLY on an explicit `false`. While the
 * resolver is loading, or if it fails, the tab stays — hiding a useful tab on
 * an unknown or ambiguous answer is the worse failure (CONTRACT §4).
 */
describe("MissionTabRow — custom-actions tab hiding (AC4)", () => {
  // @covers FR-01.66
  it("HIDES the Mission tab when the resolver says it is not visible", () => {
    missionContextMock.mockReturnValue({ data: { missionTabVisible: false } });
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <MissionTabRow value="files" onChange={onChange} taskId="t1" />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("mission-tab-mission")).not.toBeInTheDocument();
    expect(screen.getByTestId("mission-tab-files")).toBeInTheDocument();
  });

  // @covers FR-01.66
  it("KEEPS the tab while the resolver has not answered (never hide on unknown)", () => {
    missionContextMock.mockReturnValue({ data: undefined });
    render(
      <MemoryRouter>
        <MissionTabRow value="files" onChange={vi.fn()} taskId="t1" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mission-tab-mission")).toBeInTheDocument();
  });

  // @covers FR-01.66
  it("KEEPS the tab when the resolver says it IS visible", () => {
    missionContextMock.mockReturnValue({ data: { missionTabVisible: true } });
    render(
      <MemoryRouter>
        <MissionTabRow value="files" onChange={vi.fn()} taskId="t1" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mission-tab-mission")).toBeInTheDocument();
  });

  // @covers FR-01.66
  it("falls back to Files & Terminal if the hidden tab was the active view", () => {
    missionContextMock.mockReturnValue({ data: { missionTabVisible: false } });
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <MissionTabRow value="mission" onChange={onChange} taskId="t1" />
      </MemoryRouter>,
    );
    expect(onChange).toHaveBeenCalledWith("files");
  });
});
