/** V2 class fence: the hand-back / Run result / subrunner styles are token-only and keep their documented shape. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(dir, "mission-result.css"), "utf8");
const index = readFileSync(path.join(dir, "..", "index.css"), "utf8");

describe("mission-result.css (V2)", () => {
  // @covers FR-01.66
  it("is imported after mission-chat.css (equal-specificity overrides)", () => {
    expect(index.indexOf("mission-result.css")).toBeGreaterThan(index.indexOf("mission-chat.css"));
  });
  // @covers FR-01.66
  it("uses no hardcoded colours", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  // @covers FR-01.66
  it("hand-back has the yellow (warn) left border; pills style ok/err/warn", () => {
    expect(css).toMatch(/\.mc-handback \{[^}]*border-left: 3px solid var\(--warn\)/);
    for (const s of ["ok", "err", "warn"]) expect(css).toContain(`.mc-pill[data-status="${s}"]`);
  });
  // @covers FR-01.66
  it("uses no font-size below 12px and no animation of its own", () => {
    for (const m of css.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    expect(css).not.toMatch(/animation|transition/);
  });
  // @covers FR-01.66
  it("action buttons are at least 36px (44px on phones)", () => {
    expect(css).toMatch(/button.mc-handback-chip {[^}]*min-height: 36px/);
    expect(css).toMatch(/button.mc-handback-chip { min-height: 44px/);
    expect(css).toMatch(/\.mc-result-btn \{[^}]*min-height: 36px/);
    expect(css).toMatch(/min-height: 44px/);
  });
});
