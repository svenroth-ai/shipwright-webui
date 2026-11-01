import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { MissionAgents } from "../../../hooks/useMissionAgents";
import type { SessionSubagent } from "../../../lib/sessionInfoApi";
import { SubrunnerPanelHost } from "./SubrunnerPanelHost";

vi.mock("../../../hooks/useSubagentTranscript", () => ({ useSubagentTranscript: () => ({ data: undefined }) }));

const ID = "afb588e7c229aa880";
const agent = { agentId: ID, agentType: "general-purpose", description: "Audit", toolUseId: null, spawnDepth: 1, parentAgentId: null, model: null, prompt: null, answer: "Let me write up the findings.", startedAt: null, endedAt: null, durationMs: null, state: "finished", status: "completed", tokens: null, toolUses: null } as SessionSubagent;
const agents = { agents: [agent], openFor: vi.fn(), canOpen: () => true } as unknown as MissionAgents;
const sub: ActivityCard = { kind: "subrunner", text: "Audit", commands: [], subrunnerId: ID, subrunnerStatus: "done" };
const hb = (t: string): ActivityCard => ({ kind: "handback", text: t, commands: [], handbackSender: ID, handbackOrigin: "subagent", handbackText: t } as unknown as ActivityCard);

describe("SubrunnerPanelHost", () => {
  // @covers FR-01.66
  it("shows the final hand-back, not the agent's preamble prose", () => {
    render(<SubrunnerPanelHost taskId="t1" card={sub} cards={[hb("progress"), hb("FINAL REPORT")]} agents={agents} onClose={() => {}} />);
    expect(screen.getByTestId("subrunner-report").textContent).toContain("FINAL REPORT");
  });

  // @covers FR-01.66
  it("jumps to the LAST hand-back from that agent in the chat", async () => {
    const feed = document.createElement("div");
    feed.setAttribute("data-testid", "mission-activity-feed");
    const mk = () => { const el = document.createElement("article"); el.setAttribute("data-sender", ID); el.tabIndex = -1; el.scrollIntoView = vi.fn(); feed.appendChild(el); return el; };
    const first = mk(); const last = mk();
    document.body.appendChild(feed);
    render(<SubrunnerPanelHost taskId="t1" card={sub} cards={[hb("progress"), hb("FINAL")]} agents={agents} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("subrunner-jump-chat"));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(last.scrollIntoView).toHaveBeenCalled();
    expect(first.scrollIntoView).not.toHaveBeenCalled();
    feed.remove();
  });

  // @covers FR-01.66
  it("says the agent is still running instead of claiming no report exists", () => {
    render(<SubrunnerPanelHost taskId="t1" card={{ ...sub, subrunnerStatus: "running" }} cards={[hb("progress")]} agents={agents} onClose={() => {}} />);
    expect(screen.getByTestId("subrunner-no-report").textContent).toBe("Still running - no answer yet.");
  });

  // @covers FR-01.66
  it("an agent whose status has not landed yet still counts as finished when the card says done", () => {
    const lagging = { ...agents, agents: [{ ...agent, status: null, answer: null }] } as unknown as MissionAgents;
    render(<SubrunnerPanelHost taskId="t1" card={sub} cards={[]} agents={lagging} onClose={() => {}} />);
    expect(screen.queryByTestId("subrunner-no-report")?.textContent ?? "").not.toBe("Still running - no answer yet.");
  });
});
