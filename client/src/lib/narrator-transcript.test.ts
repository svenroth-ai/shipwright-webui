import { describe, it, expect } from "vitest";

import {
  STAGE_LABELS,
  summarizeTranscript,
  type LifecycleStage,
} from "./narrator-transcript";

/** Build a JSONL string from raw event objects (one JSON per line). */
function jsonl(...events: Record<string, unknown>[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

const userMsg = (text: string) => ({ type: "user", message: { content: text } });
const assistantText = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});
const toolUse = (name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] },
});
const toolResult = (id: string) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
});
const slashCommand = (name: string) => ({
  type: "user",
  message: {
    content: `<command-message>${name}</command-message><command-name>/${name}</command-name>`,
  },
});

describe("narrator-transcript — STAGE_LABELS (FR-01.67 AC1)", () => {
  it("pins the SIX stage labels verbatim, in order (Analyze…Merge)", () => {
    expect(STAGE_LABELS).toEqual(["Analyze", "Spec", "Build", "Test", "Finalize", "Merge"]);
  });
});

describe("summarizeTranscript — honest empty (AC3)", () => {
  it("empty string → the honest EMPTY summary, no fabricated activity", () => {
    const s = summarizeTranscript("");
    expect(s).toEqual({
      topic: null,
      summary: null,
      activity: [],
      stage: null,
      hasActivity: false,
    });
  });

  it("blank/whitespace-only content → EMPTY", () => {
    expect(summarizeTranscript("\n\n").hasActivity).toBe(false);
    expect(summarizeTranscript("\n\n").summary).toBeNull();
  });

  it("a transcript of ONLY tool-result turns → no fabricated activity, honest empty", () => {
    const s = summarizeTranscript(jsonl(toolResult("t-a"), toolResult("t-b")));
    expect(s.hasActivity).toBe(false);
    expect(s.activity).toEqual([]);
    expect(s.summary).toBeNull();
  });
});

describe("summarizeTranscript — plain-language narration", () => {
  it("turns raw turns into a rolling summary + recent-activity list", () => {
    const s = summarizeTranscript(
      jsonl(
        userMsg("Please add multi-factor auth"),
        assistantText("On it — I'll start with the tests."),
        toolUse("Write", { file_path: "/repo/src/auth/mfa.test.ts" }),
        toolUse("Edit", { file_path: "/repo/src/auth/mfa.ts" }),
      ),
    );
    expect(s.hasActivity).toBe(true);
    expect(s.topic).toBe("Please add multi-factor auth");
    // The most-recent action is "what's happening now".
    expect(s.summary).toBe("Editing mfa.ts");
    const texts = s.activity.map((a) => a.text);
    expect(texts).toContain("You said: Please add multi-factor auth");
    expect(texts).toContain("Editing mfa.ts");
    expect(texts).toContain("Writing mfa.test.ts");
  });

  it("describes the common tool moments in plain language", () => {
    const s = summarizeTranscript(
      jsonl(
        toolUse("Read", { file_path: "/repo/README.md" }),
        toolUse("Grep", { pattern: "foo" }),
        toolUse("Bash", { command: "npm run test" }),
      ),
    );
    const texts = s.activity.map((a) => a.text);
    expect(texts).toContain("Reading README.md");
    expect(texts).toContain("Searching the code");
    expect(texts).toContain("Running tests");
  });

  it("caps the activity list at 6 and keeps the most recent", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      toolUse("Edit", { file_path: `/repo/f${i}.ts` }),
    );
    const s = summarizeTranscript(jsonl(...many));
    expect(s.activity.length).toBe(6);
    expect(s.summary).toBe("Editing f11.ts");
    expect(s.activity[s.activity.length - 1].text).toBe("Editing f11.ts");
  });

  it("is deterministic — identical content yields identical output", () => {
    const content = jsonl(userMsg("hi"), toolUse("Edit", { file_path: "/a/b.ts" }));
    expect(summarizeTranscript(content)).toEqual(summarizeTranscript(content));
  });

  it("basenames a Windows backslash path (io-boundary probe)", () => {
    const s = summarizeTranscript(jsonl(toolUse("Edit", { file_path: "C:\\repo\\src\\app.ts" })));
    expect(s.summary).toBe("Editing app.ts");
  });

  it("survives a BOM + CRLF + a torn final line without fabricating (io-boundary probe)", () => {
    const rows = [
      "﻿" + JSON.stringify({ type: "user", message: { content: "Fix the bug" } }),
      JSON.stringify(toolUse("Edit", { file_path: "/repo/src/app.ts" })),
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Ba', // torn
    ];
    const s = summarizeTranscript(rows.join("\r\n"));
    // The edit turn is narrated; the torn tail is swallowed, never fabricated.
    expect(s.summary).toBe("Editing app.ts");
    expect(s.hasActivity).toBe(true);
  });
});

describe("summarizeTranscript — stage inference (AC2, honest)", () => {
  const stageOf = (...e: Record<string, unknown>[]): LifecycleStage | null =>
    summarizeTranscript(jsonl(...e)).stage;

  it("spec/planning edits → Spec", () => {
    expect(stageOf(toolUse("Write", { file_path: "/repo/.shipwright/planning/spec.md" }))).toBe(
      "Spec",
    );
  });

  it("source edits → Build", () => {
    expect(stageOf(toolUse("Edit", { file_path: "/repo/src/thing.ts" }))).toBe("Build");
  });

  it("running the suite → Test", () => {
    expect(stageOf(toolUse("Bash", { command: "npm run test" }))).toBe("Test");
  });

  it("a commit → Finalize (furthest-along wins over earlier edits)", () => {
    expect(
      stageOf(
        toolUse("Edit", { file_path: "/repo/src/thing.ts" }),
        toolUse("Bash", { command: "npm run test" }),
        toolUse("Bash", { command: 'git commit -m "feat: x"' }),
      ),
    ).toBe("Finalize");
  });

  it("a push / PR link / gh pr merge / gh run → Merge, NOT Finalize (FR-01.67 AC1)", () => {
    // Finalize NARROWED: it no longer swallows push/PR — those are the Merge stage.
    expect(
      stageOf(
        toolUse("Bash", { command: 'git commit -m "feat: x"' }),
        toolUse("Bash", { command: "git push origin HEAD" }),
      ),
    ).toBe("Merge");
    expect(
      stageOf({ type: "pr-link", prNumber: 7, prUrl: "https://x/y", prRepository: "o/r" }),
    ).toBe("Merge");
    expect(stageOf(toolUse("Bash", { command: "gh pr merge 7 --squash" }))).toBe("Merge");
    expect(stageOf(toolUse("Bash", { command: "gh run watch" }))).toBe("Merge");
  });

  it("the leading scout cluster (reads/searches/todo, no edits) → Analyze (FR-01.67 AC1)", () => {
    expect(
      stageOf(toolUse("Read", { file_path: "/a.ts" }), toolUse("Grep", { pattern: "x" })),
    ).toBe("Analyze");
    expect(stageOf(toolUse("TodoWrite", {}))).toBe("Analyze");
    expect(stageOf(toolUse("Glob", { pattern: "**/*.ts" }))).toBe("Analyze");
  });

  it("the `/shipwright-iterate` kickoff (incl. --campaign --autonomous) → Analyze (FR-01.67 AC1)", () => {
    expect(stageOf(slashCommand("shipwright-iterate"))).toBe("Analyze");
    expect(
      stageOf(slashCommand("shipwright-iterate --campaign wow-usability --autonomous")),
    ).toBe("Analyze");
  });

  it("Analyze is the WEAKEST signal — any real edit/test moves past it", () => {
    expect(
      stageOf(
        slashCommand("shipwright-iterate"),
        toolUse("Read", { file_path: "/a.ts" }),
        toolUse("Edit", { file_path: "/repo/src/thing.ts" }),
      ),
    ).toBe("Build");
  });

  it("nothing evidenced at all → null (honest '—')", () => {
    expect(stageOf(assistantText("Hello, thinking about it."))).toBeNull();
  });

  it("a CHANGELOG edit → Finalize, not Spec", () => {
    expect(stageOf(toolUse("Edit", { file_path: "/repo/CHANGELOG.md" }))).toBe("Finalize");
  });

  it("source paths that merely CONTAIN 'spec' are NOT the Spec stage (honesty)", () => {
    // A false-positive the substring match would have made (external review #3).
    expect(stageOf(toolUse("Edit", { file_path: "/repo/src/specification.ts" }))).toBe("Build");
    expect(stageOf(toolUse("Edit", { file_path: "/repo/src/inspect.ts" }))).toBe("Build");
    // A test file (`.spec.ts`) is a Build edit, not the Spec (planning) stage.
    expect(stageOf(toolUse("Write", { file_path: "/repo/src/login.spec.ts" }))).toBe("Build");
    // A real planning/spec artifact IS the Spec stage.
    expect(stageOf(toolUse("Edit", { file_path: "/repo/.shipwright/adr/001-x.md" }))).toBe("Spec");
  });
});

describe("summarizeTranscript — io-boundary sanitization (AC5)", () => {
  it("strips control/bidi characters and caps length from JSONL text", () => {
    const bidi = String.fromCodePoint(0x202e);
    const nasty = `safe${bidi}evil` + "x".repeat(200);
    const s = summarizeTranscript(jsonl(userMsg(nasty)));
    const said = s.activity[0].text;
    expect(said).not.toContain(bidi);
    // "You said: " prefix (10) + capped body (<= 90).
    expect(said.length).toBeLessThanOrEqual(10 + 90);
  });

  it("captures a slash-command as the opening action", () => {
    const s = summarizeTranscript(jsonl(slashCommand("shipwright-iterate")));
    expect(s.activity[0].text).toBe("Started /shipwright-iterate");
  });
});

describe("summarizeTranscript — the full tool + event vocabulary", () => {
  const summaryOf = (...e: Record<string, unknown>[]): string | null =>
    summarizeTranscript(jsonl(...e)).summary;

  it("describes every common tool moment in plain language", () => {
    expect(summaryOf(toolUse("MultiEdit", { file_path: "/a/x.ts" }))).toBe("Editing x.ts");
    expect(summaryOf(toolUse("Edit", {}))).toBe("Editing a file");
    expect(summaryOf(toolUse("Write", {}))).toBe("Writing a file");
    expect(summaryOf(toolUse("Read", {}))).toBe("Reading a file");
    expect(summaryOf(toolUse("TodoWrite", {}))).toBe("Planning the work");
    expect(summaryOf(toolUse("Task", {}))).toBe("Delegating a sub-task");
    expect(summaryOf(toolUse("Weird", {}))).toBe("Using Weird");
  });

  it("detects the common shell moments, else echoes the head", () => {
    expect(summaryOf(toolUse("Bash", { command: "npm run build" }))).toBe("Building the project");
    expect(summaryOf(toolUse("Bash", { command: "git push origin main" }))).toBe(
      "Pushing to the remote",
    );
    expect(summaryOf(toolUse("Bash", { command: "gh pr create" }))).toBe(
      "Working with the pull request",
    );
    expect(summaryOf(toolUse("Bash", { command: "echo hi" }))).toBe("Running: echo hi");
    expect(summaryOf(toolUse("Bash", { command: "" }))).toBe("Running a command");
  });

  it("narrates an assistant text-only turn, a PR link, and a task notification", () => {
    expect(summaryOf(assistantText("Hello world"))).toBe("Claude: Hello world");
    expect(
      summaryOf({ type: "pr-link", prNumber: 42, prUrl: "https://x/y", prRepository: "o/r" }),
    ).toBe("Opened PR #42");
    expect(
      summaryOf({
        type: "user",
        message: {
          content:
            "<task-notification><status>completed</status><summary>s</summary><task-id>t</task-id></task-notification>",
        },
      }),
    ).toBe("Background task completed");
  });
});
