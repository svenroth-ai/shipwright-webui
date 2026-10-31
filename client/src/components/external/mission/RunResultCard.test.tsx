import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissionActivityFeed } from "./MissionActivityFeed";
import { SubrunnerRow } from "./SubrunnerRow";
import { formatElapsed } from "./MissionActivityFeedCardParts";
import type { ActivityFeed } from "../../../lib/missionActivityFeed";
import type { CommitArtifact } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";

vi.mock("../../../hooks/useLaunchTask", () => ({ useLaunchTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
const TASK = { taskId: "t", projectId: "p1" } as unknown as ExternalTask;
const COMMIT: CommitArtifact = {
  kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null,
  detail: { type: "commit", commit: "abc", message: "feat: mission chat", prNumber: 549, prUrl: "https://x/y/pull/549", merge: "merged" },
};
const FEED: ActivityFeed = {
  outcome: "Completed run",
  cards: [
    { kind: "implement", text: "I built it.", commands: [] },
    { kind: "test", text: "Tests have a recorded passing result.", commands: [], artifact: "tests", status: "ok" },
    { kind: "spec", text: "Changed Mission view (1 requirement).", commands: [], artifact: "requirement", status: "ok" },
    { kind: "spec", text: "Mission chat decision.", commands: [], artifact: "decisions", status: "ok" },
    { kind: "review", text: "The recorded review evidence is available.", commands: [], artifact: "review", status: "ok" },
    { kind: "delivery", text: "Merged as \"feat: mission chat\".", commands: [], artifact: "commit" },
  ],
};

describe("Run result card (V2)", () => {
  // @covers FR-01.66
  it("renders ONE card: text pill + statement + one action named after the target per row, commit last", async () => {
    const onArtifact = vi.fn();
    render(<MissionActivityFeed feed={FEED} commitArtifact={COMMIT} task={TASK} onArtifactClick={onArtifact} />);
    expect(screen.getAllByTestId("run-result-card")).toHaveLength(1);
    expect(screen.getByText("Run result")).toBeInTheDocument();
    const rows = screen.getAllByTestId("run-result-row");
    expect(rows.map((r) => r.getAttribute("data-artifact"))).toEqual(["tests", "requirement", "decisions", "review"]);
    expect(within(rows[0]).getByText("Passing")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Recorded")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Passed")).toBeInTheDocument();
    const names = rows.map((r) => within(r).getByRole("button").textContent);
    expect(names).toEqual(["Tests", "Requirement", "Decision", "Review"]);
    const delivery = screen.getByTestId("run-result-delivery");
    expect(delivery).toHaveTextContent("feat: mission chat");
    expect(delivery).toHaveTextContent("#549");
    expect(within(delivery).getByText("merged")).toBeInTheDocument();
    expect(delivery.compareDocumentPosition(rows[3]) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // One button per row plus the commit row - the separate per-card "Open ..." lines are gone.
    expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(5);
    await userEvent.click(within(rows[2]).getByRole("button"));
    expect(onArtifact).toHaveBeenCalledWith("decisions");
  });

  // @covers FR-01.66
  it("every pill is text (a failing test says Failing)", () => {
    render(<MissionActivityFeed feed={{ outcome: "x", cards: [{ kind: "test", text: "", commands: [], artifact: "tests", status: "err" }] }} commitArtifact={null} task={TASK} />);
    expect(screen.getByText("Failing")).toBeInTheDocument();
  });
});

describe("SubrunnerRow (V2)", () => {
  const base = { kind: "subrunner" as const, text: "Build M5 desktop-style chat", commands: [], subrunnerId: "ag1", subrunnerType: "sub-iterate-runner", timestamp: "2026-10-31T10:00:00Z" };
  // @covers FR-01.66
  it("done: agent chip, title, 'Subagent - type - finished in N min', Report action", async () => {
    const open = vi.fn();
    render(<SubrunnerRow card={{ ...base, subrunnerStatus: "done", subrunnerEndedAt: "2026-10-31T10:44:00Z" }} onSubrunnerClick={open} />);
    expect(screen.getByText("Build M5 desktop-style chat")).toBeInTheDocument();
    expect(screen.getByText("Subagent · sub-iterate-runner · finished in 44 min")).toBeInTheDocument();
    expect(screen.getByTestId("subrunner-pill")).toHaveTextContent("Done");
    expect(screen.getByRole("button")).toHaveTextContent("Report");
    await userEvent.click(screen.getByRole("button", { name: "View subrunner report" }));
    expect(open).toHaveBeenCalledWith("ag1");
  });

  // @covers FR-01.66
  it("running: 'running' in words and a View action only when the agent can open", () => {
    const { rerender } = render(<SubrunnerRow card={{ ...base, subrunnerStatus: "running" }} onSubrunnerClick={vi.fn()} canOpenAgent={() => false} />);
    expect(screen.getByTestId("subrunner-row")).toHaveTextContent("running");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<SubrunnerRow card={{ ...base, subrunnerStatus: "running" }} onSubrunnerClick={vi.fn()} canOpenAgent={() => true} />);
    expect(screen.getByRole("button")).toHaveTextContent("View");
  });

  // @covers FR-01.66
  it("failed/killed say so in words", () => {
    render(<SubrunnerRow card={{ ...base, subrunnerStatus: "failed", subrunnerEndStatus: "killed", subrunnerEndedAt: "2026-10-31T10:05:00Z" }} onSubrunnerClick={vi.fn()} />);
    expect(screen.getByText(/killed after 5 min/)).toBeInTheDocument();
    expect(screen.getByTestId("subrunner-pill")).toHaveTextContent("Killed");
  });

  // @covers FR-01.66
  it("an unparseable end time degrades to the bare verb (no throw, no NaN)", () => {
    render(<SubrunnerRow card={{ ...base, subrunnerStatus: "done", subrunnerEndedAt: "not-a-date" }} />);
    expect(screen.getByText("Subagent · sub-iterate-runner · finished")).toBeInTheDocument();
    expect(screen.getByTestId("subrunner-pill")).toHaveTextContent("Done");
  });

  // @covers FR-01.66
  it("formatElapsed handles missing/invalid and hours", () => {
    expect(formatElapsed(undefined, "x")).toBeNull();
    expect(formatElapsed("2026-10-31T10:00:00Z", "2026-10-31T10:00:20Z")).toBe("under 1 min");
    expect(formatElapsed("2026-10-31T10:00:00Z", "2026-10-31T11:05:00Z")).toBe("1 h 5 min");
  });
});
