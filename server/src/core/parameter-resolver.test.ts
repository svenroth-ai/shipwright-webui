/*
 * Tests for parameter-resolver opt-in semantics
 * (iterate/fix-adopt-prompt-shape § 4 — Bug 3).
 *
 * The resolver must NOT auto-inject schema defaults when the user omits
 * a key. Defaults are UI hints only; only user-explicit values land in
 * the emitted command.
 */

import { describe, it, expect } from "vitest";

import { resolveParameters } from "./parameter-resolver.js";
import type { ActionDefinition } from "./project-actions-loader.js";

function actionWithBuildAndAdoptParams(): ActionDefinition {
  return {
    id: "new-task",
    label: "New Task",
    kind: "external_launch",
    command_template: "x {task.parameters?}",
    phase_parameters: {
      adopt: [
        {
          name: "crawl-max-depth",
          label: "Depth",
          type: "string",
          cli_flag: "--crawl-max-depth",
          value_separator: "space",
          default: "3",
        },
        {
          name: "planning-split",
          label: "Planning split",
          type: "string",
          cli_flag: "--planning-split",
          value_separator: "space",
          default: "01-adopted",
        },
        {
          name: "skip-crawl",
          label: "Skip crawl",
          type: "boolean",
          cli_flag: "--skip-crawl",
        },
      ],
      build: [
        {
          name: "section",
          label: "Section",
          type: "string",
          cli_flag: "@",
          value_separator: "none",
          required: true,
          pattern: "^[A-Za-z0-9_./-]+\\.md$",
        },
      ],
    },
  };
}

describe("parameter-resolver — opt-in semantics (no default-injection)", () => {
  it("omits a string flag entirely when user did not send a value (even with default)", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "adopt",
      userParams: {}, // user opened modal but didn't touch any field
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // crawl-max-depth has default "3", planning-split has default "01-adopted"
    // — neither should appear because user didn't send them.
    expect(result.resolved).toEqual([]);
  });

  it("emits a flag when user sends an explicit value matching the default", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "adopt",
      userParams: { "crawl-max-depth": "3" }, // user explicitly typed "3"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved).toEqual([
      {
        cli_flag: "--crawl-max-depth",
        value: "3",
        separator: "space",
        sensitive: undefined,
      },
    ]);
  });

  it("emits a flag when user sends a different value than the default", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "adopt",
      userParams: { "planning-split": "01-command-center" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toMatchObject({
      cli_flag: "--planning-split",
      value: "01-command-center",
    });
  });

  it("required field with no user value AND no default → 400", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "build",
      userParams: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("required_parameter_missing");
    expect(result.name).toBe("section");
  });

  it("required field with empty-string user value → 400 (no default fallback)", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "build",
      userParams: { section: "   " }, // whitespace-only
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("required_parameter_missing");
  });

  it("boolean param: false + default true → still skip emission (boolean is opt-in)", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "adopt",
      userParams: { "skip-crawl": false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved).toEqual([]);
  });

  it("boolean param: true → emit flag", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "adopt",
      userParams: { "skip-crawl": true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved).toEqual([
      { cli_flag: "--skip-crawl", separator: "none" },
    ]);
  });

  it("user-typed-then-cleared (empty string) is skipped — no default fallback", () => {
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "adopt",
      userParams: { "crawl-max-depth": "" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved).toEqual([]);
  });
});

describe("parameter-resolver — required+default fallback (Gemini-review fix)", () => {
  function actionWithRequiredDefault(): ActionDefinition {
    return {
      id: "new-task",
      label: "New Task",
      kind: "external_launch",
      command_template: "x {task.parameters?}",
      phase_parameters: {
        adopt: [
          {
            name: "planning-split",
            label: "Planning split",
            type: "string",
            cli_flag: "--planning-split",
            value_separator: "space",
            required: true, // required + default → server falls back
            default: "01-adopted",
            pattern: "^[A-Za-z0-9_-]+$",
          },
        ],
      },
    };
  }

  it("required field with default + user omits → server applies default (no 400)", () => {
    const result = resolveParameters({
      action: actionWithRequiredDefault(),
      phase: "adopt",
      userParams: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toMatchObject({
      cli_flag: "--planning-split",
      value: "01-adopted",
    });
  });

  it("required field with default + user types value → user value wins", () => {
    const result = resolveParameters({
      action: actionWithRequiredDefault(),
      phase: "adopt",
      userParams: { "planning-split": "01-command-center" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved[0].value).toBe("01-command-center");
  });

  it("optional field with default + user omits → no emission (opt-in stays)", () => {
    // Same actionWithBuildAndAdoptParams.adopt[0] is crawl-max-depth which is
    // NOT required + has default. Verify opt-in semantics still hold.
    const result = resolveParameters({
      action: actionWithBuildAndAdoptParams(),
      phase: "adopt",
      userParams: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.resolved).toEqual([]);
  });
});
