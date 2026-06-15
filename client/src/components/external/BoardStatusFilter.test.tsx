/*
 * BoardStatusFilter — AC-2 (iterate-2026-06-15-mobile-tablet-layout-polish).
 * The phone status filter is an icon-triggered multi-select menu (no pills);
 * toggling a status must NOT close the menu (preventDefault) so several can be
 * picked in one open. The ≥768px pill row keeps its existing chip behavior.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { StatusFilterMenu, StatusPillRow } from "./BoardStatusFilter";
import type { ExternalTaskState } from "../../lib/externalApi";

beforeAll(() => {
  // Radix DropdownMenu reaches for pointer-capture + scrollIntoView APIs jsdom
  // does not implement; stub them so the menu can open under the test runner.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});

const COUNTS: Record<ExternalTaskState, number> = {
  draft: 1,
  awaiting_external_start: 0,
  active: 2,
  idle: 0,
  done: 3,
  launch_failed: 0,
  jsonl_missing: 0,
};

const set = (...s: ExternalTaskState[]) => new Set<ExternalTaskState>(s);

describe("StatusFilterMenu (phone, AC-2)", () => {
  it("shows no active dot when the filter is empty", () => {
    render(
      <StatusFilterMenu counts={COUNTS} active={set()} onToggle={() => {}} onReset={() => {}} />,
    );
    expect(screen.getByTestId("board-filter-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("board-filter-menu-dot")).toBeNull();
  });

  it("shows the active dot when at least one status is selected", () => {
    render(
      <StatusFilterMenu counts={COUNTS} active={set("active")} onToggle={() => {}} onReset={() => {}} />,
    );
    expect(screen.getByTestId("board-filter-menu-dot")).toBeInTheDocument();
  });

  it("opens a menu (not pills); toggling a status calls onToggle and keeps the menu OPEN", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <StatusFilterMenu counts={COUNTS} active={set()} onToggle={onToggle} onReset={() => {}} />,
    );
    await user.click(screen.getByTestId("board-filter-menu-trigger"));
    const menu = await screen.findByTestId("board-filter-menu");
    // This is the dropdown, not the pill row.
    expect(screen.queryByTestId("board-filter-status")).toBeNull();
    await user.click(within(menu).getByTestId("board-filter-menu-item-active"));
    expect(onToggle).toHaveBeenCalledWith("active");
    // preventDefault on the CheckboxItem keeps it open for multi-select.
    expect(screen.getByTestId("board-filter-menu")).toBeInTheDocument();
  });
});

describe("StatusPillRow (≥768px)", () => {
  it("renders the Status chips with counts and a reset affordance when active", () => {
    const onReset = vi.fn();
    render(
      <StatusPillRow counts={COUNTS} active={set("done")} onToggle={() => {}} onReset={onReset} />,
    );
    expect(screen.getByTestId("board-filter-status")).toBeInTheDocument();
    expect(screen.getByTestId("board-filter-status-done")).toHaveAttribute("data-active");
    expect(screen.getByTestId("board-filter-status-reset")).toBeInTheDocument();
  });
});
