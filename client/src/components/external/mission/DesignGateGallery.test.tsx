import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { DesignScreen } from "../../../lib/designManifest";
import type { DesignScreensResult } from "../../../hooks/useDesignScreens";

const screensMock = vi.fn<() => DesignScreensResult>();
vi.mock("../../../hooks/useDesignScreens", () => ({
  useDesignScreens: () => screensMock(),
}));

import { DesignGateGallery } from "./DesignGateGallery";

const SCREENS: DesignScreen[] = [
  { number: 1, name: "dashboard", file: "screens/01-dashboard.html", status: "complete", frs: ["FR-01.09"] },
  { number: 2, name: "settings", file: "screens/02-settings.html", status: "complete", frs: [] },
];

function result(over: Partial<DesignScreensResult>): DesignScreensResult {
  return { screens: [], isLoading: false, isResolved: true, isError: false, ...over };
}

afterEach(() => screensMock.mockReset());

describe("DesignGateGallery — real previews, honest empty (A14, AC5/AC7)", () => {
  // @covers FR-01.45
  it("renders one card per pending screen, with FR id + name", () => {
    screensMock.mockReturnValue(result({ screens: SCREENS }));
    render(<DesignGateGallery projectId="p1" onOpenPreview={() => {}} />);

    const cards = screen.getAllByTestId("design-gate-screen");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    expect(screen.getByText("FR-01.09")).toBeInTheDocument();
    expect(screen.getByText("settings")).toBeInTheDocument();
  });

  // @covers FR-01.45
  it("each card is a REAL hosted preview iframe (not a dead thumbnail)", () => {
    screensMock.mockReturnValue(result({ screens: SCREENS }));
    render(<DesignGateGallery projectId="p1" onOpenPreview={() => {}} />);

    const frames = screen.getAllByTestId("design-gate-screen-frame");
    expect(frames).toHaveLength(2);
    expect(frames[0].getAttribute("src")).toContain(
      "/projects/p1/designs/screens/01-dashboard.html",
    );
  });

  // @covers FR-01.45
  it("clicking a card opens the real preview (onOpenPreview)", () => {
    const onOpen = vi.fn();
    screensMock.mockReturnValue(result({ screens: SCREENS }));
    render(<DesignGateGallery projectId="p1" onOpenPreview={onOpen} />);

    fireEvent.click(screen.getAllByTestId("design-gate-screen-open")[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.45
  it("gate open + zero screens → honest empty state, NEVER a fabricated grid", () => {
    screensMock.mockReturnValue(result({ screens: [], isResolved: true }));
    render(<DesignGateGallery projectId="p1" onOpenPreview={() => {}} />);

    expect(screen.getByTestId("design-gate-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("design-gate-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("design-gate-empty")).toHaveTextContent(/no previews were emitted/i);
  });

  // @covers FR-01.45
  it("a REAL load failure → an honest 'couldn't load' state, NOT 'no previews'", () => {
    screensMock.mockReturnValue(result({ screens: [], isResolved: true, isError: true }));
    render(<DesignGateGallery projectId="p1" onOpenPreview={() => {}} />);

    expect(screen.getByTestId("design-gate-error")).toBeInTheDocument();
    expect(screen.queryByTestId("design-gate-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("design-gate-grid")).not.toBeInTheDocument();
    // The count is not reported as 0 on error.
    expect(screen.getByTestId("mission-line")).toHaveTextContent("Screens are ready for your eyes.");
  });

  // @covers FR-01.45
  it("a screen row with no file → an honest per-card placeholder, not a fake thumb", () => {
    screensMock.mockReturnValue(
      result({
        screens: [{ number: 1, name: "orphan", file: "", status: null, frs: [] }],
      }),
    );
    render(<DesignGateGallery projectId="p1" onOpenPreview={() => {}} />);

    expect(screen.getByTestId("design-gate-screen-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("design-gate-screen-frame")).not.toBeInTheDocument();
  });

  // @covers FR-01.45
  it("mission-line count comes from the narrator (2 screens → the plural line)", () => {
    screensMock.mockReturnValue(result({ screens: SCREENS }));
    render(<DesignGateGallery projectId="p1" onOpenPreview={() => {}} />);
    expect(screen.getByTestId("mission-line")).toHaveTextContent(
      "2 screens are ready for your eyes.",
    );
    expect(screen.getByTestId("mission-line")).toHaveTextContent(
      "Nothing gets built until you approve.",
    );
  });

  // @covers FR-01.45
  it("while the manifest is still loading, the count is DROPPED (never guessed)", () => {
    screensMock.mockReturnValue(result({ screens: [], isResolved: false, isLoading: true }));
    render(<DesignGateGallery projectId="p1" onOpenPreview={() => {}} />);
    // No number, and no premature empty-state flash.
    expect(screen.getByTestId("mission-line")).toHaveTextContent(
      "Screens are ready for your eyes.",
    );
    expect(screen.queryByTestId("design-gate-empty")).not.toBeInTheDocument();
  });
});
