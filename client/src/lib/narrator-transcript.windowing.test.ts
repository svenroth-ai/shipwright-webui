import { describe, it, expect } from "vitest";

import {
  currentIterateEvents,
  inferStage,
  summarizeTranscript,
} from "./narrator-transcript";
import { parseSessionJsonl } from "../external/session-parser";

/** Build a JSONL string from raw event objects (one JSON per line). */
function jsonl(...events: Record<string, unknown>[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

const toolUse = (name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] },
});
const slashCommand = (name: string) => ({
  type: "user",
  message: {
    content: `<command-message>${name}</command-message><command-name>/${name}</command-name>`,
  },
});
const prLink = (n: number) => ({
  type: "pr-link",
  prNumber: n,
  prUrl: `https://x/${n}`,
  prRepository: "o/r",
});

describe("currentIterateEvents + windowed inferStage — campaign case (FR-01.67 AC2)", () => {
  // TWO serial sub-iterates in ONE session log: the first fully merged
  // (edit→test→commit→push→PR→gh pr merge), the second mid-Build (an edit only).
  const twoSubIterates = jsonl(
    // ── sub-iterate #1 (fully merged) ──
    slashCommand("shipwright-iterate"),
    toolUse("Edit", { file_path: "/repo/src/one.ts" }),
    toolUse("Bash", { command: "npm run test" }),
    toolUse("Bash", { command: 'git commit -m "feat: one"' }),
    toolUse("Bash", { command: "git push origin HEAD" }),
    prLink(1),
    toolUse("Bash", { command: "gh pr merge 1 --squash" }),
    // ── sub-iterate #2 (mid-Build) ──
    slashCommand("shipwright-iterate"),
    toolUse("Edit", { file_path: "/repo/src/two.ts" }),
  );

  it("windows to the CURRENT sub-iterate — stage reads Build, NOT the first's Merge", () => {
    const { events } = parseSessionJsonl(twoSubIterates);
    // The un-windowed whole transcript would latch Merge (the load-bearing bug).
    expect(inferStage(events)).toBe("Merge");
    // Windowed to the current sub-iterate, it correctly reads Build.
    expect(inferStage(currentIterateEvents(events))).toBe("Build");
    // End-to-end through the public summarizer.
    expect(summarizeTranscript(twoSubIterates).stage).toBe("Build");
  });

  it("currentIterateEvents slices from the LAST `/shipwright-iterate` kickoff", () => {
    const { events } = parseSessionJsonl(twoSubIterates);
    const slice = currentIterateEvents(events);
    // Only the second sub-iterate: its kickoff slash + the one edit.
    expect(slice.length).toBe(2);
    expect(slice[0].kind).toBe("slash-command");
  });

  it("falls back to 'after the last pr-link' as the boundary when there is no re-kickoff", () => {
    const content = jsonl(
      toolUse("Edit", { file_path: "/repo/src/one.ts" }),
      prLink(1),
      toolUse("Edit", { file_path: "/repo/src/two.ts" }),
    );
    const { events } = parseSessionJsonl(content);
    expect(currentIterateEvents(events).length).toBe(1);
    expect(summarizeTranscript(content).stage).toBe("Build");
  });

  it("a plain single iterate is unchanged — the window is the whole session", () => {
    const content = jsonl(
      slashCommand("shipwright-iterate"),
      toolUse("Edit", { file_path: "/repo/src/a.ts" }),
      toolUse("Bash", { command: "npm run test" }),
    );
    const { events } = parseSessionJsonl(content);
    expect(currentIterateEvents(events).length).toBe(events.length);
    expect(summarizeTranscript(content).stage).toBe("Test");
  });

  it("no boundary markers at all → the whole session is the window", () => {
    const content = jsonl(
      toolUse("Edit", { file_path: "/repo/src/a.ts" }),
      toolUse("Bash", { command: "npm run build" }),
    );
    const { events } = parseSessionJsonl(content);
    expect(currentIterateEvents(events)).toEqual(events);
  });
});
