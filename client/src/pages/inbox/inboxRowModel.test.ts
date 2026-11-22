/*
 * inboxRowModel — one shape for every Inbox kind (iterate-2026-11-22-w2-inbox-triage-look):
 * the row title is the FIRST line with markdown marks removed, chips and filter
 * buckets follow the mockup (awaiting reply = orange, notices separate), and the
 * count / filter helpers keep project groups consistent.
 */
import { describe, expect, it } from "vitest";

import type { InboxItem } from "../../lib/externalApi";
import type { LeadQuestionInboxItem } from "../../lib/leadQuestionApi";
import {
  makeAskItem,
  makeCodexApprovalItem,
  makeCodexErrorItem,
  makeCodexWatcherItem,
  makeTerminalPromptItem,
  makeTextItem,
} from "./__fixtures__/inbox-fixtures";
import { countByFilter, filterGroups, firstLine, inboxRowModel } from "./inboxRowModel";
import type { ProjectGroup } from "./types";

const LEAD: LeadQuestionInboxItem = {
  kind: "lead_question",
  taskId: "t",
  sessionUuid: "s-lead",
  taskTitle: "t",
  questionText: "Ship it?",
};

function group(id: string, items: InboxItem[]): ProjectGroup {
  return {
    projectId: id,
    projectName: id,
    sessions: items.map((i) => ({ sessionUuid: i.sessionUuid, taskId: i.taskId, taskTitle: "x", items: [i] })),
    totalItems: items.length,
  };
}

// @covers FR-01.04
describe("firstLine", () => {
  it("takes the first non-empty line and strips markdown marks", () => {
    expect(firstLine("\n\n**Zu Schnitt 2:** soll ich `jetzt`?\nsecond")).toBe("Zu Schnitt 2: soll ich jetzt?");
    expect(firstLine("## Heading\nbody")).toBe("Heading");
    expect(firstLine("- item one\n- two")).toBe("item one");
    expect(firstLine("see [the docs](http://x.test) now")).toBe("see the docs now");
  });

  it("skips a line that strips to nothing (bare code fence); titles never come out empty", () => {
    expect(firstLine("```\nreal question")).toBe("real question");
    expect(inboxRowModel(makeTextItem({ questionText: "" })).title).toBe("Claude asks");
  });

  it("returns an empty string for empty text (never throws)", () => {
    expect(firstLine("")).toBe("");
    expect(firstLine("  \n \n")).toBe("");
  });

  it("keeps hostile text as text (escaping is React's job, not this function's)", () => {
    expect(firstLine("<script>alert(1)</script> hi")).toBe("<script>alert(1)</script> hi");
  });
});

// @covers FR-01.04
describe("inboxRowModel", () => {
  it("text_question: markdown format, awaiting chip, answered in the terminal", () => {
    const m = inboxRowModel(makeTextItem({ questionText: "**Bold** question?\nmore" }));
    expect(m).toMatchObject({
      filter: "awaiting",
      chip: { label: "awaiting reply", tone: "awaiting" },
      title: "Bold question?",
      format: "markdown",
      answeredInTerminal: true,
    });
  });

  it("terminal_prompt / phase_gate / codex_approval: mono format, awaiting chip", () => {
    expect(inboxRowModel(makeTerminalPromptItem()).format).toBe("mono");
    expect(inboxRowModel(makeCodexApprovalItem()).chip.tone).toBe("awaiting");
  });

  it("ask_tool: the first part is the title and keeps its options; an unreadable payload falls back to a plain notice", () => {
    const m = inboxRowModel(
      makeAskItem({ input: { parts: [{ question: "JWT or Session?", options: ["JWT", "Session"] }] } }),
    );
    expect(m.title).toBe("JWT or Session?");
    expect(m.asks[0]?.options).toEqual(["JWT", "Session"]);
    // every question reaches the dialog, not just the first
    const two = inboxRowModel(
      makeAskItem({ input: { parts: [{ question: "First?" }, { question: "Second?", options: ["x"] }] } }),
    );
    expect(two.asks.map((a) => a.question)).toEqual(["First?", "Second?"]);
    expect(two.title).toBe("First?");
    const bad = inboxRowModel(makeAskItem({ input: { nonsense: true } }));
    expect(bad.asks).toEqual([]);
    expect(bad.title).toMatch(/schema differed/);
    expect(bad.answeredInTerminal).toBe(true);
  });

  it("lead_question: awaiting bucket but NOT answered in the terminal (the form is in the dialog)", () => {
    const m = inboxRowModel(LEAD);
    expect(m.filter).toBe("awaiting");
    expect(m.chip.label).toBe("lead asks");
    expect(m.answeredInTerminal).toBe(false);
  });

  it("codex notices: own bucket; an error is red, a plain notice grey", () => {
    expect(inboxRowModel(makeCodexWatcherItem()).chip).toEqual({ label: "notice", tone: "notice" });
    expect(inboxRowModel(makeCodexWatcherItem({ noticeKind: "delivery_error" })).chip.tone).toBe("error");
    const err = inboxRowModel(makeCodexErrorItem());
    expect(err.filter).toBe("notices");
    expect(err.chip.tone).toBe("error");
    expect(err.answeredInTerminal).toBe(false);
  });

  it("throws on an unknown kind (never a silent wrong row)", () => {
    const bogus = { kind: "bogus_kind", taskId: "x" } as unknown as InboxItem;
    expect(() => inboxRowModel(bogus)).toThrow(/unhandled inbox item kind/);
  });
});

// @covers FR-01.04
describe("countByFilter / filterGroups", () => {
  const groups = [
    group("a", [makeTextItem({ sessionUuid: "s1", questionId: "q1" }), makeCodexErrorItem({ sessionUuid: "s2" })]),
    group("b", [makeCodexWatcherItem({ sessionUuid: "s3" })]),
  ];

  it("counts every item once per bucket", () => {
    expect(countByFilter(groups)).toEqual({ all: 3, awaiting: 1, notices: 2 });
  });

  it("filtering keeps only the bucket, drops empty groups and recounts", () => {
    const awaiting = filterGroups(groups, "awaiting");
    expect(awaiting.map((g) => g.projectId)).toEqual(["a"]);
    expect(awaiting[0]!.totalItems).toBe(1);
    const notices = filterGroups(groups, "notices");
    expect(notices.map((g) => [g.projectId, g.totalItems])).toEqual([["a", 1], ["b", 1]]);
    expect(filterGroups(groups, "all")).toHaveLength(2);
  });
});
