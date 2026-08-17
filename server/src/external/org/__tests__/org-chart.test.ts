import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerOrgChartRoute, parseOrgChart } from "../org-chart.js";

const VALID = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme-lead",
      name: "Acme Lead",
      reports_to: null,
      manages: ["sub-lead"],
      charter_path: "acme-lead/charter.md",
    },
    "sub-lead": {
      domain: "sub-lead",
      name: "Sub Lead",
      reports_to: "acme-lead",
      manages: [],
      charter_path: "sub-lead/charter.md",
    },
  },
};

describe("parseOrgChart", () => {
  it("accepts a well-formed org chart", () => {
    expect(parseOrgChart(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("rejects invalid JSON", () => {
    expect(parseOrgChart("{not json")).toBeNull();
  });

  it("rejects a top-level array", () => {
    expect(parseOrgChart("[]")).toBeNull();
  });

  it("rejects a missing po field", () => {
    const { po: _po, ...rest } = VALID;
    expect(parseOrgChart(JSON.stringify(rest))).toBeNull();
  });

  it("rejects a lead missing manages", () => {
    const broken = {
      ...VALID,
      leads: { "acme-lead": { ...VALID.leads["acme-lead"], manages: undefined } },
    };
    expect(parseOrgChart(JSON.stringify(broken))).toBeNull();
  });

  it("rejects a lead with a non-string reports_to", () => {
    const broken = {
      ...VALID,
      leads: { "acme-lead": { ...VALID.leads["acme-lead"], reports_to: 42 } },
    };
    expect(parseOrgChart(JSON.stringify(broken))).toBeNull();
  });

  it(
    "external-review fix (MEDIUM, bug): rejects an array-valued leads field — " +
      "typeof [] === \"object\" previously let it through, then Object.entries() " +
      "silently produced an index-keyed Record instead of the declared id-keyed shape",
    () => {
      expect(parseOrgChart(JSON.stringify({ version: 1, po: "sven", leads: [] }))).toBeNull();
      expect(
        parseOrgChart(
          JSON.stringify({ version: 1, po: "sven", leads: [VALID.leads["acme-lead"]] }),
        ),
      ).toBeNull();
    },
  );
});

describe("GET /api/external/org/org-chart", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-chart-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function app(): Hono {
    const a = new Hono();
    registerOrgChartRoute(a, { leadsRoot });
    return a;
  }

  it("returns the typed structure for a well-formed org-chart.json", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(VALID), "utf8");
    const res = await app().request("/api/external/org/org-chart");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
  });

  it("404s org_chart_missing when the file does not exist yet", async () => {
    const res = await app().request("/api/external/org/org-chart");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_chart_missing");
  });

  it("502s org_chart_invalid on malformed JSON — never a half structure", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), "{not json", "utf8");
    const res = await app().request("/api/external/org/org-chart");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("org_chart_invalid");
  });

  it("502s org_chart_invalid on a structurally-wrong (but valid JSON) file", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify({ foo: "bar" }), "utf8");
    const res = await app().request("/api/external/org/org-chart");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("org_chart_invalid");
  });

  it(
    "external-review fix (HIGH, security): rejects a symlinked org-chart.json " +
      "(mocked lstat) 403, never reading through it — this named endpoint " +
      "previously had NO symlink check at all, unlike every other route in " +
      "this family",
    async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(VALID), "utf8");
      const a = new Hono();
      registerOrgChartRoute(a, {
        leadsRoot,
        lstatSync: (p) =>
          path.basename(p) === "org-chart.json"
            ? { isSymbolicLink: () => true }
            : lstatSync(p),
      });

      const res = await a.request("/api/external/org/org-chart");
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("symlink_forbidden");
    },
  );
});
