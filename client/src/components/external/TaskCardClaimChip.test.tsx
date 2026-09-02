/*
 * ClaimChip — FR-04.22 (iterate-2026-09-02-claim-chip-filter).
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ClaimChip } from "./TaskCardClaimChip";
import type { ExternalTask } from "../../lib/externalApi";

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Audit drift",
    cwd: "/tmp/project",
    pluginDirs: [],
    projectId: "project-001",
    state: "draft",
    createdAt: "2026-04-23T15:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

describe("ClaimChip (FR-04.22)", () => {
  // @covers FR-04.22
  it("renders nothing when the task is unclaimed", () => {
    render(<ClaimChip task={baseTask()} />);
    expect(screen.queryByTestId("task-card-claim-task-1")).toBeNull();
  });

  // @covers FR-04.22
  it("shows who holds the card and since when once claimed", () => {
    render(
      <ClaimChip
        task={baseTask({ claimedBy: "po-agent", claimedAt: new Date(Date.now() - 5 * 60_000).toISOString() })}
      />,
    );
    const chip = screen.getByTestId("task-card-claim-task-1");
    expect(chip.textContent).toContain("po-agent");
    expect(screen.getByTestId("task-card-claim-since-task-1").textContent).toContain("m ago");
  });

  // @covers FR-04.22
  it("keys off claimedBy, NOT state — renders while state is 'done'", () => {
    // Proves acceptance (b): the display reads claimedBy/claimedAt, never
    // `state`. leadwright's claimTask still sets state="active" today, but
    // section 5.2 says that falls without replacement in L11 — a card
    // claimed while state is anything else must still show the chip.
    render(<ClaimChip task={baseTask({ state: "done", claimedBy: "po-agent" })} />);
    expect(screen.getByTestId("task-card-claim-task-1")).toBeTruthy();
  });

  // @covers FR-04.22
  it("renders without the 'since' span when claimedAt is missing", () => {
    render(<ClaimChip task={baseTask({ claimedBy: "po-agent" })} />);
    expect(screen.getByTestId("task-card-claim-task-1")).toBeTruthy();
    expect(screen.queryByTestId("task-card-claim-since-task-1")).toBeNull();
  });
});
