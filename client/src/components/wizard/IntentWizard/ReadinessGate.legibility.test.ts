/*
 * ReadinessGate legibility fence (iterate-2026-08-22-readiness-gate-fixes,
 * FR-01.51). Sven reported the not-ready banner rendering white-on-cream and
 * unreadable on the First-Contact photo hero.
 *
 * Root cause: `.iw-card` (the banner's surface, and every wizard reading card)
 * paints its OWN light ground (`var(--card)` / `var(--warn-tint)`), but under
 * `.on-photo` the ink tokens flip WHITE (on-photo.css rule 1) — and `.iw-card`
 * was MISSING from rule 2's solid-surface reset `:is()` list, so its text stayed
 * white on a light ground. (intent-wizard-panels.css already CLAIMED "names
 * on-photo.css already resets" — the claim was false until this fix.) jsdom is
 * blind to computed contrast, so this is a class fence; the real proof is the
 * pixel diff the visual baselines carry.
 *
 * AC — `.iw-card` is in the rule-2 reset list (so its ink goes dark-on-white),
 *      and the banner keeps the FLIPPING ink tokens (never the non-flipping
 *      `--color-*` aliases, which the reset can't move).
 *
 * Prove it bites: drop `.iw-card` from the `:is()` list, or swap the banner to
 * `var(--color-text)`, and this goes RED.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(HERE, rel), "utf8");

describe("ReadinessGate legibility — .iw-card is an on-photo reading surface", () => {
  it("on-photo.css resets .iw-card to dark-on-white (in the rule-2 :is() list)", () => {
    const css = read("../../../styles/on-photo.css");
    // The rule-2 block is the one that re-darkens --ink to #1C1917. Isolate it
    // and assert .iw-card rides inside its selector list.
    const rule2 = css.match(/\.on-photo\s*:is\(([^)]*)\)\s*\{[^}]*--ink:\s*#1C1917/i);
    expect(rule2).not.toBeNull();
    expect(rule2?.[1]).toContain(".iw-card");
  });

  it("the banner uses the FLIPPING ink tokens, not the non-flipping --color-* aliases", () => {
    const tsx = read("./ReadinessGate.tsx");
    expect(tsx).toContain("var(--ink)");
    expect(tsx).not.toMatch(/var\(--color-text\)/);
    expect(tsx).not.toMatch(/var\(--color-muted\)/);
  });
});
