import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDataJoin, RunDetailResponse } from "../../../lib/runDataApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));
// FR-01.67: useMissionLive now consults useCampaigns (dormant for non-campaign
// titles). Stub it so this shell test needs no QueryClient provider.
vi.mock("../../../hooks/useCampaigns", () => ({
  useCampaigns: () => ({ data: [] }),
}));
// A14's gate body (rendered by OperationCard in designgate mode) carries its own
// tests + needs QueryClient / LaunchCoordinator providers; stub it so this shell
// test stays about the three-card routing.
vi.mock("./DesignGateCard", () => ({
  DesignGateCard: () => <div data-testid="design-gate-card-stub" />,
}));
// S1 — MissionBody now consults the mission-context resolver. Stubbed to
// "resolved nothing" here so these cases keep asserting the LEGACY rail
// (scenarios 1/3/4/5), which is exactly the no-regression contract. The
// context-driven rail has its own cases in MissionBody.context.test.tsx.
vi.mock("../../../hooks/useMissionContext", () => ({
  useMissionContext: () => ({ data: undefined }),
  useArtifactDocument: () => ({ data: undefined, isPending: false, isError: false }),
}));

import { MissionBody } from "./MissionBody";

const TASK = {
  projectId: "p1",
  runId: "iterate-2026-07-16-x",
  title: "Survey the hull",
} as unknown as ExternalTask;

const COMPLETED_RUN = {
  runId: "iterate-2026-07-16-x",
  summary: "Ship the survey",
  commit: "abc1234",
  affectedFrs: ["FR-01.66"],
  specImpact: "add",
  tests: { passed: 12, total: 12 },
  gates: { derived: true, review: "pass" },
} as unknown as RunDataJoin;

afterEach(() => {
  missionStateMock.mockReset();
  runDetailMock.mockReset();
});

function setup(transcript = "", onOpenDocument = vi.fn()) {
  render(
    <MissionBody task={TASK} transcriptContent={transcript} onOpenDocument={onOpenDocument} />,
  );
  return { onOpenDocument };
}

// @covers FR-01.66
describe("MissionBody — the redesigned left panel + live/verdict middle", () => {
  it("root is a bounded flex column so each card scrolls internally, not the page", () => {
    // Regression guard (iterate-2026-07-23-mission-viewer-scroll-popout):
    // `.mc-body` is `flex:1; min-height:0`, which is INERT unless its parent is a
    // flex container. If this wrapper reverts to a bare block the three-card row
    // grows to content height and the shell scroller (`.scene-fore`) scrolls the
    // WHOLE PAGE instead of each card scrolling internally. jsdom cannot measure
    // scroll geometry — the class contract is the cheap fence; the real geometry
    // lives in e2e/flows/mission-viewer-scroll-popout.spec.ts.
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup();
    const root = screen.getByTestId("task-detail-mission");
    const classes = root.className.split(/\s+/);
    for (const cls of ["flex", "flex-col", "min-h-0", "flex-1"]) {
      expect(classes).toContain(cls);
    }
  });

  it("renders the left panel + a middle card with no active node; no scrim", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();
    expect(screen.getByTestId("operation-card")).toBeInTheDocument();
    // No active node → no artifact card, therefore no scrim behind the row.
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-scrim")).not.toBeInTheDocument();
  });

  it("a live session with no run row shows the activity feed, NOT 'No run data yet'", () => {
    missionStateMock.mockReturnValue("live");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    const transcript = JSON.stringify({
      type: "assistant",
      message: { content: [
        { type: "text", text: "Fixing the login redirect." },
        { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x/login.tsx" } },
      ] },
    });
    setup(transcript);
    expect(screen.getByTestId("mission-activity-feed")).toBeInTheDocument();
    // Its own real command chip stays collapsed by default
    // (iterate-2026-09-16-mission-feed-render-fidelity) behind a count toggle
    // — a wordless tool-only card would now be dropped entirely by the
    // empty-tool-only-card filter (iterate-2026-09-20-mission-feed-
    // transcript-fidelity), so this fixture carries real narration.
    fireEvent.click(screen.getByRole("button", { name: "1 command" }));
    expect(screen.getByTestId("mission-activity-feed")).toHaveTextContent("Edit: /x/login.tsx");
    expect(screen.queryByText(/No run data yet/i)).not.toBeInTheDocument();
    // The left panel shows the business summary + the inferred stage.
    expect(screen.getByTestId("mission-summary")).toHaveTextContent("Survey the hull");
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Build");
  });

  it("no run AND no transcript → honest waiting, no fabricated activity (AC3)", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup("");
    expect(screen.getByTestId("mission-activity-feed")).toHaveTextContent(/waiting/i);
    // Stage is "—" when it cannot be derived (never guessed).
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "none");
    expect(screen.getByTestId("mission-stage-none")).toBeInTheDocument();
  });

  it("a COMPLETED run shows its activity feed directly + artifact links (AC2)", () => {
    // The separate verdict/proof header above the feed was removed for a
    // completed run (Sven: it read as redundant clutter, iterate-2026-09-16-
    // mission-feed-render-fidelity) — the activity feed is the sole middle
    // content, same as a live run.
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse });
    // 40th-round catch (glm, low, test), FIXED: this case used to pass an
    // EMPTY transcript and then assert mostly absences, so it would have
    // passed on a completed run that rendered nothing but the artifact rail.
    // A real transcript + a real card assertion below pin CONTENT, not just
    // the container. (`useMissionContext` is stubbed to `undefined` for this
    // whole file, so the card below is transcript-derived, never synthesized
    // from MissionContext — that synthesis path is the companion file's.)
    setup(JSON.stringify({
      type: "assistant",
      message: { content: [
        { type: "text", text: "Fixing the login redirect." },
        { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x/login.tsx" } },
      ] },
    }));
    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proof-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mission-completed-stack")).not.toBeInTheDocument();
    expect(screen.getByTestId("mission-activity-feed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1 command" }));
    expect(screen.getByTestId("mission-activity-feed")).toHaveTextContent("Edit: /x/login.tsx");
    // The audit trail is preserved as clickable artifact links.
    for (const key of ["req", "spec", "tests", "review", "commit"] as const) {
      expect(screen.getByTestId(`record-node-${key}`)).toBeInTheDocument();
    }
    // Stage is a done, terminal Merge (FR-01.67).
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Merge");
  });

  it("a terminal task with NO MissionContext still renders the feed's honest waiting state, never a blank middle", () => {
    // 40th-round catch (glm, medium), DECLINED — its premise is false. glm
    // reads the removal of the `completed`/`OperationCard` branch as leaving
    // "a completely empty middle panel" when the context fetch returned null
    // AND the transcript contributes no cards. `useMissionContext` is stubbed
    // to `{ data: undefined }` for this WHOLE file, so this test IS that arm,
    // and the middle is not empty: `MissionActivityFeed` always renders its
    // pinned outcome header plus an explicit empty state. What glm's arm
    // really loses is the runDetail-derived verdict banner + proof summary —
    // which is exactly what Sven asked to remove, "removed rather than
    // conditionally hidden" per this iterate's spec note; re-mounting it for
    // `feed.cards.length === 0 && context == null` would be that conditional
    // hiding, inverted. And it needs a TRIPLE fault to be visible at all: the
    // context request failing while the run request succeeds, plus an empty
    // transcript for a task whose run IS recorded (so its JSONL exists and
    // also failed to read) — transient, and self-healing on the next 10 s
    // `MISSION_CONTEXT_POLL_MS` refetch. An honest "nothing reliable yet"
    // beats a resurrected header for that window. The 54th round (glm, low)
    // re-read this and asked only that it be logged as a CONSCIOUS acceptance
    // rather than an oversight — it is, and this test is the pin. The 55th
    // agrees it is spec-sanctioned and names the remediation IF it is ever
    // reported: thread the runDetail gate into the feed's EMPTY STATE, never
    // resurrect the header.
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse });
    setup("");
    // 48th-round catch (glm, low, test), ANSWERED: `operation-card` is carried
    // by three components (MissionActivityFeed / OperationCard / OperationLive),
    // so glm asked whether this could match a stale OperationCard. It cannot —
    // `getByTestId` THROWS on multiple matches, and the string asserted next
    // lives only in `MissionActivityFeed.tsx`. Both together resolve the testid
    // to the feed unambiguously; a stale mount would fail, not silently pass.
    // 65th (glm, low, test) accepts that and notes only that the copy lives
    // cross-file, so a wording change fails this for an unrelated reason. No
    // change: that coupling is exactly what resolves the testid, and a loud
    // failure on a copy change is the cheap half of the trade. Re-raised 82nd
    // (glm, low, "Acceptable as-is") — same disposition, same reason.
    const middle = screen.getByTestId("operation-card");
    expect(middle).toHaveTextContent("Waiting for reliable evidence");
    expect(middle).toHaveTextContent("Waiting — nothing reliable has appeared yet.");
    expect(screen.queryByTestId("mission-completed-stack")).not.toBeInTheDocument();
  });

  it("clicking an artifact link opens the RIGHT panel; re-click closes it", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse });
    setup("");
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
  });

  it("the design-gate mode routes the middle to A14's design-gate surface", () => {
    missionStateMock.mockReturnValue("designgate");
    runDetailMock.mockReturnValue({ data: undefined });
    setup();
    expect(screen.getByTestId("design-gate-card-stub")).toBeInTheDocument();
  });

  it("'Open full document' fires the parent callback and closes the panel", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse });
    const { onOpenDocument } = setup("");
    fireEvent.click(screen.getByTestId("record-node-commit"));
    fireEvent.click(screen.getByTestId("artifact-open-document"));
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
  });

  // iterate-2026-09-26-mission-tab-subrunner — the third `activeNode`
  // consumer (`SubrunnerPanel`), end-to-end: dispatch -> ack -> resolving
  // `task-notification`, then the click-to-open/close wiring itself.
  it("clicking a resolved subrunner card's report link opens SubrunnerPanel with its report; the scrim closes it", () => {
    missionStateMock.mockReturnValue("live");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    const dispatch = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Run the migration script" } }] } });
    const ack = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Async agent launched successfully. agentId: agent-42" }] } });
    const notification = JSON.stringify({ type: "user", message: { role: "user", content: "<task-notification>\n<task-id>agent-42</task-id>\n<status>completed</status>\n<summary>Done</summary>\n<result>Full migration report.</result>\n</task-notification>" }, origin: { kind: "task-notification" } });
    setup([dispatch, ack, notification].join("\n"));
    fireEvent.click(screen.getByRole("button", { name: "View subrunner report" }));
    expect(screen.getByTestId("subrunner-panel")).toHaveTextContent("Run the migration script");
    expect(screen.getByTestId("subrunner-report")).toHaveTextContent("Full migration report.");
    fireEvent.click(screen.getByTestId("artifact-scrim"));
    expect(screen.queryByTestId("subrunner-panel")).not.toBeInTheDocument();
  });
});
