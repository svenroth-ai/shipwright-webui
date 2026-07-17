/*
 * ON-PHOTO LEGIBILITY FENCE (iterate-2026-07-17-onphoto-legibility-fix).
 *
 * The board CAMPAIGNS rail label, the inbox project group header + subtitle,
 * and the triage group headers ride BARE on the deck-golden photo (below the
 * 300px scrim band). They must therefore use the Weather-Deck ink tokens that
 * FLIP WHITE under `.on-photo` (`--ink` / `--muted`), NOT the legacy `--color-*`
 * aliases — which are computed at `:root` and do NOT flip (see the note in
 * `styles/type-scale.css`), so they stayed dark → invisible on the rigging /
 * low-contrast on the sky (Sven live-UI feedback).
 *
 * AC1 — this asserts each of those labels now uses the flipping token, not the
 *        bare alias (a class/token fence; jsdom can't measure real contrast, so
 *        the real proof is the regenerated visual baseline the orchestrator
 *        eyeballs).
 * AC4 — no `text-shadow` is (re)introduced on ANY of the touched surfaces
 *        (Sven rejected per-glyph shadows, #265 — the fix is the flipping token
 *        + solid/glass grounds, never a shadow).
 *
 * Prove it bites: revert any of those labels to `--color-text` / `--color-muted`,
 * or add a `text-shadow`, and this test goes RED.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Strip block comments (incl. JSX `{/* … *​/}`) + whole-line `//` so our own
 *  explanatory comments (which name the legacy tokens) never false-match. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function read(rel: string): string {
  return strip(readFileSync(path.join(SRC, rel), "utf8"));
}

const TOUCHED = [
  "components/external/CampaignsLane.tsx",
  "components/external/BoardStatusFilter.tsx",
  "components/external/TaskBoardColumns.tsx",
  "pages/inbox/InboxProjectSection.tsx",
  "pages/InboxPage.tsx",
  "pages/TriagePage.tsx",
];

describe("on-photo legibility — AC1 flipping-token fence", () => {
  it("board CAMPAIGNS label uses the flipping --muted token, not the legacy alias", () => {
    const src = read("components/external/CampaignsLane.tsx");
    expect(src).toContain("tracking-wide text-[var(--muted)]");
    expect(src).not.toMatch(/text-\[var\(--color-muted/);
    expect(src).not.toMatch(/hover:text-\[var\(--color-text/);
  });

  it("inbox project group header uses --ink / --muted, not --color-text / --color-muted", () => {
    const src = read("pages/inbox/InboxProjectSection.tsx");
    expect(src).toContain('color: "var(--ink)"');
    expect(src).toContain('color: "var(--muted)"');
    expect(src).not.toContain('color: "var(--color-text)"');
    expect(src).not.toContain('color: "var(--color-muted)"');
  });

  it("triage group + project headers use --ink / --muted, not the legacy text aliases", () => {
    const src = read("pages/TriagePage.tsx");
    expect(src).toMatch(/text-\[var\(--ink\)\]/);
    expect(src).toMatch(/text-\[var\(--muted\)\]/);
    expect(src).not.toMatch(/text-\[var\(--color-text\)\]/);
    expect(src).not.toMatch(/text-\[var\(--color-muted\)\]/);
  });
});

describe("on-photo legibility — AC4 no text-shadow on the touched surfaces", () => {
  for (const rel of TOUCHED) {
    it(`${rel} introduces no text-shadow`, () => {
      const src = read(rel);
      expect(src).not.toMatch(/text-shadow/i);
      expect(src).not.toMatch(/textShadow/);
    });
  }
});
