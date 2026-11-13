// @covers FR-01.30
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TriageProjectStatus as Status } from "../../hooks/useTriage";
import { TriageProjectStatus } from "./TriageProjectStatus";

const status = (over: Partial<Status> = {}): Status => ({
  projectId: "proj-a",
  isLoading: false,
  isError: false,
  behind: 0,
  originAvailable: true,
  refetch: vi.fn(),
  ...over,
});

const renderStatus = (statuses: Status[], named = false) =>
  render(<TriageProjectStatus statuses={statuses} nameOf={(id) => `Name ${id}`} named={named} />);

describe("TriageProjectStatus behind-origin alert", () => {
  // @covers FR-01.30
  it("shows ONE alert; the popover names the project and how far behind", async () => {
    renderStatus([status({ behind: 3 }), status({ projectId: "proj-b", behind: 1 })], true);
    expect(screen.getAllByTestId("triage-behind-alert")).toHaveLength(1);
    expect(screen.getByTestId("triage-behind-alert")).toHaveTextContent("Projects behind origin");
    expect(screen.queryByTestId("triage-behind-popover")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId("triage-behind-alert"));
    expect(await screen.findByTestId("triage-behind-proj-a")).toHaveTextContent("Name proj-a: 3 commits behind origin");
    expect(screen.getByTestId("triage-behind-proj-b")).toHaveTextContent("1 commit behind origin");
  });

  // @covers FR-01.30
  it("hover opens it for a mouse and leaving closes it again", async () => {
    renderStatus([status({ behind: 2 })]);
    const user = userEvent.setup();
    await user.hover(screen.getByTestId("triage-behind-alert"));
    expect(await screen.findByTestId("triage-behind-popover")).toBeInTheDocument();
    await user.unhover(screen.getByTestId("triage-behind-alert"));
    await waitFor(() => expect(screen.queryByTestId("triage-behind-popover")).not.toBeInTheDocument());
  });

  // @covers FR-01.30
  it("a tap (click with no hover) toggles it open and shut; the keyboard opens and Escape closes it", async () => {
    renderStatus([status({ behind: 2 })]);
    const alert = screen.getByTestId("triage-behind-alert");
    fireEvent.click(alert);
    expect(await screen.findByTestId("triage-behind-popover")).toHaveAccessibleName("Projects behind origin");
    fireEvent.click(alert);
    await waitFor(() => expect(screen.queryByTestId("triage-behind-popover")).not.toBeInTheDocument());
    const user = userEvent.setup();
    alert.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("triage-behind-popover")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("triage-behind-popover")).not.toBeInTheDocument());
  });

  // @covers FR-01.30
  it("is hidden when in sync (behind 0) or when behind is unknown", () => {
    const { unmount } = renderStatus([status({ behind: 0 })]);
    expect(screen.queryByTestId("triage-behind-alert")).not.toBeInTheDocument();
    unmount();
    renderStatus([status({ behind: null, originAvailable: false })]);
    expect(screen.queryByTestId("triage-behind-alert")).not.toBeInTheDocument();
  });

  // @covers FR-01.30
  it("adds a ghost-risk note in the popover only when origin is unavailable (degraded)", async () => {
    renderStatus([status({ behind: 2, originAvailable: false })]);
    await userEvent.setup().click(screen.getByTestId("triage-behind-alert"));
    const line = await screen.findByTestId("triage-behind-proj-a");
    expect(line).toHaveTextContent("2 commits behind origin");
    expect(line).toHaveTextContent("already-dismissed items may still appear");
  });
});
