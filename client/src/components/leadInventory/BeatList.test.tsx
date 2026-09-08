import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BeatList } from "./BeatList";
import type { BeatInventoryView } from "../../lib/leadInventoryApi";

// Fixed "now" for deterministic window math: 2026-09-08 10:00 LOCAL —
// computeLastNightWindow(now) => [yesterday 18:00 local, today 06:00 local].
const NOW = new Date(2026, 8, 8, 10, 0, 0);
const INSIDE_WINDOW = new Date(2026, 8, 8, 2, 0, 0).toISOString(); // today 02:00 local
const OUTSIDE_WINDOW = new Date(2026, 8, 7, 10, 0, 0).toISOString(); // yesterday 10:00 local

function beat(overrides: Partial<BeatInventoryView>): BeatInventoryView {
  return {
    beatId: "b1",
    startedAt: INSIDE_WINDOW,
    closedAt: null,
    steps: { status: "ok", steps: [], unreadableLines: 0 },
    unclaimedEffect: { status: "clear" },
    ...overrides,
  };
}

describe("BeatList", () => {
  it("renders a BeatCard per beat, each step as a BandChip, in order (AC-1)", () => {
    const b = beat({
      beatId: "b1",
      steps: {
        status: "ok",
        steps: [
          { at: INSIDE_WINDOW, band: "bugfix", summary: "fixed a typo", effect: { kind: "none" } },
          { at: INSIDE_WINDOW, band: "feature", summary: "added a flag", effect: { kind: "none" } },
        ],
        unreadableLines: 0,
      },
    });
    render(<BeatList beats={[b]} totalBeatsInRegister={1} now={NOW} />);
    expect(screen.getByTestId("beat-card-b1")).toBeInTheDocument();
    const steps = screen.getByTestId("beat-steps-b1");
    const chips = steps.querySelectorAll('[data-testid^="band-chip-"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAttribute("data-testid", "band-chip-bugfix");
    expect(chips[1]).toHaveAttribute("data-testid", "band-chip-feature");
  });

  it("renders a visible unclaimed-effect warning banner on the beat, with warning copy (AC-2a)", () => {
    const b = beat({ beatId: "b1", unclaimedEffect: { status: "found" } });
    render(<BeatList beats={[b]} totalBeatsInRegister={1} now={NOW} />);
    const warning = screen.getByTestId("unclaimed-effect-warning");
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toMatch(/effect no step accounts for/i);
  });

  it("does not render the warning for a clear or unknown beat", () => {
    render(
      <BeatList
        beats={[beat({ beatId: "b1", unclaimedEffect: { status: "clear" } }), beat({ beatId: "b2", unclaimedEffect: { status: "unknown" } })]}
        totalBeatsInRegister={2}
        now={NOW}
      />,
    );
    expect(screen.queryByTestId("unclaimed-effect-warning")).not.toBeInTheDocument();
  });

  it("excludes a beat outside the last-night window; includes one with an unparseable startedAt (AC-7)", () => {
    render(
      <BeatList
        beats={[
          beat({ beatId: "inside", startedAt: INSIDE_WINDOW }),
          beat({ beatId: "outside", startedAt: OUTSIDE_WINDOW }),
          beat({ beatId: "garbage", startedAt: "not-a-date" }),
        ]}
        totalBeatsInRegister={3}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("beat-card-inside")).toBeInTheDocument();
    expect(screen.queryByTestId("beat-card-outside")).not.toBeInTheDocument();
    expect(screen.getByTestId("beat-card-garbage")).toBeInTheDocument();
  });

  it("shows 'no beats yet' when the lead has never had a beat (AC-8)", () => {
    render(<BeatList beats={[]} totalBeatsInRegister={0} now={NOW} />);
    expect(screen.getByTestId("beat-list-empty-never")).toHaveTextContent("No beats yet");
  });

  it("shows a window-specific empty state when the lead has history but nothing in this window (AC-8)", () => {
    render(<BeatList beats={[beat({ beatId: "b1", startedAt: OUTSIDE_WINDOW })]} totalBeatsInRegister={5} now={NOW} />);
    expect(screen.getByTestId("beat-list-empty-window")).toBeInTheDocument();
    expect(screen.queryByTestId("beat-list-empty-never")).not.toBeInTheDocument();
  });

  it("renders 'steps unavailable' for an unreadable steps read, not 'no steps reported'", () => {
    render(<BeatList beats={[beat({ beatId: "b1", steps: { status: "unreadable" } })]} totalBeatsInRegister={1} now={NOW} />);
    expect(screen.getByTestId("beat-steps-unavailable-b1")).toHaveTextContent("Steps unavailable");
  });

  it("renders 'steps unavailable' when every line was malformed (AC-10), distinct from a genuinely empty contribution", () => {
    render(
      <BeatList
        beats={[beat({ beatId: "b1", steps: { status: "ok", steps: [], unreadableLines: 2 } })]}
        totalBeatsInRegister={1}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("beat-steps-unavailable-b1")).toHaveTextContent("Steps unavailable");
  });

  it("renders 'no steps reported' for a genuinely empty, error-free contribution (AC-10)", () => {
    render(
      <BeatList
        beats={[beat({ beatId: "b1", steps: { status: "ok", steps: [], unreadableLines: 0 } })]}
        totalBeatsInRegister={1}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("beat-steps-none-b1")).toHaveTextContent("No steps reported");
  });

  it("shows an 'in progress' label only when closedAt is null", () => {
    render(
      <BeatList
        beats={[beat({ beatId: "open", closedAt: null }), beat({ beatId: "closed", closedAt: INSIDE_WINDOW })]}
        totalBeatsInRegister={2}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("beat-in-progress-open")).toBeInTheDocument();
    expect(screen.queryByTestId("beat-in-progress-closed")).not.toBeInTheDocument();
  });
});
