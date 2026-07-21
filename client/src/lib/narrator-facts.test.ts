/*
 * narrator-facts.test.ts — what the transcript EVIDENCES (FR-01.68).
 *
 * The facts layer is where every honesty guarantee is bought, so the tests are
 * about what may NOT be claimed as much as what may:
 *   - `is_error` alone never becomes a failure COUNT (AC3 evidence tiers)
 *   - a tool call with no result yet is pending, never success (AC3b)
 *   - the ask is chosen by event PROVENANCE, not a text denylist (AC2)
 *   - the window is anchored, deterministically, by four stated rules (AC9)
 */

import { describe, it, expect } from "vitest";

import { factsFromTranscript, gatherFacts, narrativeWindow } from "./narrator-facts";
import { parseSessionJsonl } from "../external/session-parser";

const jsonl = (...e: Record<string, unknown>[]) => e.map((x) => JSON.stringify(x)).join("\n");
const parse = (...e: Record<string, unknown>[]) => parseSessionJsonl(jsonl(...e)).events;

const tool = (name: string, input: Record<string, unknown>, id = `t-${name}`) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const result = (id: string, content: string, isError = false) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
const kickoff = (args?: string) => ({
  type: "user",
  message: {
    content:
      "<command-message>shipwright-iterate:iterate</command-message>\n" +
      "<command-name>/shipwright-iterate:iterate</command-name>" +
      (args ? `\n<command-args>${args}</command-args>` : ""),
  },
});
const say = (text: string) => ({ type: "user", message: { content: text } });
const bash = (command: string, id = "b1") => tool("Bash", { command }, id);

const facts = (...e: Record<string, unknown>[]) => gatherFacts(parse(...e));

describe("the ask — chosen by provenance (AC2)", () => {
  it("takes the operator's request from the kickoff arguments", () => {
    expect(facts(kickoff("Make the middle card tell a story")).ask).toBe(
      "Make the middle card tell a story",
    );
  });

  it("strips leading CLI flags — how it was asked is not what was asked", () => {
    expect(facts(kickoff("--autonomous Fix the button")).ask).toBe("Fix the button");
    expect(facts(kickoff("--type feature Add a panel")).ask).toBe("Add a panel");
  });

  it("stops flag stripping at `--`, and keeps a request that starts with a dash", () => {
    expect(facts(kickoff("-- --autonomous is literally the topic")).ask).toBe(
      "--autonomous is literally the topic",
    );
  });

  it("falls back to a real user message when there is no kickoff", () => {
    expect(facts(say("The board is showing the wrong count")).ask).toBe(
      "The board is showing the wrong count",
    );
  });

  it("never narrates harness injections as something a person said", () => {
    // The parser reclassifies skill manuals / stop hooks into their own kinds;
    // only what it still calls `user` is eligible, minus the closed artefact list.
    expect(facts(say("[Request interrupted by user]"), say("Real ask here")).ask).toBe(
      "Real ask here",
    );
    expect(facts(say("[Request interrupted by user]")).ask).toBeNull();
  });

  it("is null when nothing was asked", () => {
    expect(facts(tool("Read", { file_path: "/r/a.ts" })).ask).toBeNull();
  });
});

describe("test outcomes — graded by evidence, never overstated (AC3)", () => {
  it("reads a real failure COUNT from recognised output", () => {
    const f = facts(bash("npx vitest run"), result("b1", "Tests  6 failed | 300 passed", true));
    expect(f.tests).toEqual([{ status: "failed", failed: 6 }]);
  });

  it("an is_error with NO parseable count does not invent one", () => {
    const f = facts(bash("npx vitest run"), result("b1", "ELIFECYCLE broke", true));
    expect(f.tests).toEqual([{ status: "failed", failed: null }]);
  });

  it("distinguishes a COUNTED pass from a merely error-free run", () => {
    const counted = facts(bash("npx vitest run"), result("b1", "Tests  300 passed (300)"));
    expect(counted.tests).toEqual([{ status: "passed", counted: true }]);
    const quiet = facts(bash("npx vitest run"), result("b1", "done"));
    expect(quiet.tests).toEqual([{ status: "passed", counted: false }]);
  });

  it("a call whose result has not arrived is PENDING, never success (AC3b)", () => {
    const f = facts(bash("npx vitest run"));
    expect(f.tests).toEqual([{ status: "pending" }]);
    expect(f.pending).toBe(true);
  });

  it("does not treat a quoted tool name as a test run (AC8 reaches here too)", () => {
    const f = facts(bash('grep -n "a\\|playwright" .gitignore', "b1"), result("b1", "x"));
    expect(f.tests).toEqual([]);
  });
});

describe("counts and artefacts", () => {
  it("counts product edits, reads and searches separately from spec writes", () => {
    const f = facts(
      tool("Read", { file_path: "/r/a.ts" }, "r1"),
      tool("Grep", { pattern: "x" }, "g1"),
      tool("Edit", { file_path: "/r/src/thing.ts" }, "e1"),
      tool("Write", { file_path: "/r/.shipwright/planning/iterate/x.md" }, "w1"),
    );
    expect(f.read).toBe(1);
    expect(f.searched).toBe(1);
    expect(f.changed).toBe(1);
    expect(f.specWritten).toBe(true);
  });

  it("picks up the commit, the push and the pull request", () => {
    const f = facts(
      bash('git commit -m "feat: x"', "c1"),
      bash("git push origin HEAD", "p1"),
      { type: "pr-link", prNumber: 307, prUrl: "https://x/y/307", prRepository: "o/r" },
    );
    expect(f.commits).toBe(1);
    expect(f.pushed).toBe(true);
    expect(f.pr).toBe(307);
  });
});

describe("the narrative window (AC9)", () => {
  const work = tool("Edit", { file_path: "/r/src/a.ts" }, "e9");

  it("1. starts at the kickoff", () => {
    const events = parse(say("older chatter"), kickoff("do it"), work);
    expect(narrativeWindow(events)).toHaveLength(2);
  });

  it("2. the LAST anchor wins — a later sub-iterate beats an earlier one", () => {
    const events = parse(kickoff("first"), work, kickoff("second"), work);
    expect(narrativeWindow(events)).toHaveLength(2);
    expect(gatherFacts(narrativeWindow(events)).ask).toBe("second");
  });

  it("2b. a worktree setup is an anchor too", () => {
    const events = parse(say("chatter"), bash("uv run setup_iterate_worktree.py", "s1"), work);
    expect(narrativeWindow(events)).toHaveLength(2);
  });

  it("3. a pull request does NOT close the window — post-PR fixes belong to it", () => {
    const events = parse(
      kickoff("do it"),
      work,
      { type: "pr-link", prNumber: 12, prUrl: "https://x/y/12", prRepository: "o/r" },
      work,
    );
    expect(narrativeWindow(events)).toHaveLength(4);
  });

  it("4. no anchor at all → the whole transcript", () => {
    const events = parse(say("just chatting"), work);
    expect(narrativeWindow(events)).toHaveLength(2);
  });
});

/*
 * The ask is stated BEFORE the worktree exists, so a worktree-anchored window
 * has no ask inside it. Caught only by rendering real transcripts: all three
 * opened with no reason to exist. `factsFromTranscript` reaches back to the
 * KICKOFF window for the ask alone — still windowed, so a campaign narrates the
 * current sub-iterate's request rather than the first one of the day.
 */
describe("factsFromTranscript — the ask survives a worktree-anchored window", () => {
  const setup = bash("uv run setup_iterate_worktree.py --slug x", "s1");
  const work = tool("Edit", { file_path: "/r/src/a.ts" }, "e1");

  it("recovers the ask from before the anchor", () => {
    const events = parse(kickoff("Tell the story in the middle card"), setup, work);
    expect(narrativeWindow(events)[0].kind).toBe("assistant"); // anchored at the setup
    expect(gatherFacts(narrativeWindow(events)).ask).toBeNull(); // ... so it is not in there
    expect(factsFromTranscript(events).ask).toBe("Tell the story in the middle card");
  });

  it("takes the CURRENT sub-iterate's ask, not the first of the day", () => {
    const events = parse(
      kickoff("first thing"),
      setup,
      work,
      kickoff("second thing"),
      setup,
      work,
    );
    expect(factsFromTranscript(events).ask).toBe("second thing");
  });

  it("still counts only the narrative window's work, not the whole transcript", () => {
    const events = parse(kickoff("do it"), work, work, setup, work);
    expect(factsFromTranscript(events).changed).toBe(1);
  });
});
