/*
 * Pure-helper tests for palette.tsx (resolveMode, modeHeading, modeSubheading).
 * Step 3.5 review OpenAI #5: unknown action.id MUST fall through to "generic".
 */

import { describe, it, expect } from "vitest";

import {
  PALETTE,
  modeHeading,
  modeSubheading,
  modeWidthClass,
  resolveMode,
} from "./palette";
import type { ActionDefinition } from "../../../lib/externalApi";

function action(id: string, label = "L"): ActionDefinition {
  return {
    id,
    label,
    kind: "external_launch",
    command_template: "x",
  };
}

describe("resolveMode", () => {
  it("null action → 'new-task' (defensive fallback)", () => {
    expect(resolveMode(null)).toBe("new-task");
  });
  it("'new-task' id → 'new-task'", () => {
    expect(resolveMode(action("new-task"))).toBe("new-task");
  });
  it("'new-pipeline' id → 'new-pipeline'", () => {
    expect(resolveMode(action("new-pipeline"))).toBe("new-pipeline");
  });
  it("'new-iterate' id → 'new-iterate'", () => {
    expect(resolveMode(action("new-iterate"))).toBe("new-iterate");
  });
  it("'new-plain' id → 'new-plain'", () => {
    expect(resolveMode(action("new-plain"))).toBe("new-plain");
  });
  it("unknown id → 'generic' (fall-through)", () => {
    expect(resolveMode(action("new-content-orchestrator"))).toBe("generic");
    expect(resolveMode(action("custom-anything"))).toBe("generic");
    expect(resolveMode(action(""))).toBe("generic");
  });
});

describe("modeHeading", () => {
  it("bundled modes return the canonical heading", () => {
    expect(modeHeading("new-task", null)).toBe("New Task");
    expect(modeHeading("new-pipeline", null)).toBe("New Pipeline");
    expect(modeHeading("new-iterate", null)).toBe("New Iterate");
    expect(modeHeading("new-plain", null)).toBe("Plain Claude");
  });
  it("generic mode prefixes 'New ' to the action label", () => {
    expect(modeHeading("generic", action("x", "Content Orchestrator"))).toBe(
      "New Content Orchestrator",
    );
  });
  it("generic + null action → 'New Action' fallback", () => {
    expect(modeHeading("generic", null)).toBe("New Action");
  });
});

describe("modeSubheading", () => {
  it("generic uses action.description if present", () => {
    const a: ActionDefinition = {
      id: "custom",
      label: "Custom",
      kind: "external_launch",
      command_template: "x",
      description: "Run the custom thing.",
    };
    expect(modeSubheading("generic", a)).toBe("Run the custom thing.");
  });
  it("generic without description falls back to a neutral hint", () => {
    expect(modeSubheading("generic", action("custom"))).toMatch(
      /Custom action/,
    );
  });
});

describe("modeWidthClass", () => {
  it("Pipeline = 580px, everything else = 540px", () => {
    expect(modeWidthClass("new-pipeline")).toBe("w-[580px]");
    expect(modeWidthClass("new-task")).toBe("w-[540px]");
    expect(modeWidthClass("new-iterate")).toBe("w-[540px]");
    expect(modeWidthClass("new-plain")).toBe("w-[540px]");
    expect(modeWidthClass("generic")).toBe("w-[540px]");
  });
});

describe("PALETTE table", () => {
  it("every Mode has a palette entry with bg/text/textStrong/stripe", () => {
    for (const m of [
      "new-task",
      "new-pipeline",
      "new-iterate",
      "new-plain",
      "generic",
    ] as const) {
      const p = PALETTE[m];
      expect(p.bg).toBeTruthy();
      expect(p.text).toBeTruthy();
      expect(p.textStrong).toBeTruthy();
      expect(p.stripe).toBeTruthy();
    }
  });
});
