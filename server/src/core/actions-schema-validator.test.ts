/*
 * Tests for the parameters / phase_parameters extension in
 * actions-schema-validator.ts.
 *
 * Plan reference: iterate/launch-cli-parameters § 6 + Test-Liste #8-#13.
 *
 * The original O24 regression suite for the 5 baseline failure modes
 * lives in `external/actions-schema-validation.test.ts`.
 */

import { describe, it, expect } from "vitest";

import { validateActionsSchema } from "./actions-schema-validator.js";
import type { ResolvedActions } from "./project-actions-loader.js";
import {
  loadBundledDefault,
  clearActionsCache,
} from "./project-actions-loader.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

function baseActions(overrides: Partial<ResolvedActions> = {}): ResolvedActions {
  return {
    schemaVersion: 1,
    defaults: { autonomy: "guided" },
    actions: [
      {
        id: "test-action",
        label: "Test",
        kind: "external_launch",
        command_template: "claude foo {task.parameters?}",
      },
    ],
    phases: [
      { id: "build", label: "Build" },
      { id: "test", label: "Test" },
    ],
    preview: { enabled: false },
    ...overrides,
  };
}

describe("validateActionsSchema — parameter schema extension (#8)", () => {
  it("accepts a valid parameters block", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              { name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" },
            ],
          },
        ],
      }),
    );
    expect(errs).toEqual([]);
  });

  it("rejects unknown param type", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "weird",
                label: "Weird",
                type: "number" as unknown as "string",
                cli_flag: "--weird",
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_param_type")).toBe(true);
  });

  it("rejects empty enum array on type=enum", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "scope",
                label: "Scope",
                type: "enum",
                enum: [],
                cli_flag: "--scope",
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_param_enum")).toBe(true);
  });

  it("rejects duplicate param name within one schema block", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              { name: "fix", label: "1", type: "boolean", cli_flag: "--fix" },
              { name: "fix", label: "2", type: "boolean", cli_flag: "--also-fix" },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "duplicate_param_name")).toBe(true);
  });

  it("rejects cli_flag with shell metacharacters (injection guard)", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "evil",
                label: "Evil",
                type: "boolean",
                cli_flag: "; rm -rf /",
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_cli_flag")).toBe(true);
  });

  it("rejects empty string in cli_flag_map (skip-emission must be omission)", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "target",
                label: "Target",
                type: "enum",
                enum: ["dev", "prod"],
                cli_flag_map: { dev: "", prod: "--prod" },
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_cli_flag")).toBe(true);
  });

  it("rejects cli_flag_map keys not present in enum", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "target",
                label: "Target",
                type: "enum",
                enum: ["dev", "prod"],
                cli_flag_map: { staging: "--staging" },
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_cli_flag_map")).toBe(true);
  });
});

describe("validateActionsSchema — phase_parameters keys must exist in phases", () => {
  it("rejects phase_parameters keys absent from phases[].id", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "new-task",
            label: "New Task",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            phase_parameters: {
              build: [{ name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" }],
              nonsense: [
                { name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" },
              ],
            },
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "unknown_phase_parameter_key")).toBe(true);
  });
});

describe("validateActionsSchema — default value constraint (#10)", () => {
  it("rejects default that violates pattern", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "depth",
                label: "Depth",
                type: "string",
                cli_flag: "--depth",
                pattern: "^[0-9]+$",
                default: "abc",
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_default_value")).toBe(true);
  });

  it("rejects default not in enum", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "scope",
                label: "Scope",
                type: "enum",
                enum: ["a", "b"],
                cli_flag: "--scope",
                default: "x",
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_default_value")).toBe(true);
  });

  it("accepts default that matches enum + pattern", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "depth",
                label: "Depth",
                type: "string",
                cli_flag: "--depth",
                pattern: "^[0-9]+$",
                default: "3",
              },
            ],
          },
        ],
      }),
    );
    expect(errs).toEqual([]);
  });
});

describe("validateActionsSchema — pattern defensive compile (#11)", () => {
  it("rejects malformed regex pattern", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "p",
                label: "P",
                type: "string",
                cli_flag: "--p",
                pattern: "[invalid",
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_param_pattern")).toBe(true);
  });

  it("accepts a syntactically valid (but ReDoS-prone) regex without throwing", () => {
    // Loader's job is to compile + reject malformed; ReDoS detection is
    // out of scope. Just make sure compile() doesn't throw the validator.
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "x {task.parameters?}",
            parameters: [
              {
                name: "p",
                label: "P",
                type: "string",
                cli_flag: "--p",
                pattern: "((((((((((a))))))))))*",
              },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "invalid_param_pattern")).toBe(false);
  });
});

describe("validateActionsSchema — Template-Konsistenz checks", () => {
  it("rejects parameters defined but template missing {task.parameters?}", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "claude foo (no placeholder here)",
            parameters: [
              { name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" },
            ],
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "missing_parameters_placeholder")).toBe(true);
  });

  it("rejects phase_parameters defined but template missing {task.parameters?}", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "claude foo (no placeholder here)",
            phase_parameters: {
              build: [{ name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" }],
            },
          },
        ],
      }),
    );
    expect(errs.some((e) => e.code === "missing_parameters_placeholder")).toBe(true);
  });

  it("emits warning when template has {task.parameters?} but no parameters defined (#12 inverse check)", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "a",
            label: "A",
            kind: "external_launch",
            command_template: "claude foo {task.parameters?}",
            // no parameters / phase_parameters
          },
        ],
      }),
    );
    // Inverse check should be a warning code, NOT a fail code; validateActionsSchema currently
    // returns errors only — we model warnings via a distinct severity-bearing code.
    // For this test we just assert the warning code is present alongside no fail-code.
    expect(errs.some((e) => e.code === "orphan_parameters_placeholder")).toBe(true);
  });
});

describe("validateActionsSchema — bundled default-actions.json real-file integrity (#13)", () => {
  it("loads + validates without errors AND has no duplicate phase_parameters keys", () => {
    clearActionsCache();
    const bundled = loadBundledDefault();
    expect(validateActionsSchema(bundled)).toEqual([]);

    // Re-read the JSON file directly and inspect for duplicate keys per-action.
    // This catches the silent JSON-dedupe trap (e.g. `adopt` listed twice).
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const filePath = resolve(__dirname, "..", "config", "default-actions.json");
    const raw = readFileSync(filePath, "utf-8");

    for (const action of bundled.actions) {
      if (!action.phase_parameters) continue;
      // For each phase_parameters key, count regex matches in raw JSON to detect
      // duplicate keys (silent overwrite would still leave 2 occurrences in raw).
      const actionScopeStart = raw.indexOf(`"id": "${action.id}"`);
      if (actionScopeStart === -1) continue;
      // crude scan window: assume one action block fits in 12 KB after the id
      const scopeWindow = raw.slice(actionScopeStart, actionScopeStart + 12000);
      for (const phaseId of Object.keys(action.phase_parameters)) {
        const occurrences = (
          scopeWindow.match(new RegExp(`"${phaseId}"\\s*:`, "g")) ?? []
        ).length;
        // 0 should not happen (we just iterated keys); >1 means a duplicate
        // key was silently dropped by JSON.parse.
        expect(occurrences).toBeLessThanOrEqual(1);
        expect(occurrences).toBeGreaterThan(0);
      }
    }
  });
});

describe("validateActionsSchema — overall return", () => {
  it("returns [] for fully valid extended schema", () => {
    const errs = validateActionsSchema(
      baseActions({
        actions: [
          {
            id: "new-task",
            label: "New Task",
            kind: "external_launch",
            command_template: "claude /shipwright-{task.phase} {task.parameters?}",
            phase_parameters: {
              build: [
                {
                  name: "section",
                  label: "Section",
                  type: "string",
                  cli_flag: "@",
                  value_separator: "none",
                  required: true,
                  pattern: "^[a-zA-Z0-9_./-]+\\.md$",
                },
                {
                  name: "from",
                  label: "From",
                  type: "string",
                  cli_flag: "--from",
                  value_separator: "space",
                  pattern: "^[0-9]+$",
                },
              ],
              test: [
                { name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" },
              ],
            },
          },
        ],
      }),
    );
    expect(errs).toEqual([]);
  });
});
