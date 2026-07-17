/*
 * The staggered-list CONTRACT (A20, FR-01.64, AC1/AC6).
 *
 * RED-first: fails until lib/motion.ts exists. The fence: a staggered list must
 * render ALL its items with the content in its FINAL, visible state — the
 * stagger is an entrance layered ON TOP (`.motion-stagger-item`, gated by
 * `@media (prefers-reduced-motion: no-preference)`), NEVER a per-item opacity:0
 * that a keyframe reveals. So the falsifiable proof is: every item is present
 * AND no item is hidden-by-default via an inline opacity:0. A 30-item list's
 * last delay is capped, so it appears in <= --motion-slow, not 1.2s.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { staggerStyle, staggerDelayMs } from "./motion";

function StaggeredList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((label, i) => (
        <li
          key={label}
          className="motion-stagger-item"
          style={staggerStyle(i)}
          data-testid={`stagger-item-${i}`}
        >
          {label}
        </li>
      ))}
    </ul>
  );
}

describe("staggered list renders ALL items in their final visible state", () => {
  const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);

  it("renders every item (nothing is gated behind the animation)", () => {
    render(<StaggeredList items={items} />);
    for (let i = 0; i < items.length; i++) {
      expect(screen.getByTestId(`stagger-item-${i}`)).toBeInTheDocument();
    }
  });

  it("never hides content by default — no item carries an inline opacity:0", () => {
    render(<StaggeredList items={items} />);
    for (let i = 0; i < items.length; i++) {
      const el = screen.getByTestId(`stagger-item-${i}`);
      expect(el.style.opacity).not.toBe("0");
    }
  });

  it("carries the capped entrance delay as a CSS var (30 items <= --motion-slow)", () => {
    render(<StaggeredList items={items} />);
    const last = screen.getByTestId("stagger-item-29");
    expect(last.style.getPropertyValue("--stagger-delay")).toBe(`${staggerDelayMs(29)}ms`);
    expect(staggerDelayMs(29)).toBeLessThanOrEqual(320);
  });
});
