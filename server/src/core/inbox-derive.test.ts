import { describe, it, expect } from "vitest";

import {
  deriveInbox,
  deriveSessionInbox,
  detectAwaitingUserQuestion,
  DEFAULT_USER_BLOCKING_TOOLS,
  MAX_QUESTION_TEXT_LEN,
} from "./inbox-derive.js";
import { parseSessionJsonl } from "./session-parser.js";

function build(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function assistantWithToolUse(id: string, name: string): Record<string, unknown> {
  return {
    type: "assistant",
    sessionId: "s",
    message: {
      content: [
        { type: "text", text: "calling tool" },
        { type: "tool_use", id, name, input: { parts: [{ question: "ok?" }] } },
      ],
    },
  };
}

function userWithToolResult(toolUseId: string): Record<string, unknown> {
  return {
    type: "user",
    sessionId: "s",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content: "answer" }] },
  };
}

describe("deriveInbox — allowlist filter", () => {
  // @covers FR-01.13
  it("surfaces AskUserQuestion tool_use without tool_result", () => {
    const content = build([assistantWithToolUse("t1", "AskUserQuestion")]);
    const { events } = parseSessionJsonl(content);
    const r = deriveInbox({ events });
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].toolUseId).toBe("t1");
    expect(r.pending[0].toolName).toBe("AskUserQuestion");
  });

  // @covers FR-01.13
  it("clears pending entry once matching tool_result appears", () => {
    const content = build([
      assistantWithToolUse("t1", "AskUserQuestion"),
      userWithToolResult("t1"),
    ]);
    const { events } = parseSessionJsonl(content);
    const r = deriveInbox({ events });
    expect(r.pending).toHaveLength(0);
    expect(r.resolvedToolUseIds).toContain("t1");
  });

  // @covers FR-01.13
  it("ignores Bash tool_use (not user-blocking by default)", () => {
    const content = build([assistantWithToolUse("t1", "Bash")]);
    const { events } = parseSessionJsonl(content);
    const r = deriveInbox({ events });
    expect(r.pending).toHaveLength(0);
    expect(r.allToolUseIds).toContain("t1");
  });

  // @covers FR-01.13
  it("respects custom allowlist (plugin-registered tool names)", () => {
    const content = build([assistantWithToolUse("t1", "PluginAsk_MyProjectV1")]);
    const { events } = parseSessionJsonl(content);
    const r = deriveInbox({
      events,
      allowlist: new Set([...DEFAULT_USER_BLOCKING_TOOLS, "PluginAsk_MyProjectV1"]),
    });
    expect(r.pending).toHaveLength(1);
  });

  // @covers FR-01.13
  it("respects dismissed set — never surfaces dismissed ids", () => {
    const content = build([assistantWithToolUse("t1", "AskUserQuestion")]);
    const { events } = parseSessionJsonl(content);
    const r = deriveInbox({ events, dismissed: new Set(["t1"]) });
    expect(r.pending).toHaveLength(0);
  });

  // @covers FR-01.13
  it("surfaces multiple pending entries when present", () => {
    const content = build([
      assistantWithToolUse("t1", "AskUserQuestion"),
      assistantWithToolUse("t2", "AskUserQuestion"),
      userWithToolResult("t1"),
    ]);
    const { events } = parseSessionJsonl(content);
    const r = deriveInbox({ events });
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].toolUseId).toBe("t2");
  });
});

// ---------- iterate-2026-05-15 inbox-awaiting-user ----------

function assistantText(text: string, uuid = "a1"): Record<string, unknown> {
  return {
    type: "assistant",
    uuid,
    sessionId: "s",
    message: { content: [{ type: "text", text }] },
  };
}

function userMsg(text: string): Record<string, unknown> {
  return { type: "user", sessionId: "s", message: { content: text } };
}

/** A non-conversational metadata event (agent-name, permission-mode, …). */
function meta(type: string): Record<string, unknown> {
  return { type, sessionId: "s" };
}

describe("detectAwaitingUserQuestion — plain-text end-of-turn questions", () => {
  // @covers FR-01.13
  it("AC-1: detects an assistant turn whose text ends with a question mark", () => {
    const { events } = parseSessionJsonl(
      build([userMsg("go"), assistantText("Shall I proceed to build?", "q1")]),
    );
    const q = detectAwaitingUserQuestion(events);
    expect(q).not.toBeNull();
    expect(q?.questionId).toBe("q1");
    expect(q?.questionText).toContain("Shall I proceed");
  });

  // @covers FR-01.13
  it("AC-2: detects a numbered option list with no trailing '?'", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("status"),
        assistantText(
          "Here is how we can continue:\n1. Resume the run\n2. Abandon it\n3. Start parallel work",
          "q2",
        ),
      ]),
    );
    expect(detectAwaitingUserQuestion(events)).not.toBeNull();
  });

  // @covers FR-01.13
  it("detects a lettered + bold-numbered option list", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("x"),
        assistantText("Pick one:\n**1.** small\n**2.** medium\n**3.** large", "q3"),
      ]),
    );
    expect(detectAwaitingUserQuestion(events)).not.toBeNull();
    const { events: e2 } = parseSessionJsonl(
      build([userMsg("x"), assistantText("Options:\na) keep\nb) drop", "q3b")]),
    );
    expect(detectAwaitingUserQuestion(e2)).not.toBeNull();
  });

  // @covers FR-01.13
  it("AC-3: returns null once a real user reply follows the question", () => {
    const { events } = parseSessionJsonl(
      build([assistantText("Shall I proceed?", "q4"), userMsg("yes, go")]),
    );
    expect(detectAwaitingUserQuestion(events)).toBeNull();
  });

  // @covers FR-01.13
  it("AC-4: returns null when the last assistant event carries a tool_use", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("go"),
        assistantText("Should I continue?", "q5"),
        assistantWithToolUse("t9", "Bash"),
      ]),
    );
    expect(detectAwaitingUserQuestion(events)).toBeNull();
  });

  // @covers FR-01.13
  it("returns null when the last conversational event is a user message", () => {
    const { events } = parseSessionJsonl(build([userMsg("do the thing")]));
    expect(detectAwaitingUserQuestion(events)).toBeNull();
  });

  // @covers FR-01.13
  it("returns null when the last conversational event is a tool_result", () => {
    const { events } = parseSessionJsonl(
      build([assistantWithToolUse("t1", "Bash"), userWithToolResult("t1")]),
    );
    expect(detectAwaitingUserQuestion(events)).toBeNull();
  });

  // @covers FR-01.13
  it("returns null for a plain statement turn (no question shape)", () => {
    const { events } = parseSessionJsonl(
      build([userMsg("go"), assistantText("Done. All tests pass and the branch is merged.", "q6")]),
    );
    expect(detectAwaitingUserQuestion(events)).toBeNull();
  });

  // @covers FR-01.13
  it("returns null when a list is mid-report and substantial prose follows it", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("report"),
        assistantText(
          "I changed:\n1. the parser\n2. the route\nThe report is complete and every single test in the full suite passed cleanly.",
          "q7",
        ),
      ]),
    );
    expect(detectAwaitingUserQuestion(events)).toBeNull();
  });

  // @covers FR-01.13
  it("detects a question/list followed only by a short closing line", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("x"),
        assistantText("How shall we proceed?\n1. Option A\n2. Option B\nLet me know.", "q8"),
      ]),
    );
    expect(detectAwaitingUserQuestion(events)).not.toBeNull();
  });

  // @covers FR-01.13
  it("ignores a '?' that only appears inside a fenced code block", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("x"),
        assistantText(
          "I ran this query for you:\n```sql\nSELECT * FROM users WHERE active = ?;\n```\nThat is the final result.",
          "q9",
        ),
      ]),
    );
    expect(detectAwaitingUserQuestion(events)).toBeNull();
  });

  // @covers FR-01.13
  it("tolerates trailing markdown / quotes after the question mark", () => {
    const { events } = parseSessionJsonl(
      build([userMsg("x"), assistantText("**Shall I proceed?**", "q10")]),
    );
    expect(detectAwaitingUserQuestion(events)).not.toBeNull();
  });

  // @covers FR-01.13
  it("skips interleaved non-conversational events when locating the turn", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("go"),
        assistantText("Want me to continue?", "q11"),
        meta("agent-name"),
        meta("permission-mode"),
      ]),
    );
    const q = detectAwaitingUserQuestion(events);
    expect(q).not.toBeNull();
    expect(q?.questionId).toBe("q11");
  });

  // @covers FR-01.13
  it("uses the LAST assistant event uuid as questionId across a multi-event turn", () => {
    const { events } = parseSessionJsonl(
      build([
        userMsg("go"),
        assistantText("Here are the options.", "turn-first"),
        assistantText("1. Keep it\n2. Drop it", "turn-last"),
      ]),
    );
    const q = detectAwaitingUserQuestion(events);
    expect(q).not.toBeNull();
    expect(q?.questionId).toBe("turn-last");
    expect(q?.questionText).toContain("Here are the options.");
  });

  // @covers FR-01.13
  it("caps questionText at MAX_QUESTION_TEXT_LEN", () => {
    const huge = "x".repeat(MAX_QUESTION_TEXT_LEN + 5000) + "\nProceed?";
    const { events } = parseSessionJsonl(build([userMsg("go"), assistantText(huge, "q12")]));
    const q = detectAwaitingUserQuestion(events);
    expect(q).not.toBeNull();
    expect(q!.questionText.length).toBeLessThanOrEqual(MAX_QUESTION_TEXT_LEN + 1);
  });
});

describe("deriveSessionInbox — AUQ precedence over text questions", () => {
  // @covers FR-01.13
  it("a pending AskUserQuestion suppresses the text-question path", () => {
    const { events } = parseSessionJsonl(
      build([userMsg("go"), assistantWithToolUse("t1", "AskUserQuestion")]),
    );
    const r = deriveSessionInbox({ events });
    expect(r.pending).toHaveLength(1);
    expect(r.textQuestion).toBeNull();
  });

  // @covers FR-01.13
  it("surfaces a text question when no tool_use is pending", () => {
    const { events } = parseSessionJsonl(
      build([userMsg("go"), assistantText("Shall I proceed?", "q1")]),
    );
    const r = deriveSessionInbox({ events });
    expect(r.pending).toHaveLength(0);
    expect(r.textQuestion).not.toBeNull();
    expect(r.textQuestion?.questionId).toBe("q1");
  });
});
