/**
 * Class fence for the Triage row layout (iterate-2026-11-13-triage-rows-round3).
 * jsdom has no layout engine, so the real-browser proof lives in
 * e2e/flows/triage-lanes-rows.spec.ts; this pins the rules that make the title
 * stand still when the hover buttons appear.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "triage-rows.css"), "utf8");

// @covers FR-01.30
describe("triage-rows.css — a fixed action zone, the title never reflows", () => {
  it("reserves an empty action zone between title and meta in wide rows with a hovering pointer", () => {
    expect(css).toMatch(/@media \(hover: hover\)\s*\{\s*@container triage-row \(min-width: 68rem\)/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 29rem 16\.5rem/);
    expect(css).toMatch(/grid-template-areas:\s*"main actions meta"/);
  });

  it("hides the buttons with visibility (the zone stays) and shows them on hover, focus or an open popover", () => {
    expect(css).toMatch(/\.triage-row-actions\s*\{[^}]*visibility:\s*hidden/);
    expect(css).toContain(".triage-row:hover .triage-row-actions");
    expect(css).toContain(".triage-row:focus-within .triage-row-actions");
    expect(css).toContain('.triage-row-actions:has([data-state="open"])');
  });

  it("no longer pads or re-wraps the title on hover (the old overlay trick)", () => {
    expect(css).not.toContain("padding-right: 32rem");
    expect(css).not.toMatch(/\.triage-row:hover \.triage-row-title/);
  });
});
