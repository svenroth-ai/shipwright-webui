// @covers FR-01.30
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderHelpDoc } from "./triageHelpDoc";
import { SOURCE_LABELS, sourceHelp } from "./triageHelpText";

const DOC = path.resolve(process.cwd(), "..", ".shipwright", "planning", "01-adopted", "triage-help-texts.md");

// @covers FR-01.30
describe("Triage help-text review document", () => {
  it("the committed document matches the code (regenerate with UPDATE_HELP_DOC=1)", () => {
    const fresh = renderHelpDoc();
    if (process.env.UPDATE_HELP_DOC === "1") writeFileSync(DOC, fresh, "utf-8");
    expect(existsSync(DOC)).toBe(true);
    expect(readFileSync(DOC, "utf-8").replace(/\r\n/g, "\n")).toBe(fresh);
  });

  it("every known source has its own help text, not the generic fallback", () => {
    const generic = sourceHelp("brand-new-source");
    for (const k of Object.keys(SOURCE_LABELS)) {
      expect(sourceHelp(k).what, k).not.toBe(generic.what);
    }
  });

  it("project-specific sources have no catalogue entry and no label of their own", () => {
    const generic = sourceHelp("brand-new-source");
    for (const s of ["req3", "req3-campaign", "tooling"]) {
      expect(Object.keys(SOURCE_LABELS)).not.toContain(s);
      expect(sourceHelp(s).what, s).toBe(generic.what);
    }
  });
});
