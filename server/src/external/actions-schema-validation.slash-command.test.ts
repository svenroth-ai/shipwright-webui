/*
 * iterate-2026-06-11-custom-action-slash-command — fail-loud-at-load guards
 * for the `slash_command` field. A NON-builtin action that uses
 * {task.initial_prompt} MUST declare a valid slash_command; otherwise the GET
 * /actions / upload routes 400 with a typed error instead of letting the
 * launch silently drop the description (or 500 on the dry-run).
 *
 * Split out of actions-schema-validation.test.ts to keep both files under the
 * 300-LOC guideline.
 */

import { describe, it, expect } from "vitest";

import { validateActionsSchema } from "../core/actions-schema-validator.js";

const baseActions = (action: Record<string, unknown>) => ({
  schemaVersion: 1,
  defaults: { autonomy: "guided" as const },
  actions: [action],
  phases: [{ id: "content", label: "Content" }],
  preview: { enabled: false as const },
});

describe("validateActionsSchema — slash_command for custom {task.initial_prompt}", () => {
  it("missing slash_command on a custom initial_prompt action → missing_slash_command", () => {
    const errs = validateActionsSchema(
      baseActions({
        id: "orchestrate",
        label: "Orchestrate",
        kind: "external_launch",
        command_template:
          "claude --session-id {task.uuid} {plugin.dirs} {task.initial_prompt}",
      }) as never,
    );
    const err = errs.find((e) => e.code === "missing_slash_command");
    expect(err).toBeDefined();
    expect(err?.actionId).toBe("orchestrate");
  });

  it("malformed slash_command → invalid_slash_command", () => {
    const errs = validateActionsSchema(
      baseActions({
        id: "orchestrate",
        label: "Orchestrate",
        kind: "external_launch",
        slash_command: "content-orchestrator; rm -rf /",
        command_template:
          "claude --session-id {task.uuid} {plugin.dirs} {task.initial_prompt}",
      }) as never,
    );
    const err = errs.find((e) => e.code === "invalid_slash_command");
    expect(err).toBeDefined();
    expect(err?.actionId).toBe("orchestrate");
  });

  it("valid custom action with slash_command + initial_prompt passes clean", () => {
    const errs = validateActionsSchema(
      baseActions({
        id: "orchestrate",
        label: "Orchestrate",
        kind: "external_launch",
        slash_command: "/content-orchestrator",
        command_template:
          "claude --session-id {task.uuid} {plugin.dirs} {task.initial_prompt}",
        modal_fields: ["title", "description"],
      }) as never,
    );
    expect(
      errs.filter(
        (e) =>
          e.code === "missing_slash_command" ||
          e.code === "invalid_slash_command",
      ),
    ).toEqual([]);
  });

  it("BUILTIN initial_prompt action without slash_command is exempt (no missing_slash_command)", () => {
    const errs = validateActionsSchema(
      baseActions({
        id: "new-iterate",
        label: "New iterate",
        kind: "external_launch",
        command_template:
          "claude --session-id {task.uuid} {plugin.dirs} {task.initial_prompt}",
      }) as never,
    );
    expect(errs.find((e) => e.code === "missing_slash_command")).toBeUndefined();
  });

  it("custom action NOT using {task.initial_prompt} does not require slash_command", () => {
    const errs = validateActionsSchema(
      baseActions({
        id: "publish",
        label: "Publish",
        kind: "external_launch",
        command_template:
          "claude --session-id {task.uuid} {plugin.dirs} /content-publisher{task.description?}",
      }) as never,
    );
    expect(errs.find((e) => e.code === "missing_slash_command")).toBeUndefined();
  });

  it("detects the WHITESPACE-padded placeholder `{ task.initial_prompt }` (substituter trims keys)", () => {
    // The substituter trims placeholder keys, so `{ task.initial_prompt }`
    // DOES expand at launch. A literal includes() match would miss it and the
    // missing-slash case would re-surface as a 500. Lock the parity.
    const errs = validateActionsSchema(
      baseActions({
        id: "orchestrate",
        label: "Orchestrate",
        kind: "external_launch",
        command_template:
          "claude --session-id {task.uuid} {plugin.dirs} { task.initial_prompt }",
      }) as never,
    );
    expect(errs.find((e) => e.code === "missing_slash_command")).toBeDefined();
  });

  it("accepts a stray-padded-but-valid slash_command (trim parity with substituter)", () => {
    const errs = validateActionsSchema(
      baseActions({
        id: "orchestrate",
        label: "Orchestrate",
        kind: "external_launch",
        slash_command: "  /content-orchestrator  ",
        command_template:
          "claude --session-id {task.uuid} {plugin.dirs} {task.initial_prompt}",
      }) as never,
    );
    expect(
      errs.filter(
        (e) =>
          e.code === "missing_slash_command" ||
          e.code === "invalid_slash_command",
      ),
    ).toEqual([]);
  });
});
