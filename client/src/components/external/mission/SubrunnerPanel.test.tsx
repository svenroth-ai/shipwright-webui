/*
 * SubrunnerPanel.test.tsx — the third `activeNode` right-panel consumer
 * (iterate-2026-09-26-mission-tab-subrunner), alongside `ArtifactPanel.test.tsx`
 * and `MissionArtifactPanel.test.tsx`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SubrunnerPanel } from "./SubrunnerPanel";
import type { ActivityCard } from "../../../lib/missionActivityFeed";

const RESOLVED_CARD: ActivityCard = {
  kind: "subrunner",
  text: "Run the migration script",
  commands: [],
  subrunnerId: "agent-42",
  subrunnerStatus: "done",
  subrunnerReport: "Migration complete.",
};

function setup(card: ActivityCard = RESOLVED_CARD) {
  const onClose = vi.fn();
  render(<SubrunnerPanel card={card} onClose={onClose} />);
  return { onClose };
}

describe("SubrunnerPanel", () => {
  it("renders the dispatch description and the subagent's report", () => {
    setup();
    expect(screen.getByTestId("subrunner-panel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run the migration script" })).toBeInTheDocument();
    expect(screen.getByTestId("subrunner-report")).toHaveTextContent("Migration complete.");
  });

  it("prefers the full report over the bounded excerpt when both are set", () => {
    setup({ ...RESOLVED_CARD, subrunnerReport: "Short excerpt…", subrunnerReportFull: "The complete, unabridged report." });
    expect(screen.getByTestId("subrunner-report")).toHaveTextContent("The complete, unabridged report.");
  });

  it("shows an honest empty state when no report was ever recorded", () => {
    setup({ ...RESOLVED_CARD, subrunnerReport: undefined });
    expect(screen.queryByTestId("subrunner-report")).not.toBeInTheDocument();
    expect(screen.getByText("No report was recorded for this subrunner.")).toBeInTheDocument();
  });

  it("the close button fires onClose", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("artifact-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the panel", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the scrim closes the panel", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("artifact-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the close control on open and restores focus to the trigger on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<SubrunnerPanel card={RESOLVED_CARD} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByTestId("artifact-close"));

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
