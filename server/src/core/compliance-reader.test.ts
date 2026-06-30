import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseDashboard,
  readCompliance,
  type ReadComplianceDeps,
} from "./compliance-reader.js";

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "test",
  "fixtures",
  "compliance-dashboard-sample.md",
);
const FIXTURE_RAW = readFileSync(FIXTURE_PATH, "utf-8");

const PROJECT_ROOT = "/proj";
const DASHBOARD_REL = ".shipwright/compliance/dashboard.md";

function depsReturning(contents: string | undefined): {
  deps: ReadComplianceDeps;
  lastPath: () => string | null;
} {
  let lastPath: string | null = null;
  return {
    lastPath: () => lastPath,
    deps: {
      readFile: async (p: string) => {
        lastPath = p;
        if (contents === undefined) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return contents;
      },
    },
  };
}

describe("parseDashboard — structured fields (AC-A)", () => {
  it("extracts grade, score, verdict, generatedAt from the real dashboard", () => {
    const r = parseDashboard(FIXTURE_RAW);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.grade).toBe("A");
    expect(r.data.score).toBe(99);
    expect(r.data.verdict).toBe(
      "Under full control. Primarily capped by requirement traceability.",
    );
    expect(r.data.generatedAt).toBe("2026-06-28T21:55:11.404445+00:00");
  });
});

describe("parseDashboard — section slices (AC-E)", () => {
  it("controlVerdictMarkdown spans Control Verdict only, excludes later sections", () => {
    const r = parseDashboard(FIXTURE_RAW);
    if (r.status !== "ok") throw new Error("expected ok");
    const md = r.data.controlVerdictMarkdown;
    expect(md).toContain("Control Verdict");
    expect(md).toContain("Control Grade");
    expect(md).toContain("Requirement traceability");
    // must NOT bleed into the next sections
    expect(md).not.toContain("CI Security");
    expect(md).not.toContain("Quality Indicators");
    expect(md).not.toContain("Compliance Artifacts");
  });

  it("does not treat a '## ' line inside a fenced code block as a boundary", () => {
    const raw = [
      "## ✅ Control Verdict",
      "",
      "### Control Grade: **A** (99/100)",
      "",
      "```",
      "## Not A Real Section",
      "```",
      "",
      "| Dim | Signal |",
      "|---|---|",
      "| Test health | ok |",
      "",
      "## 🛡️ CI Security",
      "",
      "| Critical | 0 |",
    ].join("\n");
    const r = parseDashboard(raw);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // The fenced "## Not A Real Section" must NOT split the slice early.
    expect(r.data.controlVerdictMarkdown).toContain("Not A Real Section");
    expect(r.data.controlVerdictMarkdown).toContain("Test health | ok");
    expect(r.data.ciSecurityMarkdown).toContain("CI Security");
  });

  it("ciSecurityMarkdown spans CI Security only", () => {
    const r = parseDashboard(FIXTURE_RAW);
    if (r.status !== "ok") throw new Error("expected ok");
    const md = r.data.ciSecurityMarkdown;
    expect(md).toContain("CI Security");
    expect(md).toMatch(/Critical/);
    expect(md).not.toContain("Quality Indicators");
    // No bleed UP from the Control-Verdict section above: the dimension-table
    // row label is unique to that section. ("Control Grade" itself legitimately
    // appears in CI Security's own footnote, so it's not a bleed marker.)
    expect(md).not.toContain("Requirement traceability");
  });
});

describe("parseDashboard — invalid input (AC-C)", () => {
  it("returns invalid when the grade line is absent", () => {
    const r = parseDashboard("# Compliance Dashboard\n\nno grade here\n");
    expect(r.status).toBe("invalid");
  });

  it("returns invalid on empty input", () => {
    expect(parseDashboard("").status).toBe("invalid");
  });

  it("returns invalid (no throw) when a grade line exists but no ## sections", () => {
    const r = parseDashboard("### Control Grade: **A** (99/100)\n\nno sections\n");
    expect(r.status).toBe("invalid");
  });
});

describe("parseDashboard — whitespace tolerance at the producer boundary", () => {
  it("parses an indented Generated: line and indented headings", () => {
    const raw = [
      "# Compliance Dashboard",
      "",
      "  Generated: 2026-06-28T21:55:11.404445+00:00",
      "",
      "  ## ✅ Control Verdict",
      "",
      "  > **All good.**",
      "",
      "  ### Control Grade: **B+** (88/100)",
      "",
      "| Dimension | Signal |",
      "|---|---|",
      "| Test health | ok |",
      "",
      "## 🛡️ CI Security",
      "",
      "| Critical | 0 |",
    ].join("\n");
    const r = parseDashboard(raw);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.grade).toBe("B+");
    expect(r.data.score).toBe(88);
    expect(r.data.verdict).toBe("All good.");
    expect(r.data.generatedAt).toBe("2026-06-28T21:55:11.404445+00:00");
    expect(r.data.controlVerdictMarkdown).toContain("Control Grade");
    expect(r.data.ciSecurityMarkdown).toContain("CI Security");
  });
});

describe("readCompliance — file IO (AC-A/B)", () => {
  it("reads <projectPath>/.shipwright/compliance/dashboard.md", async () => {
    const { deps, lastPath } = depsReturning(FIXTURE_RAW);
    const r = await readCompliance(PROJECT_ROOT, deps);
    expect(r.status).toBe("ok");
    expect(lastPath()).toBe(join(PROJECT_ROOT, DASHBOARD_REL));
  });

  it("returns missing when the dashboard file is absent", async () => {
    const { deps } = depsReturning(undefined);
    const r = await readCompliance(PROJECT_ROOT, deps);
    expect(r.status).toBe("missing");
  });

  it("propagates invalid for a present-but-unparseable dashboard", async () => {
    const { deps } = depsReturning("garbage without a grade line");
    const r = await readCompliance(PROJECT_ROOT, deps);
    expect(r.status).toBe("invalid");
  });
});
