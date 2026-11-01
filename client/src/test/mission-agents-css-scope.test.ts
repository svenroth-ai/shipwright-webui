import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "styles", "mission-agents.css"), "utf8");

describe("mission-agents.css scope", () => {
  // @covers FR-01.66
  it("the shared token rule carries tokens only; the modal layout is .ag-window's alone (V3 doubt O1)", () => {
    const shared = /\.ag-window,\s*\.artifact\s*\{([^}]*)\}/.exec(css);
    expect(shared).not.toBeNull();
    const decls = shared![1].replace(/\/\*[\s\S]*?\*\//g, "");
    expect(decls).not.toMatch(/position|overflow|height|width|display|inset|margin/);
    expect(css).not.toMatch(/\.artifact\s*\{[^}]*overflow:\s*hidden/);
  });
});
