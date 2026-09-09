/*
 * leadwright-preflight.test.ts — proves the two vendored preflight schemas
 * (server/src/vendor/leadwright/preflight-{input,result}.schema.json,
 * re-vendored from leadwright main @ df2c5f6, 2026-09-09) match the
 * hand-typed TS shapes this card's transport/routes build against.
 *
 * Same fidelity-test posture as claim-record-lock.test.ts: the vendored
 * JSON is read fresh from disk (not imported as a TS module) and compared
 * against hardcoded expected values pinned to today's copy. A future
 * leadwright change to either schema fails this test until a human
 * re-vendors deliberately and bumps the pin — never a silent drift. The
 * repo-wide drift check (server/src/vendor/leadwright/schema-drift.test.ts)
 * catches an un-re-vendored change automatically when run against a real
 * leadwright checkout; this test still pins the SPECIFIC fields webui's own
 * hand-typed mirror depends on, so a re-vendor forces a deliberate look here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PREFLIGHT_INPUT_CONTRACT_VERSION,
  PREFLIGHT_RESULT_CONTRACT_VERSION,
  LEAD_ID_RE,
  CHARTER_LEARNINGS_PATH_RE,
  ALLOWED_SKILL_RE,
  LEAD_REQUIRED_FIELDS,
  PREFLIGHT_INPUT_REQUIRED_FIELDS,
  PREFLIGHT_RESULT_REQUIRED_FIELDS,
  PREFLIGHT_FINDING_REQUIRED_FIELDS,
} from "./leadwright-preflight.js";
import { LEAD_ID_RE as HELPERS_LEAD_ID_RE } from "../external/org/_helpers.js";

it("this module's LEAD_ID_RE stays textually identical to external/org/_helpers.ts's — one pattern, not two independently-maintained copies", () => {
  expect(LEAD_ID_RE.source).toBe(HELPERS_LEAD_ID_RE.source);
});

const here = dirname(fileURLToPath(import.meta.url));
const vendorDir = join(here, "..", "vendor", "leadwright");

function readVendored(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(vendorDir, name), "utf-8")) as Record<string, unknown>;
}

describe("vendored preflight-input.schema.json — fidelity", () => {
  const schema = readVendored("preflight-input.schema.json");

  it("pins contractVersion (bump only alongside a deliberate re-copy)", () => {
    expect(schema.contractVersion).toBe(1);
    expect(PREFLIGHT_INPUT_CONTRACT_VERSION).toBe(1);
  });

  it("top-level required fields match the hand-typed PreflightStdinInput", () => {
    expect(schema.required).toEqual(PREFLIGHT_INPUT_REQUIRED_FIELDS);
    expect(PREFLIGHT_INPUT_REQUIRED_FIELDS).toEqual(["orgChart", "charters", "daemonConfig"]);
  });

  it("Lead required fields match LEAD_REQUIRED_FIELDS — the fields the wizard must supply a value for (defaults or answers)", () => {
    const defs = schema.$defs as { Lead: { required: string[] } };
    expect(defs.Lead.required).toEqual(LEAD_REQUIRED_FIELDS);
    expect(LEAD_REQUIRED_FIELDS).toEqual([
      "name",
      "domain",
      "reports_to",
      "manages",
      "charter_path",
      "learnings_path",
      "triggers",
      "max_concurrent_tasks",
      "budget",
      "projects",
      "allowed_skills",
      "escalation_target",
      "model",
    ]);
  });

  it("domain pattern matches LEAD_ID_RE (the same kebab-case regex webui's own _helpers.ts uses)", () => {
    const defs = schema.$defs as { Lead: { properties: { domain: { pattern: string } } } };
    expect(defs.Lead.properties.domain.pattern).toBe(LEAD_ID_RE.source);
  });

  it("charter_path/learnings_path pattern matches CHARTER_LEARNINGS_PATH_RE (no leading '/', no '..' substring)", () => {
    const defs = schema.$defs as {
      Lead: { properties: { charter_path: { pattern: string }; learnings_path: { pattern: string } } };
    };
    expect(defs.Lead.properties.charter_path.pattern).toBe(CHARTER_LEARNINGS_PATH_RE.source);
    expect(defs.Lead.properties.learnings_path.pattern).toBe(CHARTER_LEARNINGS_PATH_RE.source);
  });

  it("allowed_skills item pattern matches ALLOWED_SKILL_RE", () => {
    const defs = schema.$defs as { Lead: { properties: { allowed_skills: { items: { pattern: string } } } } };
    expect(defs.Lead.properties.allowed_skills.items.pattern).toBe(ALLOWED_SKILL_RE.source);
  });

  // iterate-2026-09-09-leadwright-schema-drift: leadwright #79 (event journal
  // for arbitrary trigger events) opened this from a closed two-value enum to
  // an open lowercase-snake-case pattern. webui's own PreflightTriggerEventType
  // union (leadwright-preflight.ts) stays narrower on purpose — it only types
  // what webui itself ever emits, not everything the wire schema now accepts.
  it("triggers.on requires at least one entry matching the open lowercase-snake-case vocabulary", () => {
    const defs = schema.$defs as {
      Lead: { properties: { triggers: { properties: { on: { items: { pattern: string }; minItems: number } } } } };
    };
    expect(defs.Lead.properties.triggers.properties.on.minItems).toBe(1);
    expect(defs.Lead.properties.triggers.properties.on.items.pattern).toBe("^[a-z][a-z0-9_]*$");
  });

  it("the 5 absolute-path-bound daemonConfig fields are exactly leadsRoot/sdkSessionsPath/pluginDirs/leadProjectRoots/leadPluginDirs — NOT orgChartPath", () => {
    const daemonConfig = (schema.properties as { daemonConfig: { properties: Record<string, unknown> } }).daemonConfig;
    const absolutePathBoundFields = ["leadsRoot", "sdkSessionsPath", "pluginDirs", "leadProjectRoots", "leadPluginDirs"];
    for (const field of absolutePathBoundFields) {
      expect(daemonConfig.properties).toHaveProperty(field);
    }
    expect(Object.keys(daemonConfig.properties)).not.toContain("charter_path");
    expect((schema.properties as { daemonConfig: { required: string[] } }).daemonConfig.required).toEqual([
      "orgChartPath",
      "webuiBaseUrl",
    ]);
  });

  it("charters[] items require leadId + content, content has no minLength (an empty charter is a valid submission)", () => {
    const charters = (schema.properties as { charters: { items: { required: string[]; properties: { content: object } } } }).charters;
    expect(charters.items.required).toEqual(["leadId", "content"]);
    expect(charters.items.properties.content).not.toHaveProperty("minLength");
  });
});

describe("vendored preflight-result.schema.json — fidelity", () => {
  const schema = readVendored("preflight-result.schema.json");

  it("pins contractVersion", () => {
    expect(schema.contractVersion).toBe(1);
    expect(PREFLIGHT_RESULT_CONTRACT_VERSION).toBe(1);
  });

  it("top-level required fields are exactly ok + findings", () => {
    expect(schema.required).toEqual(PREFLIGHT_RESULT_REQUIRED_FIELDS);
    expect(PREFLIGHT_RESULT_REQUIRED_FIELDS).toEqual(["ok", "findings"]);
  });

  it("finding item required fields — unverifiable is optional (defaults false)", () => {
    const findings = (schema.properties as { findings: { items: { required: string[] } } }).findings;
    expect(findings.items.required).toEqual(PREFLIGHT_FINDING_REQUIRED_FIELDS);
    expect(PREFLIGHT_FINDING_REQUIRED_FIELDS).toEqual(["key", "layer", "satisfied", "message"]);
  });

  it("layer is the closed MUSS/KANN/advisory vocabulary", () => {
    const findings = (schema.properties as { findings: { items: { properties: { layer: { enum: string[] } } } } })
      .findings;
    expect(findings.items.properties.layer.enum).toEqual(["MUSS", "KANN", "advisory"]);
  });
});
