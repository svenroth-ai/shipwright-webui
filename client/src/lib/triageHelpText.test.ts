// @covers FR-01.30
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWN_CHECK_CODES,
  checkHelp,
  sourceHelp,
  sourceLabel,
} from "./triageHelpText";
import { parseFindings } from "./triageFindings";

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

// @covers FR-01.30
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

  it("GitHub explains a security scan summary and a failing pull-request check differently", () => {
    const sec = sourceHelp("github", "GitHub security: 12 shipwright-security finding(s) (low)");
    const pr = sourceHelp("github", "[pr-ci] PR #191 has 1 failing check(s) on iterate/x");
    expect(sec.what).not.toBe(pr.what);
    expect(sec.todo).not.toBe(pr.todo);
    expect(sourceHelp("github", "Something else").what.length).toBeGreaterThan(0);
  });

  it("GitHub security summaries name only the kinds of finding they hold", () => {
    const code = sourceHelp("github", "GitHub security: 3 finding(s)", "code-scanning: 3 open; dependabot: 0; secret-scanning: (unavailable)");
    const deps = sourceHelp("github", "GitHub security: 2 finding(s)", "dependabot: 2 open");
    expect(code.what).toMatch(/code scanning/);
    expect(code.what).not.toMatch(/dependency|secret/);
    expect(deps.what).toMatch(/dependency/);
    expect(deps.what).not.toMatch(/code scanning/);
    expect(code.what).not.toBe(deps.what);
  });

  it("no two audit checks share the same why-text unless they are the stale-report family", () => {
    const seen = new Map<string, string>();
    for (const c of KNOWN_CHECK_CODES) {
      const w = checkHelp(c).why;
      const prev = seen.get(w);
      if (prev) expect(c.startsWith("E/") && prev.startsWith("E/"), `${prev} vs ${c}`).toBe(true);
      seen.set(w, c);
    }
  });

  it("odd source names such as __proto__ or constructor show as written with the generic help", () => {
    for (const odd of ["__proto__", "constructor", "toString"]) {
      expect(sourceLabel(odd)).toBe(odd);
      expect(sourceHelp(odd).what).toBe(sourceHelp("brand-new-source").what);
    }
  });

  it("every explanation says what Fix now does", () => {
    for (const code of KNOWN_CHECK_CODES) expect(checkHelp(code).todo, code).toMatch(/Fix now/);
    for (const s of ["compliance", "phaseQuality", "manual", "operator", "drift", "required-checks", "github", "other"])
      expect(sourceHelp(s).todo, s).toMatch(/Fix now/);
  });
});
