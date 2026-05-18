/*
 * actions-substitute.session-name.test.ts
 *  — iterate-2026-05-19-fix-launch-name-quoting (BUG)
 *
 * Bug: the bundled command_templates wrapped a substituter-escaped
 * placeholder in literal double-quotes, e.g.
 *   --name "{task.title}"   →   --name "'My Task'"
 * The substituter ALWAYS shell-escapes `{task.title}` (the security
 * contract). Wrapping the already-quoted token in literal `"..."` double-
 * quotes it — Claude then receives a session name with literal stray
 * single-quote characters (picker shows `'My Task'`). All four bundled
 * templates were affected.
 *
 * Fix: a new `{task.session_name}` placeholder composes the per-action
 * name (`Pipeline: …` / `Iterate: …` / `<phase>: …` / bare title) and
 * shell-escapes it ONCE. Templates use `--name {task.session_name}`
 * (bare — never `--name "{task.session_name}"`).
 *
 * No existing test asserted the `--name` *value*, which is why the bug
 * shipped. This file closes that gap.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  substitutePlaceholders,
  substituteAllForms,
  InvalidTitleError,
  type SubstitutionContext,
} from "./actions-substitute.js";

const DEFAULT_ACTIONS = JSON.parse(
  readFileSync(
    new URL("../config/default-actions.json", import.meta.url),
    "utf-8",
  ),
) as {
  actions: { id: string; command_template?: string }[];
  phases: { id: string }[];
};

function ctxFor(
  actionId: string,
  title: string,
  overrides: Partial<SubstitutionContext["task"]> = {},
): SubstitutionContext {
  return {
    project: { id: "p", path: "/home/sven/app" },
    task: {
      uuid: "00000000-1111-2222-3333-444444444444",
      title,
      phase: "build",
      phase_label: "Build",
      ...overrides,
    },
    pluginDirs: [],
    allowedPhaseIds: new Set(DEFAULT_ACTIONS.phases.map((p) => p.id)),
    actionId,
  };
}

describe("{task.session_name} — composed, singly-escaped Claude session name", () => {
  it("new-pipeline → 'Pipeline: <title>' (one clean quote pair per shell)", () => {
    const ctx = ctxFor("new-pipeline", "My Task");
    expect(substitutePlaceholders("{task.session_name}", ctx, "posix")).toBe(
      "'Pipeline: My Task'",
    );
    expect(
      substitutePlaceholders("{task.session_name}", ctx, "powershell"),
    ).toBe("'Pipeline: My Task'");
    expect(substitutePlaceholders("{task.session_name}", ctx, "cmd")).toBe(
      '"Pipeline: My Task"',
    );
  });

  it("new-iterate → 'Iterate: <title>'", () => {
    const ctx = ctxFor("new-iterate", "My Task");
    expect(substitutePlaceholders("{task.session_name}", ctx, "posix")).toBe(
      "'Iterate: My Task'",
    );
  });

  it("new-task → '<phase_label>: <title>'", () => {
    const ctx = ctxFor("new-task", "My Task", { phase_label: "Build" });
    expect(substitutePlaceholders("{task.session_name}", ctx, "posix")).toBe(
      "'Build: My Task'",
    );
  });

  it("new-task with an empty phase_label → bare '<title>' (no leading ': ')", () => {
    const ctx = ctxFor("new-task", "My Task", { phase_label: "" });
    expect(substitutePlaceholders("{task.session_name}", ctx, "posix")).toBe(
      "'My Task'",
    );
  });

  it("new-plain → bare '<title>'", () => {
    const ctx = ctxFor("new-plain", "My Task");
    expect(substitutePlaceholders("{task.session_name}", ctx, "posix")).toBe(
      "'My Task'",
    );
  });

  it("a custom / unknown actionId → bare '<title>' (no prefix, no throw)", () => {
    const ctx = ctxFor("new-content-orchestrator", "My Task");
    expect(substitutePlaceholders("{task.session_name}", ctx, "posix")).toBe(
      "'My Task'",
    );
  });

  it("a title containing a single quote is shell-escaped (injection-safe)", () => {
    const ctx = ctxFor("new-plain", "Tim's Task");
    expect(substitutePlaceholders("{task.session_name}", ctx, "posix")).toBe(
      "'Tim'\\''s Task'",
    );
    expect(
      substitutePlaceholders("{task.session_name}", ctx, "powershell"),
    ).toBe("'Tim''s Task'");
    expect(substitutePlaceholders("{task.session_name}", ctx, "cmd")).toBe(
      '"Tim\'s Task"',
    );
  });

  it("a title containing a double quote round-trips through cmd escaping", () => {
    // cmd is the shell whose escaping the original bug corrupted — qCmd
    // backslash-escapes embedded double-quotes inside the outer wrap.
    const ctx = ctxFor("new-pipeline", 'My "quoted" Task');
    expect(substitutePlaceholders("{task.session_name}", ctx, "cmd")).toBe(
      '"Pipeline: My \\"quoted\\" Task"',
    );
  });

  it("a newline in the title is rejected — InvalidTitleError (single-line invariant)", () => {
    // The title feeds the --name value; an interior newline would break
    // the single-line copy-paste / WS auto-execute invariant. Both
    // {task.session_name} and {task.title} are guarded by the same
    // substituter pre-flight.
    const ctx = ctxFor("new-plain", "line one\nline two");
    expect(() =>
      substitutePlaceholders("{task.session_name}", ctx, "posix"),
    ).toThrow(InvalidTitleError);
    expect(() =>
      substitutePlaceholders("{task.title}", ctx, "posix"),
    ).toThrow(InvalidTitleError);
    // Carriage return is rejected too.
    const ctxCr = ctxFor("new-plain", "line one\rline two");
    expect(() =>
      substitutePlaceholders("{task.session_name}", ctxCr, "posix"),
    ).toThrow(InvalidTitleError);
  });
});

describe("bundled command_templates — --name is a single clean quote pair", () => {
  // Pre-fix every bundled template emitted --name "'…'" (a literal-quote
  // wrap around an already-escaped placeholder). Each must now emit --name
  // as ONE clean shell-quoted token.
  const NAME_BY_ACTION: Record<string, string> = {
    "new-task": "Build: My Task",
    "new-pipeline": "Pipeline: My Task",
    "new-iterate": "Iterate: My Task",
    "new-plain": "My Task",
  };

  for (const action of DEFAULT_ACTIONS.actions) {
    it(`${action.id}: --name carries no nested quotes`, () => {
      expect(action.command_template).toBeTruthy();
      const expectedName = NAME_BY_ACTION[action.id];
      expect(expectedName).toBeDefined(); // a new bundled action must extend this map
      const out = substituteAllForms(action.command_template!, ctxFor(action.id, "My Task"));

      // POSIX + PowerShell: single-quoted, and no double-quote anywhere
      // in the command (the bundled templates carry no other literal ").
      expect(out.posix).toContain(`--name '${expectedName}'`);
      expect(out.posix).not.toContain('"');
      expect(out.powershell).toContain(`--name '${expectedName}'`);
      expect(out.powershell).not.toContain('"');

      // cmd: double-quoted — but never the nested "'…'" / '…'" signature.
      expect(out.cmd).toContain(`--name "${expectedName}"`);
      expect(out.cmd).not.toContain(`"'`);
      expect(out.cmd).not.toContain(`'"`);
    });
  }
});
