/**
 * V3: the Agents window's surfaces - list dot only for running agents, transcript in chat classes with a
 * prompt card, agent-hash chips open the agent, subrunner panel never shows the delivered-to-you pointer.
 * @covers FR-01.66
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AgentTranscriptFeed } from "./AgentTranscriptFeed";
import { AgentsList } from "./AgentsList";
import { SubrunnerPanel } from "./SubrunnerPanel";
import { AgentLinkProvider } from "../AgentLinkContext";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { buildAgentFeed } from "../../../lib/agentTranscriptFeed";
import { buildAgentSections } from "../../../lib/agentsTree";
import type { ExternalTask } from "../../../lib/externalApi";
import type { SessionSubagent } from "../../../lib/sessionInfoApi";
import type { ActivityCard } from "../../../lib/missionActivityFeed";

const task = { taskId: "t1", projectId: "p1", cwd: "C:\\dev", state: "active" } as unknown as ExternalTask;
const row = (o: Partial<SessionSubagent>): SessionSubagent => ({
  agentId: "a1", agentType: "general-purpose", description: "Agent", toolUseId: null, spawnDepth: 1, parentAgentId: null, model: null,
  prompt: null, answer: null, startedAt: null, endedAt: null, durationMs: null, state: "finished", status: "completed", tokens: null, toolUses: null, ...o,
}) as SessionSubagent;
const line = (o: Record<string, unknown>) => JSON.stringify({ isSidechain: true, timestamp: "2026-11-01T10:00:00.000Z", ...o });

describe("AgentsList", () => {
  // @covers FR-01.66
  it("shows a status dot only for running agents", () => {
    const sections = buildAgentSections([row({ agentId: "fin" }), row({ agentId: "bad", status: "failed" }), row({ agentId: "run", state: "running", status: null })]);
    const { container } = render(<AgentsList sections={sections} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId("agent-row-fin").querySelector(".ag-dot")).toBeNull();
    expect(screen.getByTestId("agent-row-bad").querySelector(".ag-dot")).toBeNull();
    expect(screen.getByTestId("agent-row-run").querySelector(".ag-dot")).not.toBeNull();
    expect(container.querySelectorAll(".ag-dot")).toHaveLength(1);
  });
});

describe("AgentTranscriptFeed", () => {
  // @covers FR-01.66
  it("renders with the chat's feed classes: a prompt card, no human bubble, coordinator message labelled", () => {
    const content = [
      line({ type: "user", message: { role: "user", content: "Review the diff" } }),
      line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "On it." }] } }),
      line({ type: "user", message: { role: "user", content: "The coordinator sent a message while you were working:\nRe-check please.\n\nAddress this before completing your current task." } }),
    ].join("\n");
    const feed = buildAgentFeed(content, { limit: 200, truncated: false });
    const { container } = render(<AgentTranscriptFeed feed={feed} task={task} onOpenAgent={() => {}} canOpenAgent={() => false} />);
    expect(screen.getByTestId("agent-prompt-card")).toHaveTextContent("Prompt from the session");
    expect(screen.getByTestId("agent-prompt-card")).toHaveTextContent("Review the diff");
    expect(container.querySelector('[data-entry-kind="user"]')).toBeNull();
    expect(container.querySelectorAll(".mc-feed-entry").length).toBeGreaterThanOrEqual(3);
    const coordinator = screen.getByTestId("handback-card");
    expect(coordinator).toHaveAttribute("data-origin", "coordinator");
    expect(coordinator).toHaveTextContent("Coordinator message");
    expect(coordinator).toHaveTextContent("Re-check please.");
    expect(container.textContent).not.toMatch(/The coordinator sent a message/);
    expect(container.textContent).not.toMatch(/Unknown event|Thinking/);
  });
});

describe("agent hash chips", () => {
  // @covers FR-01.66
  it("turn a known agent hash into a button that opens that agent", () => {
    const open = vi.fn();
    render(
      <AgentLinkProvider agents={[row({ agentId: "afb588e7c229aa880" })]} open={open}>
        <MarkdownChunk content="Delivered as hand-back afb588e7 and `afb588e7` and deadbeef." />
      </AgentLinkProvider>,
    );
    const chip = screen.getByTestId("agent-hash-chip");
    expect(screen.getAllByTestId("agent-hash-chip")).toHaveLength(1);
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith("afb588e7c229aa880");
  });
  // @covers FR-01.66
  it("keep an explicit link to an unknown agent as plain text with an Agent not found tooltip", () => {
    render(
      <AgentLinkProvider agents={[row({ agentId: "afb588e7c229aa880" })]} open={vi.fn()}>
        <MarkdownChunk content="See [ghost](agent:0123456789abcdef0)." />
      </AgentLinkProvider>,
    );
    expect(screen.queryByTestId("agent-hash-chip")).toBeNull();
    expect(screen.getByTestId("agent-hash-unknown")).toHaveAttribute("title", "Agent not found");
  });
  // @covers FR-01.66
  it("keep a path-embedded agent id whole", () => {
    render(
      <AgentLinkProvider agents={[row({ agentId: "afb588e7c229aa880" })]} open={vi.fn()}>
        <MarkdownChunk content="File subagents/agent-afb588e7c229aa880.jsonl and C:\x\afb588e7c229aa880 stay." />
      </AgentLinkProvider>,
    );
    expect(screen.queryByTestId("agent-hash-chip")).toBeNull();
    expect(screen.getByTestId("markdown-body").textContent).toContain("subagents/agent-afb588e7c229aa880.jsonl");
  });
  // @covers FR-01.66
  it("leave markdown untouched outside a provider", () => {
    render(<MarkdownChunk content="hand-back afb588e7" />);
    expect(screen.queryByTestId("agent-hash-chip")).toBeNull();
  });
});

describe("SubrunnerPanel (V3)", () => {
  const card: ActivityCard = { kind: "subrunner", text: "Audit", commands: [], subrunnerId: "a1", subrunnerStatus: "done" };
  // @covers FR-01.66
  it("shows the resolved answer and both actions, and fires them", () => {
    const open = vi.fn();
    const jump = vi.fn();
    render(<SubrunnerPanel card={card} onClose={() => {}} answer="The real answer" meta="general-purpose · 6m 12s" onOpenAgent={open} onJumpToChat={jump} />);
    expect(screen.getByTestId("subrunner-report")).toHaveTextContent("The real answer");
    fireEvent.click(screen.getByTestId("subrunner-open-agent"));
    fireEvent.click(screen.getByTestId("subrunner-jump-chat"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(jump).toHaveBeenCalledTimes(1);
  });
  // @covers FR-01.66
  it("shows the honest empty state, never the delivered-to-you pointer", () => {
    render(<SubrunnerPanel card={card} onClose={() => {}} answer={null} />);
    expect(screen.getByTestId("subrunner-no-report")).toBeInTheDocument();
    expect(screen.queryByText(/delivered to you/)).toBeNull();
    expect(screen.queryByTestId("subrunner-open-agent")).toBeNull();
  });
});
