import { describe, expect, it } from "vitest";

import { agentStatusLabel, agentTone, buildAgentSections, findAgentForCard } from "./agentsTree";
import type { SessionSubagent } from "./sessionInfoApi";

const ag = (o: Partial<SessionSubagent> & { agentId: string }): SessionSubagent => ({
  agentType: "sub-iterate-runner", description: o.agentId, toolUseId: null, spawnDepth: 1, parentAgentId: null,
  model: null, prompt: null, answer: null, startedAt: null, endedAt: null, durationMs: null,
  state: "finished", status: "completed", tokens: null, toolUses: null, ...o,
});

// @covers FR-01.66
describe("buildAgentSections", () => {
  it("splits Active vs Finished (completed/failed/killed/stopped/finished-stale all finished)", () => {
    const s = buildAgentSections([
      ag({ agentId: "r", state: "running", status: null }),
      ag({ agentId: "a", status: "completed" }),
      ag({ agentId: "b", status: "failed" }),
      ag({ agentId: "c", status: "killed" }),
      ag({ agentId: "d", status: "stopped" }),
      ag({ agentId: "e", state: "finished-stale", status: null }),
    ]);
    expect(s.active.map((n) => n.agent.agentId)).toEqual(["r"]);
    expect(s.finished.map((n) => n.agent.agentId)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("nests a depth-2 reviewer under its parent runner (who started whom)", () => {
    const s = buildAgentSections([
      ag({ agentId: "runner", state: "running", status: null }),
      ag({ agentId: "rev", state: "running", status: null, spawnDepth: 2, parentAgentId: "runner" }),
    ]);
    expect(s.active.map((n) => [n.agent.agentId, n.depth])).toEqual([["runner", 0], ["rev", 1]]);
  });

  it("a finished child of a running parent is a root of Finished that names its parent", () => {
    const s = buildAgentSections([
      ag({ agentId: "runner", description: "Runner M4", state: "running", status: null }),
      ag({ agentId: "rev", parentAgentId: "runner", spawnDepth: 2 }),
    ]);
    expect(s.finished[0]).toMatchObject({ depth: 0, parentLabel: "Runner M4" });
  });

  it("survives a parent cycle without looping and still lists both", () => {
    const s = buildAgentSections([ag({ agentId: "x", parentAgentId: "y" }), ag({ agentId: "y", parentAgentId: "x" })]);
    expect(s.finished).toHaveLength(2);
  });
});

describe("agent labels and card lookup", () => {
  // @covers FR-01.66
  it("tones and labels", () => {
    expect(agentTone(ag({ agentId: "a", status: "killed" }))).toBe("bad");
    expect(agentTone(ag({ agentId: "a", state: "running", status: null }))).toBe("run");
    expect(agentStatusLabel(ag({ agentId: "a", status: "stopped" }))).toBe("stopped");
    expect(agentStatusLabel(ag({ agentId: "a", state: "finished-stale", status: null }))).toBe("no result");
  });

  // @covers FR-01.66
  it("finds a card's agent by agent id or by dispatch tool_use id", () => {
    const list = [ag({ agentId: "a1", toolUseId: "toolu_1" })];
    expect(findAgentForCard(list, "a1")?.agentId).toBe("a1");
    expect(findAgentForCard(list, "toolu_1")?.agentId).toBe("a1");
    expect(findAgentForCard(list, "zzz")).toBeNull();
    expect(findAgentForCard(list, undefined)).toBeNull();
  });
});
