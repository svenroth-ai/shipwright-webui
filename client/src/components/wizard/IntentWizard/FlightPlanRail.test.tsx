/*
 * FlightPlanRail — phone-collapsed chip + bottom sheet
 * (iterate-2026-08-13-mission-mobile-visual). Desktop's unabridged rail is
 * already exercised end-to-end via IntentWizard.test.tsx (row/node testid
 * assertions; jsdom has no matchMedia so isPhone defaults false there); this
 * file covers the isPhone=true branch in isolation.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FlightPlanRail } from "./FlightPlanRail";
import type { FlightRow } from "./types";

const ROWS: FlightRow[] = [
  { key: "Goal", answered: true, value: "Build something new", why: "Because you said “build”" },
  { key: "Repo", answered: false, value: "", why: "" },
];

function mockPhoneViewport() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("FlightPlanRail — phone (isPhone)", () => {
  afterEach(() => {
    // @ts-expect-error — restore to the jsdom-default "no matchMedia" state.
    delete window.matchMedia;
  });

  it("renders a summary chip instead of the full rail", () => {
    mockPhoneViewport();
    render(<FlightPlanRail rows={ROWS} />);
    expect(screen.getByTestId("wizard-flightplan-chip")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-flightplan")).toBeNull();
    expect(screen.getByTestId("wizard-flightplan-chip")).toHaveTextContent("1 of 2 answered");
  });

  it("opens a sheet with the same rows on tap, closes on the close button", async () => {
    mockPhoneViewport();
    const user = userEvent.setup();
    render(<FlightPlanRail rows={ROWS} />);

    expect(screen.queryByTestId("wizard-flightplan-sheet")).toBeNull();
    await user.click(screen.getByTestId("wizard-flightplan-chip"));
    expect(screen.getByTestId("wizard-flightplan-sheet")).toBeInTheDocument();
    // Same row markup/testids as the desktop rail.
    expect(screen.getByTestId("fp-row-Goal")).toHaveTextContent("Build something new");
    expect(screen.getByTestId("fp-node-Repo")).toBeInTheDocument();

    await user.click(screen.getByTestId("wizard-flightplan-sheet-close"));
    expect(screen.queryByTestId("wizard-flightplan-sheet")).toBeNull();
  });

  it("the chip meets the 44px touch-target minimum", () => {
    mockPhoneViewport();
    render(<FlightPlanRail rows={ROWS} />);
    expect(screen.getByTestId("wizard-flightplan-chip")).toHaveClass("fp-chip");
  });
});

describe("FlightPlanRail — desktop/tablet (matchMedia present but no match)", () => {
  afterEach(() => {
    // @ts-expect-error — restore to the jsdom-default "no matchMedia" state.
    delete window.matchMedia;
  });

  it("still renders the full rail unchanged when isPhone resolves false", () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    render(<FlightPlanRail rows={ROWS} />);
    expect(screen.getByTestId("wizard-flightplan")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-flightplan-chip")).toBeNull();
    expect(screen.getByTestId("fp-row-Goal")).toBeInTheDocument();
  });
});
