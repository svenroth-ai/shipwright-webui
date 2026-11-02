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
  it("each group is a SOLID lifted card; rows + outputs share the --fs-row type step; output rows are tight full-width buttons (44px only when coarse)", () => {
    const sec = rule(css, ".env-sec");
    expect(sec).toMatch(/border-radius:\s*12px/);
    expect(sec).toMatch(/background:\s*var\(--card\)/); // solid, not translucent
    expect(sec).toMatch(/box-shadow:\s*var\(--sh-elev\)/);
    expect(sec).toMatch(/border:\s*1px solid var\(--line\)/);
    const row = rule(css, ".env-row");
    expect(row).toMatch(/font-size:\s*var\(--fs-row\)/);
    const out = rule(css, ".env-output");
    expect(out).toMatch(/min-height:\s*30px/);
    expect(out).toMatch(/width:\s*100%/);
    expect(out).toMatch(/font-size:\s*var\(--fs-row\)/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{ \.env-output, \.env-pill-btn \{ min-height: 44px; \} \}/);
    // the tree uses the very same token
    const tree = readFileSync(path.join(dir, "folder-tree.css"), "utf8");
    expect(rule(tree, ".ft-tree")).toMatch(/font-size:\s*var\(--fs-row\)/);
    expect(tree).toMatch(/\.ft-node \{[^}]*font-size: var\(--fs-row\)/);
  });
  // @covers FR-01.66
  it("overflow fence: one minmax(0,1fr) track, shrinkable cards, truncating values, ellipsis names", () => {
    // an implicit `auto` track grows to the widest nowrap row and pushes the whole pane past its edge
    expect(rule(css, ".env-panel")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule(css, ".env-sec")).toMatch(/min-width:\s*0/);
    expect(rule(css, ".mc-side-body")).toMatch(/overflow-x:\s*hidden/);
    expect(rule(css, ".env-v")).toMatch(/min-width:\s*0[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
    expect(rule(css, ".env-output")).toMatch(/min-width:\s*0/);
    expect(rule(css, ".env-output-name")).toMatch(/min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/);
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
