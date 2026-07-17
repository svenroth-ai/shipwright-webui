/*
 * GradeRing under reduced motion (A20, FR-01.64 — AC1/AC6/AC8, integration).
 *
 * The unit test on useCountUp proves the hook; THIS proves the wiring: the real
 * GradeRing, under reduced motion (jsdom has no matchMedia -> useReducedMotion
 * returns true), renders its FINAL drawn arc immediately — never an empty ring
 * waiting to animate. And a null score is an honest no-arc state (AC8): no
 * count-up over a number that does not exist.
 */

import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { GradeRing } from "./GradeRing";

const R = 34;
const C = 2 * Math.PI * R;

function arcCircle(container: HTMLElement): SVGCircleElement | null {
  // The scored arc is the circle carrying stroke-dashoffset (the track has none).
  return container.querySelector<SVGCircleElement>("circle[stroke-dashoffset]");
}

describe("GradeRing — final drawn arc under reduced motion", () => {
  it("a real score renders the FINAL arc (offset strictly below the full circumference)", () => {
    const { container } = render(<GradeRing letter="A" score={98} />);
    const arc = arcCircle(container);
    expect(arc).not.toBeNull();
    const off = Number(arc!.getAttribute("stroke-dashoffset"));
    const arr = Number(arc!.getAttribute("stroke-dasharray"));
    // Drawn, not empty: an empty ring would have offset == circumference.
    expect(off).toBeLessThan(arr);
    // And it is the score's FINAL offset (98/100 of the way drawn), not a partial
    // count still in flight.
    expect(off).toBeCloseTo(C * (1 - 98 / 100), 1);
  });

  it("a null score is an honest no-arc state — no fabricated 0, no count-up", () => {
    const { container } = render(<GradeRing letter="?" score={null} />);
    expect(arcCircle(container)).toBeNull();
  });
});
