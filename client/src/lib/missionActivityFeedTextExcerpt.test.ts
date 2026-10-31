/*
 * `explanationExcerpt` runs over untrusted hand-back text (up to 2 MB) on every
 * transcript poll. A trailing-whitespace regex there backtracks quadratically on
 * a long run of spaces inside one line, so this pins the linear behaviour.
 */
import { describe, expect, it } from "vitest";
import { explanationExcerpt } from "./missionActivityFeedText";

describe("explanationExcerpt on pathological whitespace", () => {
  // @covers FR-01.66
  it("handles a-space run inside one line quickly", () => {
    const started = Date.now();
    const out = explanationExcerpt(`x${" ".repeat(200_000)}y`, Infinity, Infinity);
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.startsWith("x")).toBe(true);
    expect(out.endsWith("y")).toBe(true);
  });

  // @covers FR-01.66
  it("still trims trailing whitespace per line", () => {
    expect(explanationExcerpt("a   \nb\t\t\n", 6, 600)).toBe("a\nb");
  });
});
