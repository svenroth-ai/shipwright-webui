import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MissionActivityFeed } from "./MissionActivityFeed";
import type { ActivityFeed } from "../../../lib/missionActivityFeed";
import { deriveActivityFeed } from "../../../lib/missionActivityFeed";
import { fixtureContext, longIterateFixture } from "../../../lib/missionActivityFeed.fixtures";

const renderedLongIterateFixture: ActivityFeed = {
  goal: "Make the Mission view evidence-based",
  outcome: "In progress",
  cards: Array.from({ length: 905 }, (_, index) => ({
    kind: "investigate" as const,
    text: `Recorded activity ${index + 1}`,
    commands: [`Read source ${index + 1}`],
  })),
};

describe("MissionActivityFeed", () => {
  it("renders the long-iterate fixture in a focusable, operable scrolling timeline", async () => {
    const conciseFeed = deriveActivityFeed(longIterateFixture, fixtureContext("unknown"), "Make the Mission view evidence-based");
    expect(conciseFeed.cards.length).toBeLessThanOrEqual(6);
    render(<MissionActivityFeed feed={renderedLongIterateFixture} />);
    const timeline = screen.getByTestId("mission-activity-feed");
    expect(timeline).toHaveAttribute("role", "log");
    expect(timeline).toHaveAttribute("tabindex", "0");
    expect(timeline).toHaveClass("mc-feed-scroll");
    expect(screen.getAllByText(/Recorded activity/)).toHaveLength(905);
    Object.defineProperties(timeline, {
      clientHeight: { configurable: true, value: 160 },
      scrollHeight: { configurable: true, value: 90_500 },
    });
    expect(timeline.scrollHeight).toBeGreaterThan(timeline.clientHeight);
    await userEvent.tab();
    expect(timeline).toHaveFocus();
    timeline.scrollTop = 240;
    fireEvent.wheel(timeline, { deltaY: 240 });
    expect(timeline.scrollTop).toBe(240);
    expect(screen.getByTestId("mission-feed-goal").parentElement).not.toBe(timeline);
  });

  it("opens durable evidence from a card", async () => {
    const onArtifactClick = vi.fn();
    render(<MissionActivityFeed feed={{ ...renderedLongIterateFixture, cards: [{ kind: "delivery", text: "Delivered", commands: [], artifact: "commit" }] }} onArtifactClick={onArtifactClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Open commit" }));
    expect(onArtifactClick).toHaveBeenCalledWith("commit");
  });
});
