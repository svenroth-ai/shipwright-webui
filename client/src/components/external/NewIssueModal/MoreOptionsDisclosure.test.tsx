/*
 * Unit tests for MoreOptionsDisclosure — the collapsed-by-default gray
 * wrapper around the create-dialog's below-Description area.
 * iterate-2026-07-06-collapse-dialog-more-options.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { MoreOptionsDisclosure } from "./MoreOptionsDisclosure";

afterEach(() => {
  cleanup();
});

describe("MoreOptionsDisclosure", () => {
  it("renders the toggle with the default label and hides content when collapsed", () => {
    render(
      <MoreOptionsDisclosure open={false} onToggle={() => {}}>
        <div data-testid="child">inner</div>
      </MoreOptionsDisclosure>,
    );
    const toggle = screen.getByTestId("new-issue-more-options-toggle");
    expect(toggle.textContent).toContain("More options");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed → children are not in the DOM.
    expect(screen.queryByTestId("new-issue-more-options-content")).toBeNull();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("reveals children when open", () => {
    render(
      <MoreOptionsDisclosure open onToggle={() => {}}>
        <div data-testid="child">inner</div>
      </MoreOptionsDisclosure>,
    );
    expect(
      screen.getByTestId("new-issue-more-options-content"),
    ).toBeTruthy();
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(
      screen
        .getByTestId("new-issue-more-options-toggle")
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("fires onToggle when the header is clicked", () => {
    const onToggle = vi.fn();
    render(
      <MoreOptionsDisclosure open={false} onToggle={onToggle}>
        <div />
      </MoreOptionsDisclosure>,
    );
    fireEvent.click(screen.getByTestId("new-issue-more-options-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // Sven 2026-07-17: the bar must read darker when EXPANDED, not only on hover —
  // and it must still have a visible frame (the old --color-border was invisible
  // next to the fields' frames).
  it("carries the darker tone persistently when expanded, and a visible frame", () => {
    const { rerender } = render(
      <MoreOptionsDisclosure open={false} onToggle={() => {}}>
        <div />
      </MoreOptionsDisclosure>,
    );
    const collapsed = screen.getByTestId("new-issue-more-options-toggle");
    // collapsed: the darker tone is a HOVER affordance only
    expect(collapsed.className).toContain("hover:bg-[var(--surface-form-sunken-strong");
    expect(collapsed.className).not.toContain(" bg-[var(--surface-form-sunken-strong");
    expect(screen.getByTestId("new-issue-more-options")).not.toHaveAttribute("data-open");

    rerender(
      <MoreOptionsDisclosure open onToggle={() => {}}>
        <div />
      </MoreOptionsDisclosure>,
    );
    const expanded = screen.getByTestId("new-issue-more-options-toggle");
    // expanded: the darker tone is PERSISTENT, and hover still steps darker again
    expect(expanded.className).toContain("bg-[var(--surface-form-sunken-strong");
    expect(expanded.className).toContain("hover:bg-[var(--surface-form-divider");
    expect(screen.getByTestId("new-issue-more-options")).toHaveAttribute("data-open");
    // the frame is the fields' visible one, never the invisible --color-border
    expect(screen.getByTestId("new-issue-more-options").className).toContain(
      "border-[var(--surface-form-line",
    );
  });

  // Sven 2026-07-20: when expanded, the header's rounded BOTTOM corners used to
  // curve inward while the content's straight `border-t` divider ran edge-to-edge
  // — the divider collided with the header's rounded corners. Fix: round only the
  // TOP corners when open, so the header's square bottom meets the divider flush.
  it("rounds only its top corners when expanded (square bottom meets the divider)", () => {
    const { rerender } = render(
      <MoreOptionsDisclosure open={false} onToggle={() => {}}>
        <div />
      </MoreOptionsDisclosure>,
    );
    // collapsed: the whole bar is a rounded pill — all four corners.
    const collapsed = screen.getByTestId("new-issue-more-options-toggle");
    expect(collapsed.className).toContain("rounded-[var(--radius-button");
    expect(collapsed.className).not.toContain("rounded-t-[var(--radius-button");

    rerender(
      <MoreOptionsDisclosure open onToggle={() => {}}>
        <div />
      </MoreOptionsDisclosure>,
    );
    // expanded: only the top corners round; the bottom stays square so the
    // content divider does not collide with a curve.
    const expanded = screen.getByTestId("new-issue-more-options-toggle");
    expect(expanded.className).toContain("rounded-t-[var(--radius-button");
    expect(expanded.className).not.toContain("rounded-[var(--radius-button");
  });

  it("honours a custom label", () => {
    render(
      <MoreOptionsDisclosure open={false} onToggle={() => {}} label="Advanced">
        <div />
      </MoreOptionsDisclosure>,
    );
    expect(
      screen.getByTestId("new-issue-more-options-toggle").textContent,
    ).toContain("Advanced");
  });
});
