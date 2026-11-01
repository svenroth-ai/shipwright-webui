import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentsDock } from "./AgentsDock";
import { useMissionAgents } from "../../../hooks/useMissionAgents";
import type { ExternalTask } from "../../../lib/externalApi";
import type { ActivityCard } from "../../../lib/missionActivityFeed";

const JSON_HDR = { "content-type": "application/json" };
const task = { taskId: "t1", projectId: "p1", cwd: "C:\\dev\\app", state: "active" } as unknown as ExternalTask;

const sub = (o: Record<string, unknown>) => ({
  agentType: "sub-iterate-runner", description: "x", toolUseId: null, spawnDepth: 1, parentAgentId: null, model: null,
  prompt: "Do the thing", answer: "Done.", startedAt: null, endedAt: null, durationMs: 4000, state: "finished",
  status: "completed", tokens: null, toolUses: null, ...o,
});
let subagents: unknown[];
const transcriptLine = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "agent says hi" }] } }) + "\n";

function Harness({ openId, cards }: { openId?: string; cards?: ActivityCard[] }) {
  const c = useMissionAgents(task.taskId, task.state, cards);
  return (
    <>
      <button data-testid="card-open" onClick={() => c.openFor(openId)}>card</button>
      <AgentsDock task={task} controller={c} />
    </>
  );
}
function mount(openId?: string, cards?: ActivityCard[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Harness openId={openId} cards={cards} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/transcript")) {
      return new Response(JSON.stringify({ status: "ok", content: transcriptLine, truncated: false, sizeBytes: 9 }), { status: 200, headers: JSON_HDR });
    }
    return new Response(JSON.stringify({
      status: "ok",
      info: { sessionUuid: "u", context: {}, compaction: { count: 0, last: null }, outputs: [], remoteControl: { active: false, onceEnabled: false, pid: null }, subagents, scan: {} },
    }), { status: 200, headers: JSON_HDR });
  }));
});

// @covers FR-01.66
describe("AgentsDock", () => {
  it("is hidden when no agent is running", async () => {
    subagents = [sub({ agentId: "a1" })];
    mount();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("agents-bar")).toBeNull();
  });

  it("shows '<n> agents running' (active only) and opens the window with both sections and the tree", async () => {
    subagents = [
      sub({ agentId: "r1", description: "Runner", state: "running", status: null }),
      sub({ agentId: "r2", description: "Reviewer", state: "running", status: null, spawnDepth: 2, parentAgentId: "r1" }),
      sub({ agentId: "f1", description: "Old one", status: "killed" }),
    ];
    mount();
    const btn = await screen.findByTestId("agents-bar-button");
    expect(btn).toHaveTextContent("2 agents running");
    fireEvent.click(btn);
    expect(await screen.findByTestId("agents-window")).toBeInTheDocument();
    expect(screen.getByTestId("agents-section-active")).toBeInTheDocument();
    expect(screen.getByTestId("agents-section-finished")).toBeInTheDocument();
    expect(screen.getByTestId("agent-row-r2")).toHaveAttribute("data-depth", "1");
    expect(screen.getByTestId("agent-row-f1")).toHaveTextContent("killed");
  });

  it("shows prompt + answer for the selected agent and a read-only transcript tab (no composer)", async () => {
    subagents = [sub({ agentId: "f1", description: "Finished one", prompt: "PROMPT-TEXT", answer: "ANSWER-TEXT" })];
    mount("f1");
    await screen.findByTestId("card-open");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => fireEvent.click(screen.getByTestId("card-open")));
    expect(await screen.findByTestId("agent-prompt")).toHaveTextContent("PROMPT-TEXT");
    expect(screen.getByTestId("agent-answer")).toHaveTextContent("ANSWER-TEXT");
    fireEvent.mouseDown(screen.getByTestId("agent-tab-transcript"), { button: 0 });
    fireEvent.click(screen.getByTestId("agent-tab-transcript"));
    expect(await screen.findByText("agent says hi")).toBeInTheDocument();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("a killed agent opened from its chat card shows the notification report, not its mid-work prose as the answer", async () => {
    subagents = [sub({ agentId: "k1", description: "Killed one", status: "killed", answer: "Now let me run the tests..." })];
    const cards = [{ kind: "subrunner", text: "x", commands: [], subrunnerId: "k1", subrunnerStatus: "failed", subrunnerEndStatus: "killed", subrunnerReport: "KILLED-REASON: out of budget" }] as ActivityCard[];
    mount("k1", cards);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => { fireEvent.click(screen.getByTestId("card-open")); expect(screen.getByTestId("agent-detail")).toBeInTheDocument(); });
    expect(await screen.findByTestId("agent-report")).toHaveTextContent("KILLED-REASON: out of budget");
    const answer = screen.getByTestId("agent-answer");
    expect(answer).toHaveTextContent("Last message from the agent");
    expect(answer).not.toHaveTextContent("Answer returned to the session");
  });

  it("a completed agent keeps the answer heading and shows no separate report while its card is still running", async () => {
    subagents = [sub({ agentId: "c1", description: "Done one", answer: "ANSWER" })];
    const cards = [{ kind: "subrunner", text: "x", commands: [], subrunnerId: "c1", subrunnerStatus: "running", subrunnerReport: "stale" }] as ActivityCard[];
    mount("c1", cards);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => { fireEvent.click(screen.getByTestId("card-open")); expect(screen.getByTestId("agent-detail")).toBeInTheDocument(); });
    expect(await screen.findByTestId("agent-answer")).toHaveTextContent("Answer returned to the session");
    expect(screen.queryByTestId("agent-report")).toBeNull();
  });

  it("a running agent has no answer yet", async () => {
    subagents = [sub({ agentId: "r1", state: "running", status: null, answer: "partial" })];
    mount();
    fireEvent.click(await screen.findByTestId("agents-bar-button"));
    expect(await screen.findByTestId("agent-answer")).toHaveTextContent("Still running");
  });

  it("openFor returns false for an unknown card id (caller falls back to the legacy panel)", async () => {
    subagents = [];
    const seen: boolean[] = [];
    function Probe() {
      const c = useMissionAgents("t1", "active");
      return <button data-testid="p" onClick={() => seen.push(c.openFor("nope"))}>p</button>;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("p"));
    expect(seen).toEqual([false]);
    // a miss rescans, so a just-dispatched agent can open on the next click
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
