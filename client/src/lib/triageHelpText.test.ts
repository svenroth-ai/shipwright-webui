// @covers FR-01.30
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWN_CHECK_CODES,
  SEVERITY_HELP,
  checkHelp,
  sourceHelp,
  sourceLabel,
} from "./triageHelpText";
import { parseFindings } from "./triageFindings";
import { SEVERITY_VALUES } from "./triageFilterSort";

/** The project's own tracked triage log — real bundles, not a hand-made list. */
const LOG = resolve(__dirname, "../../../.shipwright/triage.jsonl");

function realCodes(): Set<string> {
  const codes = new Set<string>();
  for (const line of readFileSync(LOG, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec: { event?: string; detail?: string };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.event !== "append" || typeof rec.detail !== "string") continue;
    for (const f of parseFindings(rec.detail)) codes.add(f.code);
  }
  return codes;
}

describe("Triage help texts", () => {
  it("every known check code has all three parts of an explanation", () => {
    for (const code of KNOWN_CHECK_CODES) {
      const h = checkHelp(code);
      expect(h.title.length, code).toBeGreaterThan(0);
      expect(h.what.length, code).toBeGreaterThan(10);
      expect(h.why.length, code).toBeGreaterThan(10);
      expect(h.todo.length, code).toBeGreaterThan(5);
    }
  });

  it("every code that really appears in the project's triage log has a text (placeholder 'E/E?' excepted)", () => {
    const missing = [...realCodes()].filter((c) => !c.endsWith("?") && !KNOWN_CHECK_CODES.includes(c));
    expect(missing).toEqual([]);
  });

  it("unknown codes and sources fall back to a generic text instead of failing", () => {
    expect(checkHelp("Z/Z99", "Something").title).toBe("Something");
    expect(checkHelp("Z/Z99").what.length).toBeGreaterThan(0);
    expect(sourceHelp("brand-new-source").todo.length).toBeGreaterThan(0);
    expect(sourceLabel("brand-new-source")).toBe("brand-new-source");
  });

  it("every severity has a help line", () => {
    for (const s of SEVERITY_VALUES) expect(SEVERITY_HELP[s]).toBeTruthy();
  });
});
