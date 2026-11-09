// @covers FR-01.30
import { describe, expect, it } from "vitest";
import { buildTaskLinks, taskLinkKey } from "./triageTaskLinks";
import type { ExternalTask } from "./externalApi";

function task(over: Partial<ExternalTask>): ExternalTask {
  return {
    taskId: "t",
    projectId: "p1",
    state: "active",
    createdAt: "2026-11-09T08:00:00Z",
    title: "T",
    ...over,
  } as ExternalTask;
}

// @covers FR-01.30
describe("buildTaskLinks", () => {
  it("keys a linked task by project and triage id", () => {
    const m = buildTaskLinks([task({ taskId: "a", fixNowForTriageId: "trg-0a1b2c3d" })]);
    expect(m.get(taskLinkKey("p1", "trg-0a1b2c3d"))?.taskId).toBe("a");
  });

  it("a task whose launch failed releases the item so Fix now can be retried", () => {
    const m = buildTaskLinks([task({ taskId: "f", fixNowForTriageId: "trg-0a1b2c3d", state: "launch_failed" })]);
    expect(m.size).toBe(0);
  });

  it("ignores tasks without a link and done tasks", () => {
    const m = buildTaskLinks([
      task({ taskId: "a" }),
      task({ taskId: "b", fixNowForTriageId: "trg-0a1b2c3d", state: "done" }),
    ]);
    expect(m.size).toBe(0);
  });

  it("the same triage id in two projects stays two links", () => {
    const m = buildTaskLinks([
      task({ taskId: "a", projectId: "p1", fixNowForTriageId: "trg-0a1b2c3d" }),
      task({ taskId: "b", projectId: "p2", fixNowForTriageId: "trg-0a1b2c3d" }),
    ]);
    expect(m.size).toBe(2);
  });

  it("the newest live task wins", () => {
    const m = buildTaskLinks([
      task({ taskId: "old", fixNowForTriageId: "trg-0a1b2c3d", createdAt: "2026-11-09T08:00:00Z" }),
      task({ taskId: "new", fixNowForTriageId: "trg-0a1b2c3d", createdAt: "2026-11-09T09:00:00Z" }),
    ]);
    expect(m.get(taskLinkKey("p1", "trg-0a1b2c3d"))?.taskId).toBe("new");
  });
});
