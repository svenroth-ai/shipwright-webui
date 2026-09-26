import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { MissionActivityFeed } from "./MissionActivityFeed";
import type { ExternalTask } from "../../../lib/externalApi";

const mutateAsync = vi.fn().mockResolvedValue({ commands: { posix: "claude --resume x", powershell: "claude --resume x" } });
vi.mock("../../../hooks/useLaunchTask", () => ({
  useLaunchTask: () => ({ mutateAsync, isPending: false }),
}));

const TASK = { taskId: "task-mission-feed", projectId: "p1" } as unknown as ExternalTask;

// iterate-2026-09-26-mission-tab-subrunner: per-card timestamps and kind
// labels were removed site-wide (item 6) — replaced by a single one-time
// "Session started" divider derived from the first timestamped card.
// Supersedes the per-card `FeedTime` coverage this suite held under
// iterate-2026-08-31-mission-feed-gaps. Split out of `MissionActivityFeed.
// test.tsx` (external code review round) so that file's line count stays
// under the 300-line convention — a cohesive extraction, not line-merging.
describe("session-start divider", () => {
  // external code review, low: was asserting only that a time string
  // appeared somewhere — also passed for a divider in the wrong position
  // or missing its "Today"/"Session started" framing. Fixed clock pins
  // "Today"; DOM order confirms it's the scroll container's first child.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders once, derived from the first card that carries a timestamp, above the first card entry", () => {
    const at = "2026-08-31T09:15:00.000Z";
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [
        { kind: "goal", text: "Started a run.", commands: [] },
        { kind: "implement", text: "Edited the login handler.", commands: [], timestamp: at },
        { kind: "test", text: "Ran the suite.", commands: [], timestamp: "2026-08-31T09:16:00.000Z" },
      ],
    }} commitArtifact={null} task={TASK} />);
    const dividers = screen.getAllByTestId("mission-feed-session-start");
    expect(dividers).toHaveLength(1);
    const expectedTime = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(dividers[0]).toHaveTextContent(`Session started · Today, ${expectedTime}`);
    const scroll = container.querySelector(".mc-feed-scroll");
    expect(scroll?.firstElementChild).toBe(dividers[0]);
    expect(scroll?.querySelectorAll(".mc-feed-entry")).toHaveLength(3);
  });

  it("renders nothing when no card carries a timestamp (older transcripts)", () => {
    const { queryByTestId } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [{ kind: "implement", text: "Edited the login handler.", commands: [] }],
    }} commitArtifact={null} task={TASK} />);
    expect(queryByTestId("mission-feed-session-start")).toBeNull();
  });

  it("no card renders a kind label or a per-card time (item 6)", () => {
    const { container } = render(<MissionActivityFeed feed={{
      outcome: "In progress",
      cards: [
        { kind: "implement", text: "Edited the login handler.", commands: [], timestamp: "2026-08-31T09:15:00.000Z" },
        { kind: "system", text: "Context automatically compacted.", commands: [], timestamp: "2026-08-31T09:16:00.000Z" },
      ],
    }} commitArtifact={null} task={TASK} />);
    expect(container.querySelector(".mc-feed-kind")).toBeNull();
    expect(container.querySelector(".mc-feed-time")).toBeNull();
    expect(screen.queryByText("Implement")).toBeNull();
    expect(screen.queryByText("System")).toBeNull();
  });
});
