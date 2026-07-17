import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";

const mutateAsync = vi.fn();
const dispatchAutoLaunch = vi.fn(() => 1);
const launchState = { isPending: false };
const coordState: { pendingLaunch: unknown } = { pendingLaunch: null };

vi.mock("../../../hooks/useLaunchTask", () => ({
  useLaunchTask: () => ({ mutateAsync, get isPending() { return launchState.isPending; } }),
}));
vi.mock("../../../contexts/LaunchCoordinatorContext", () => ({
  useLaunchCoordinator: () => ({
    dispatchAutoLaunch,
    get pendingLaunch() { return coordState.pendingLaunch; },
  }),
}));

import { DesignGateDecision } from "./DesignGateDecision";

const TASK = { taskId: "task-gate", projectId: "p1" } as unknown as ExternalTask;

function renderBar(over: { savedRound?: number | null; onRequestChanges?: () => void } = {}) {
  return render(
    <DesignGateDecision
      task={TASK}
      savedRound={over.savedRound ?? null}
      onRequestChanges={over.onRequestChanges ?? (() => {})}
    />,
  );
}

beforeEach(() => {
  mutateAsync.mockReset();
  dispatchAutoLaunch.mockReset();
  launchState.isPending = false;
  coordState.pendingLaunch = null;
  mutateAsync.mockResolvedValue({ commands: { powershell: "P", cmd: "C", posix: "X" } });
});

describe("DesignGateDecision — one primary, existing CTA path (A14, AC3/AC4)", () => {
  // @covers FR-01.58
  it("renders Approve (primary) + Request changes + the 'Waiting on you' badge", () => {
    renderBar();
    expect(screen.getByTestId("design-gate-approve")).toBeInTheDocument();
    expect(screen.getByTestId("design-gate-request-changes")).toBeInTheDocument();
    expect(screen.getByTestId("design-gate-waiting-badge")).toHaveTextContent("Waiting on you");
  });

  // @covers FR-01.58
  it("Approve is DELIBERATE: the first click only ARMS a confirm/cancel step", () => {
    renderBar();
    fireEvent.click(screen.getByTestId("design-gate-approve"));
    expect(screen.getByTestId("design-gate-approve-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("design-gate-approve-cancel")).toBeInTheDocument();
    // No launch dispatched merely by arming.
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // @covers FR-01.58
  it("Cancel returns to the un-armed Approve without launching", () => {
    renderBar();
    fireEvent.click(screen.getByTestId("design-gate-approve"));
    fireEvent.click(screen.getByTestId("design-gate-approve-cancel"));
    expect(screen.getByTestId("design-gate-approve")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // @covers FR-01.58
  it("Confirm dispatches THAT path: launch mutate(resume:true) + coordinator auto-launch", async () => {
    renderBar();
    fireEvent.click(screen.getByTestId("design-gate-approve"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-gate-approve-confirm"));
    });
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ taskId: "task-gate", resume: true });
      expect(dispatchAutoLaunch).toHaveBeenCalledWith(
        { powershell: "P", cmd: "C", posix: "X" },
        true,
      );
    });
  });

  // @covers FR-01.58
  it("a FAILED resume surfaces the failure, does NOT flip the badge", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Session ID already in use"));
    renderBar();
    fireEvent.click(screen.getByTestId("design-gate-approve"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-gate-approve-confirm"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("design-gate-approve-error")).toHaveTextContent(
        "Session ID already in use",
      );
    });
    expect(dispatchAutoLaunch).not.toHaveBeenCalled();
    // Still "Waiting on you" — the gate lifts only when the poll clears it.
    expect(screen.getByTestId("design-gate-waiting-badge")).toBeInTheDocument();
  });

  // @covers FR-01.58
  it("Request changes opens the feedback flow (onRequestChanges), NOT a launch", () => {
    const onReq = vi.fn();
    renderBar({ onRequestChanges: onReq });
    fireEvent.click(screen.getByTestId("design-gate-request-changes"));
    expect(onReq).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // @covers FR-01.58
  it("shows the disk-derived saved-round hint when a round was written", () => {
    renderBar({ savedRound: 2 });
    expect(screen.getByTestId("design-gate-saved-hint")).toHaveTextContent("Round 2 feedback saved");
  });
});
