/*
 * Wizard buttons — the WzOutline "Back" contrast fence (iterate-2026-08-24).
 *
 * WzOutline is a SOLID var(--card) reading surface whose text is var(--ink). On
 * the photo backdrop, on-photo.css rule-1 flips --ink white for bare chrome; a
 * solid surface must appear in the rule-2 :is() reset list or it renders white
 * text on a white card (the reported "Back button: white on white" defect).
 *
 * jsdom applies no real cascade, so contrast is fenced two ways: the component
 * must carry the `wz-outline` reset hook, AND on-photo.css must list `.wz-outline`
 * in the rule-2 reset selector. Both directions or the fix silently rots.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WzOutline, WzPrimary } from "./buttons";

afterEach(() => cleanup());

describe("WzOutline — on-photo reset hook", () => {
  it("carries the wz-outline class (the rule-2 reset hook)", () => {
    render(<WzOutline data-testid="wz-back">Back</WzOutline>);
    expect(screen.getByTestId("wz-back").className).toContain("wz-outline");
  });

  it("merges a caller-supplied className with wz-outline", () => {
    render(
      <WzOutline data-testid="wz-back" className="extra">
        Back
      </WzOutline>,
    );
    const cls = screen.getByTestId("wz-back").className;
    expect(cls).toContain("wz-outline");
    expect(cls).toContain("extra");
  });

  it("on-photo.css lists .wz-outline in the rule-2 solid-surface reset", () => {
    // vitest runs from the client workspace root.
    const css = readFileSync(join(process.cwd(), "src/styles/on-photo.css"), "utf8");
    // The rule-2 reset re-darkens --ink for solid surfaces; it is the ONE
    // `.on-photo :is(...)` block that lists .wz-opt AND .wz-input (unique to
    // rule-2, not rule-3). Match the whole `:is(...)` selector with a
    // whitespace-tolerant regex so a future reflow of the long selector list
    // across lines does not turn a real "wz-outline missing" failure into a
    // misleading "selector not found" one.
    const rule2 = css.match(/\.on-photo\s+:is\(([\s\S]*?)\)\s*\{/g)
      ?.find((block) => block.includes(".wz-opt") && block.includes(".wz-input"));
    expect(rule2, "rule-2 reset selector not found").toBeTruthy();
    expect(rule2).toContain(".wz-outline");
  });
});

describe("WzPrimary — unaffected (white on accent)", () => {
  it("does not carry the outline reset hook", () => {
    render(<WzPrimary data-testid="wz-go">Go</WzPrimary>);
    expect(screen.getByTestId("wz-go").className).not.toContain("wz-outline");
  });
});
