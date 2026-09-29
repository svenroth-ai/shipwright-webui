import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseReadinessReport,
  READINESS_REASONS,
  readinessMajor,
  SUPPORTED_READINESS_MAJOR,
} from "./campaign-readiness-schema.js";

const FIXTURE = path.resolve(__dirname, "../types/loop-readiness-1.0.contract.json");
const contract = JSON.parse(readFileSync(FIXTURE, "utf-8")) as {
  version: string;
  contract: { enums: Record<string, string[]>; skeleton: Record<string, unknown> };
};

const good = {
  schema_version: "1.0",
  loop_id: "L1",
  branch_strategy: "independent",
  base_branch: "main",
  supported: true,
  finalized: false,
  ready_ids: ["B"],
  units: [
    { id: "A", state: "merged", ready: false, blocked_by: [] },
    { id: "B", state: "pending", ready: true, blocked_by: [] },
    { id: "C", state: "pending", ready: false, blocked_by: [{ id: "B", reason: "not_merged", detail: "B has status 'pending'" }] },
  ],
};

describe("loop-readiness contract mirror (CLAUDE.md DO-NOT #7)", () => {
  it("the vendored contract fixture is version 1.x and the mirror supports that major", () => {
    expect(readinessMajor(contract.version)).toBe(SUPPORTED_READINESS_MAJOR);
  });

  it("READINESS_REASONS equals the contract's closed reason vocabulary, both directions", () => {
    expect([...READINESS_REASONS].sort()).toEqual([...contract.contract.enums["blocked_by.reason"]].sort());
  });

  it("the skeleton's top-level keys are exactly the keys the mirror requires", () => {
    expect(Object.keys(contract.contract.skeleton).sort()).toEqual(Object.keys(good).sort());
  });

  // Skips (never fails) when the sibling monorepo clone is absent — CI has none.
  // Walk up so it resolves from a main checkout AND from `.worktrees/<slug>/`.
  const findSibling = (): string | null => {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      const c = path.join(dir, "shipwright", "shared", "tests", "contracts", "loop-readiness-1.0.json");
      if (existsSync(c)) return c;
      dir = path.dirname(dir);
    }
    return null;
  };
  const sibling = findSibling() ?? "";
  it.skipIf(!sibling)("the vendored fixture is byte-equal to the sibling monorepo's pinned contract", () => {
    expect(JSON.parse(readFileSync(sibling, "utf-8"))).toEqual(contract);
  });
});

describe("parseReadinessReport", () => {
  it("accepts a contract-shaped report", () => {
    expect(parseReadinessReport(good)?.ready_ids).toEqual(["B"]);
  });

  it("accepts a null loop_id / base_branch / blocker id (campaign-level gate)", () => {
    const gated = {
      ...good,
      loop_id: null,
      base_branch: null,
      supported: false,
      units: [{ id: "B", state: "pending", ready: false, blocked_by: [{ id: null, reason: "unsupported_strategy", detail: "x" }] }],
      ready_ids: [],
    };
    expect(parseReadinessReport(gated)).not.toBeNull();
  });

  it("tolerates an unknown reason string (additive minor still renders)", () => {
    const r = structuredClone(good);
    r.units[2].blocked_by[0].reason = "some_future_reason";
    expect(parseReadinessReport(r)).not.toBeNull();
  });

  it.each([
    ["non-object", 5],
    ["array", []],
    ["missing schema_version", { ...good, schema_version: undefined }],
    ["ready_ids not strings", { ...good, ready_ids: [1] }],
    ["units not array", { ...good, units: {} }],
    ["unit ready not boolean", { ...good, units: [{ id: "A", state: "x", ready: "yes", blocked_by: [] }] }],
    ["blocker detail missing", { ...good, units: [{ id: "A", state: "x", ready: false, blocked_by: [{ id: "B", reason: "not_merged" }] }] }],
    ["finalized not boolean", { ...good, finalized: 0 }],
  ])("rejects %s", (_n, raw) => {
    expect(parseReadinessReport(raw)).toBeNull();
  });

  it("readinessMajor parses majors and rejects junk", () => {
    expect(readinessMajor("1.4")).toBe(1);
    expect(readinessMajor("2.0")).toBe(2);
    expect(readinessMajor("x")).toBeNull();
    expect(readinessMajor(1.0)).toBeNull();
  });
});
