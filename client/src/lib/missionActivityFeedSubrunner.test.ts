/*
 * missionActivityFeedSubrunner.test.ts — direct coverage of the subrunner
 * dispatch/resolution mechanism (iterate-2026-09-26-mission-tab-subrunner).
 *
 * This mechanism was empirically WRONG once already: the first design
 * assumed a subagent hands back its result as a plain wrapped user message,
 * which never occurs in a real transcript (see this module's own doc
 * comment). The corrected design — dispatch -> ack (real agent id) ->
 * `task-notification` (done/failed + report) — had shipped with zero direct
 * tests (code-review finding, high) before this file existed.
 */
import { describe, expect, it } from "vitest";
import {
  applySubrunnerAck,
  createSubrunnerDispatchCard,
  extractSubrunnerAgentId,
  isSubrunnerDispatch,
  resolveSubrunnerNotification,
  subrunnerDescription,
} from "./missionActivityFeedSubrunner";
import { parseSessionJsonl, type TaskNotificationEvent } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { ActivityCard } from "./missionActivityFeedTypes";

const notification = (overrides: Partial<TaskNotificationEvent> = {}): TaskNotificationEvent => ({
  kind: "task-notification",
  status: "completed",
  summary: "",
  taskId: "",
  result: "",
  ...overrides,
});

describe("isSubrunnerDispatch", () => {
  it("recognizes the harness's real dispatch tool, Agent", () => {
    expect(isSubrunnerDispatch("Agent")).toBe(true);
  });

  it("also recognizes the classic Task convention", () => {
    expect(isSubrunnerDispatch("Task")).toBe(true);
  });

  it("is false for an unrelated tool", () => {
    expect(isSubrunnerDispatch("Bash")).toBe(false);
  });
});

describe("subrunnerDescription", () => {
  it("uses the dispatch's own description", () => {
    expect(subrunnerDescription({ description: "Investigate the auth bug" })).toBe("Investigate the auth bug");
  });

  it("falls back to a generic sentence for a missing/malformed description", () => {
    expect(subrunnerDescription(undefined)).toBe("Delegated work to a subagent.");
    expect(subrunnerDescription({ description: "   " })).toBe("Delegated work to a subagent.");
    expect(subrunnerDescription({ description: 42 })).toBe("Delegated work to a subagent.");
  });
});

describe("createSubrunnerDispatchCard", () => {
  it("builds a running card provisionally keyed on the dispatch's own tool_use id", () => {
    const card = createSubrunnerDispatchCard("t1", { description: "Run the migration" }, "2026-09-26T00:00:00Z");
    expect(card).toEqual({
      kind: "subrunner",
      text: "Run the migration",
      commands: [],
      subrunnerId: "t1",
      subrunnerStatus: "running",
      timestamp: "2026-09-26T00:00:00Z",
    });
  });
});

describe("extractSubrunnerAgentId", () => {
  it("extracts the stable agent id from a real ack tool_result", () => {
    expect(extractSubrunnerAgentId("Async agent launched successfully. Tracking as agentId: agent-42.")).toBe("agent-42");
  });

  it("returns null for an ack with no agentId (e.g. a plain shell command's result)", () => {
    expect(extractSubrunnerAgentId("total 0\ndrwxr-xr-x 2 user user 4096 Jan 1 00:00 .")).toBeNull();
  });

  // doubt-review finding, low: an unanchored substring search could
  // misfire on unrelated content that merely happens to contain
  // "agentId: <token>" (a Task's own prose, a JSON blob, an error dump).
  it("does not match an incidental 'agentId:' substring outside the harness's own launch preamble", () => {
    expect(extractSubrunnerAgentId('The API returns a JSON field named agentId: string, not a number.')).toBeNull();
  });
});

describe("applySubrunnerAck", () => {
  it("overwrites the card's provisional subrunnerId with the real agent id, leaving status running", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "t1", subrunnerStatus: "running" };
    applySubrunnerAck(card, "Async agent launched successfully. agentId: agent-42", false);
    expect(card.subrunnerId).toBe("agent-42");
    expect(card.subrunnerStatus).toBe("running");
  });

  // doubt-review finding, high: `Task` is recognized as a dispatch tool but
  // never confirmed to behave like `Agent` (async, agentId + later
  // notification) in this harness — a synchronous Task's own ack IS its
  // finished answer and must resolve the card directly, or it would get
  // stuck on "running" forever (no notification is ever generated for a
  // subagent with no async background lifecycle).
  it("treats an ack with no agentId as a SYNCHRONOUS completion: resolves to done and attaches the ack content as the report", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "t1", subrunnerStatus: "running" };
    applySubrunnerAck(card, "The auth bug was a missing null-check in login.ts.", false);
    expect(card.subrunnerId).toBe("t1");
    expect(card.subrunnerStatus).toBe("done");
    expect(card.subrunnerReport).toBe("The auth bug was a missing null-check in login.ts.");
  });

  it("resolves a synchronous completion to failed when the ack tool_result is itself an error", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "t1", subrunnerStatus: "running" };
    applySubrunnerAck(card, "The subagent could not complete the task.", true);
    expect(card.subrunnerStatus).toBe("failed");
  });
});

describe("resolveSubrunnerNotification", () => {
  it("is a no-op when the notification carries no taskId", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "" }));
    expect(card.subrunnerStatus).toBe("running");
  });

  it("is a no-op when no open subrunner card carries this taskId (e.g. a plain background-command notification)", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "some-other-background-task" }));
    expect(card.subrunnerStatus).toBe("running");
  });

  it("resolves a matching card to done and attaches the report", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", status: "completed", result: "PR #482 merged." }));
    expect(card.subrunnerStatus).toBe("done");
    expect(card.subrunnerReport).toBe("PR #482 merged.");
  });

  it("resolves to failed when the notification's own status says so", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", status: "failed", result: "Ran out of turns." }));
    expect(card.subrunnerStatus).toBe("failed");
  });

  it("prefers the rich <result> report over <summary> when both are present", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", summary: "short summary", result: "the full final report" }));
    expect(card.subrunnerReport).toBe("the full final report");
  });

  it("falls back to <summary> when the notification carries no <result> (a malformed/older envelope)", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", summary: "short summary", result: "" }));
    expect(card.subrunnerReport).toBe("short summary");
  });

  it("sets subrunnerReportFull only when the bounded excerpt actually truncated the report", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    const longReport = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} of the final report.`).join("\n");
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", result: longReport }));
    expect(card.subrunnerReportFull).toBeDefined();
    expect(card.subrunnerReportFull).toContain("Line 20");
    expect(card.subrunnerReport).not.toContain("Line 20");
  });

  it("does not set subrunnerReportFull for a short report that fits within the bounded excerpt unchanged", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", result: "Short and complete." }));
    expect(card.subrunnerReportFull).toBeUndefined();
  });

  // The documented `SendMessage`-continuation case: a stopped-at-turn-limit
  // agent notifies once, is resumed, and notifies again with the SAME
  // taskId/agentId but a genuinely different, later outcome.
  it("a second notification for the same taskId overwrites the first (SendMessage-continued agent)", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", status: "failed", result: "Stopped at the turn limit." }));
    expect(card.subrunnerStatus).toBe("failed");
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", status: "completed", result: "Finished after resuming." }));
    expect(card.subrunnerStatus).toBe("done");
    expect(card.subrunnerReport).toBe("Finished after resuming.");
  });

  // external code review, openai, medium: every status except "failed" used
  // to become "done", so a malformed/unrecognized status (the parser's
  // "unknown" fallback for a missing/malformed <status> tag) could falsely
  // mark a still-running agent complete. Only "completed"/"failed" resolve.
  it("is a no-op for an unrecognized status, leaving the card running with no report attached", () => {
    const card: ActivityCard = { kind: "subrunner", text: "x", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([card], notification({ taskId: "agent-42", status: "unknown", result: "should not attach" }));
    expect(card.subrunnerStatus).toBe("running");
    expect(card.subrunnerReport).toBeUndefined();
  });

  // doubt-review finding, low: a same-id collision across two open cards
  // must degrade predictably — the still-open one wins, never whichever
  // happens to be first in array order.
  it("prefers a still-running card over an already-resolved one when two cards share a taskId", () => {
    const resolved: ActivityCard = { kind: "subrunner", text: "first", commands: [], subrunnerId: "agent-42", subrunnerStatus: "done", subrunnerReport: "Already done." };
    const running: ActivityCard = { kind: "subrunner", text: "second", commands: [], subrunnerId: "agent-42", subrunnerStatus: "running" };
    resolveSubrunnerNotification([resolved, running], notification({ taskId: "agent-42", result: "The real completion." }));
    expect(running.subrunnerStatus).toBe("done");
    expect(running.subrunnerReport).toBe("The real completion.");
    expect(resolved.subrunnerReport).toBe("Already done.");
  });
});

// End-to-end through the real reducer, using the harness's REAL dispatch
// tool name ("Agent", not "Task") — the whole reason this feature exists.
// `missionActivityFeedClassify.test.ts`'s reducer-level subrunner case only
// exercises "Task" (code-review finding, high: the corrected mechanism had
// no coverage for "Agent" at all).
describe("deriveActivityFeed — Agent dispatch resolves end-to-end via a real task-notification", () => {
  it("goes from running to a resolved card carrying the delegated agent's report", () => {
    const dispatch = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Run the migration script" } }] } });
    const ack = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Async agent launched successfully. agentId: agent-42" }] } });
    const notificationLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<task-notification>\n<task-id>agent-42</task-id>\n<status>completed</status>\n<summary>Done</summary>\n<result>PR #482 merged.</result>\n</task-notification>" },
      origin: { kind: "task-notification" },
    });
    const { events } = parseSessionJsonl([dispatch, ack, notificationLine].join("\n"));
    const feed = deriveActivityFeed(events, null);
    const card = feed.cards.find((c) => c.kind === "subrunner");
    expect(card).toBeDefined();
    expect(card?.text).toBe("Run the migration script");
    expect(card?.subrunnerId).toBe("agent-42");
    expect(card?.subrunnerStatus).toBe("done");
    expect(card?.subrunnerReport).toBe("PR #482 merged.");
  });
});

// doubt-review finding, high: `Task` is recognized as a dispatch tool for
// the classic CLI convention but never confirmed async like `Agent` in this
// harness — its ack must resolve the card directly, since no
// task-notification is ever generated for it.
describe("deriveActivityFeed — a non-review Task dispatch resolves synchronously off its own ack, with no notification", () => {
  it("goes from running to done the moment the Task's own tool_result returns", () => {
    const dispatch = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Task", input: { subagent_type: "general-purpose", description: "Investigate the auth bug" } }] } });
    const ack = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "The auth bug was a missing null-check in login.ts." }] } });
    const { events } = parseSessionJsonl([dispatch, ack].join("\n"));
    const feed = deriveActivityFeed(events, null);
    const card = feed.cards.find((c) => c.kind === "subrunner");
    expect(card).toBeDefined();
    expect(card?.subrunnerStatus).toBe("done");
    expect(card?.subrunnerReport).toBe("The auth bug was a missing null-check in login.ts.");
  });
});
