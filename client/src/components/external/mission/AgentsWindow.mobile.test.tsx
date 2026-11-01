/*
 * V9 - the Agents window on a phone is a two-step sheet (list -> detail with Back), and an agent's
 * status is ALWAYS a text pill (a dot exists only for a running agent, never as the sole signal).
 * Layout itself is CSS (data-view + the 767px query); this pins the state machine and the markup.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentsDock } from "./AgentsDock";
import { useMissionAgents } from "../../../hooks/useMissionAgents";
import type { ExternalTask } from "../../../lib/externalApi";

const JSON_HDR = { "content-type": "application/json" };
const task = { taskId: "t1", projectId: "p1", cwd: "C:\dev\app", state: "active" } as unknown as ExternalTask;
const sub = (o: Record<string, unknown>) => ({
  agentType: "sub-iterate-runner", description: "x", toolUseId: null, spawnDepth: 1, parentAgentId: null, model: null,
  prompt: "Do the thing", answer: "Done.", startedAt: null, endedAt: null, durationMs: 4000, state: "finished",
  status: "completed", tokens: null, toolUses: null, ...o,
});
let subagents: unknown[];

function Harness({ openId }: { openId?: string }) {
  const c = useMissionAgents(task.taskId, task.state);
  return (
    <>
      <button data-testid="open-bar" onClick={() => c.openFor()}>bar</button>
      <button data-testid="open-card" onClick={() => c.openFor(openId)}>card</button>
      <AgentsDock task={task} controller={c} />
    </>
  );
}
const mount = (openId?: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness openId={openId} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  subagents = [
    sub({ agentId: "run1", state: "running", status: null, description: "Running one" }),
    sub({ agentId: "ok1", description: "Finished one" }),
    sub({ agentId: "bad1", status: "failed", description: "Failed one" }),
    sub({ agentId: "kill1", status: "killed", description: "Killed one" }),
  ];
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({
      status: "ok",
      info: { sessionUuid: "u", context: {}, compaction: { count: 0, last: null }, outputs: [], remoteControl: { active: false, onceEnabled: false, pid: null }, subagents, scan: {} },
    }), { status: 200, headers: JSON_HDR }),
  ));
});

// @covers FR-01.66
describe("Agents window - phone sheet + status as text", () => {
  it("every row carries its status as a text pill; only the running row has a dot (hidden from AT)", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("open-bar"));
    await screen.findByTestId("agents-list");
    for (const id of ["run1", "ok1", "bad1", "kill1"]) {
      const row = screen.getByTestId(`agent-row-${id}`);
      expect(row.querySelector(".ag-pill")?.textContent?.trim(), id).toBeTruthy();
    }
    const dots = document.querySelectorAll(".ag-dot");
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("agent-row-run1").querySelector(".ag-dot")).not.toBeNull();
    expect(screen.getByTestId("agent-row-run1").querySelector(".ag-pill")?.textContent).toBe("running");
  });

  it("opened from the bar: the list step; a row tap drills into the detail; Back returns to the list", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("open-bar"));
    const body = (await screen.findByTestId("agents-list")).parentElement!;
    expect(body.getAttribute("data-view")).toBe("list");
    expect(screen.queryByTestId("agents-back")).toBeNull();
    fireEvent.click(screen.getByTestId("agent-row-ok1"));
    expect(body.getAttribute("data-view")).toBe("detail");
    fireEvent.click(screen.getByTestId("agents-back"));
    expect(body.getAttribute("data-view")).toBe("list");
    expect(screen.queryByTestId("agents-back")).toBeNull();
  });

  it("opened on a chosen agent (a chat card): lands on that agent's detail", async () => {
    mount("ok1");
    await screen.findByTestId("agents-bar"); // session-info has loaded, so the card's agent is known
    fireEvent.click(screen.getByTestId("open-card"));
    await waitFor(() => expect(screen.getByTestId("agent-detail").getAttribute("data-agent-id")).toBe("ok1"));
    expect(screen.getByTestId("agents-list").parentElement!.getAttribute("data-view")).toBe("detail");
    expect(screen.getByTestId("agents-back")).toBeTruthy();
  });
});
