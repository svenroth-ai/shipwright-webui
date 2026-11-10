/*
 * iterate-2026-11-10-screenshots-with-description (FR-01.37) — a boolean
 * parameter with `default: true` is accepted (the modal opens it pre-checked);
 * `required: true` stays rejected. Split out of actions-schema-validator.test.ts
 * (bloat-baseline ceiling).
 */
import { describe, it, expect } from "vitest";

import { validateActionsSchema } from "./actions-schema-validator.js";

const withBoolean = (extra: Record<string, unknown>) =>
  validateActionsSchema({
    schemaVersion: 1,
    defaults: { autonomy: "guided" as const },
    phases: [{ id: "build", label: "Build" }],
    preview: { enabled: false as const },
    actions: [
      {
        id: "a",
        label: "A",
        kind: "external_launch",
        command_template: "x {task.parameters?}",
        parameters: [
          { name: "noreview", label: "No review", type: "boolean", cli_flag: "--noreview", ...extra },
        ],
      },
    ],
  } as never);

describe("validateActionsSchema — boolean default:true", () => {
  // @covers FR-01.37
  it("accepts default:true (pre-checked, still opt-in on the server)", () => {
    expect(withBoolean({ default: true })).toEqual([]);
  });

  // @covers FR-01.37
  it("still rejects boolean + required, even with default:true", () => {
    const errs = withBoolean({ default: true, required: true });
    expect(errs.some((e) => e.code === "invalid_param_required")).toBe(true);
  });
});
