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
