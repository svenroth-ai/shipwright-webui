/** V6 class fence: the info-sidebar card grid, heading step and row sizes (Board 7/11). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(dir, "mission-sidebar.css"), "utf8");
const chat = readFileSync(path.join(dir, "mission-chat.css"), "utf8");
const rule = (src: string, sel: string): string => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`rule not found: ${sel}`);
  return m[1];
};

describe("mission info sidebar (V6)", () => {
  // @covers FR-01.66
  it("heading step: 12px / 600 / uppercase in the token colour (no hex)", () => {
    const h = rule(css, ".env-h");
    expect(h).toMatch(/font-size:\s*12px/);
    expect(h).toMatch(/font-weight:\s*600/);
    expect(h).toMatch(/text-transform:\s*uppercase/);
    expect(h).toMatch(/color:\s*var\(--body\)/);
    expect(h).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
  // @covers FR-01.66
  it("each group is a card; rows are >=38px at 14px; output rows are 40px full-width buttons", () => {
    expect(rule(css, ".env-sec")).toMatch(/border-radius:\s*12px/);
    const row = rule(css, ".env-row");
    expect(row).toMatch(/min-height:\s*38px/);
    expect(row).toMatch(/font-size:\s*14px/);
    const out = rule(css, ".env-output");
    expect(out).toMatch(/min-height:\s*40px/);
    expect(out).toMatch(/width:\s*100%/);
    expect(out).toMatch(/font-size:\s*14px/);
  });
  // @covers FR-01.66
  it("no font-size below 12px and no hardcoded hex colour in the sidebar sheet", () => {
    for (const m of css.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  // @covers FR-01.66
  it("the chat file chip is token-coloured", () => {
    const chip = rule(chat, ".mc-file");
    expect(chip).toMatch(/var\(--accent-tint\)/);
    expect(chip).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
