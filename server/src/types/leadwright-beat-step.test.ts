import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BEAT_STEP_BANDS, isValidBeatStep } from "./leadwright-beat-step.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "..", "vendor", "leadwright", "beat-step.schema.json");

function readSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
}

describe("beat-step.schema.json fidelity (read fresh off disk, not a byte-diff)", () => {
  it("required fields match the hand-typed guard's expectations", () => {
    const schema = readSchema();
    expect(schema.required).toEqual(["at", "band", "summary", "effect"]);
  });

  it("band enum matches BEAT_STEP_BANDS exactly", () => {
    const schema = readSchema();
    const properties = schema.properties as Record<string, { enum?: string[] }>;
    expect(properties.band.enum).toEqual([...BEAT_STEP_BANDS]);
  });

  it("effect is a 3-variant oneOf with the expected required fields per kind", () => {
    const schema = readSchema();
    const properties = schema.properties as Record<string, { oneOf?: Array<{ required: string[] }> }>;
    const variants = properties.effect.oneOf!;
    expect(variants).toHaveLength(3);
    const requiredSets = variants.map((v) => [...v.required].sort());
    expect(requiredSets).toContainEqual(["kind", "taskId"]);
    expect(requiredSets).toContainEqual(["decisionKey", "kind"]);
    expect(requiredSets).toContainEqual(["kind"]);
  });
});

describe("isValidBeatStep — fixture accept/reject", () => {
  const base = { at: "2026-09-08T02:00:00.000Z", band: "bugfix", summary: "fixed a typo" };

  it("accepts a valid card-effect step", () => {
    expect(isValidBeatStep({ ...base, effect: { kind: "card", taskId: "t-1" } })).toBe(true);
  });

  it("accepts a valid decision-effect step", () => {
    expect(
      isValidBeatStep({ ...base, band: "architecture", effect: { kind: "decision", decisionKey: "d-1" } }),
    ).toBe(true);
  });

  it("accepts a valid none-effect step", () => {
    expect(isValidBeatStep({ ...base, band: "maintenance", effect: { kind: "none" } })).toBe(true);
  });

  it("rejects a record with an invalid band", () => {
    expect(isValidBeatStep({ ...base, band: "not-a-band", effect: { kind: "none" } })).toBe(false);
  });

  it("rejects a record missing summary", () => {
    const { summary: _summary, ...withoutSummary } = base;
    expect(isValidBeatStep({ ...withoutSummary, effect: { kind: "none" } })).toBe(false);
  });

  it("tolerates an unknown top-level property (forward-compatible, unlike the strict vendored schema)", () => {
    expect(
      isValidBeatStep({ ...base, effect: { kind: "none" }, futureField: "whatever" } as unknown),
    ).toBe(true);
  });
});
