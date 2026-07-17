/*
 * BoardStatusFilter — the compact status funnel (on-photo-legibility fix,
 * 2026-07-17). <StatusFilterMenu> is now the SOLE filter affordance on every
 * viewport (the retired <StatusPillRow> chip strip rode bare on the photo). The
 * icon-triggered menu is multi-select (toggling must NOT close it, preventDefault)
 * plus a prototype-style "All" row that clears the filter. Behaviour (states,
 * counts, result set) is byte-for-byte unchanged from the pill row.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { StatusFilterMenu } from "./BoardStatusFilter";
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

describe("StatusFilterMenu (compact funnel — sole affordance, all viewports)", () => {
  // @covers FR-01.41
  it("shows no active dot when the filter is empty", () => {
    render(
      <StatusFilterMenu counts={COUNTS} active={set()} onToggle={() => {}} onReset={() => {}} />,
    );
    expect(screen.getByTestId("board-filter-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("board-filter-menu-dot")).toBeNull();
  });

  // @covers FR-01.41
  it("shows the active dot when at least one status is selected", () => {
    render(
      <StatusFilterMenu counts={COUNTS} active={set("active")} onToggle={() => {}} onReset={() => {}} />,
    );
    expect(screen.getByTestId("board-filter-menu-dot")).toBeInTheDocument();
  });

  // @covers FR-01.41
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

  // @covers FR-01.41
  it("has an 'All' row (prototype __filterMenu) that clears the filter and shows the total", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <StatusFilterMenu counts={COUNTS} active={set("done")} onToggle={() => {}} onReset={onReset} />,
    );
    await user.click(screen.getByTestId("board-filter-menu-trigger"));
    const all = await screen.findByTestId("board-filter-menu-all");
    // total = sum of all per-state counts (1 draft + 2 active + 3 done = 6).
    expect(all).toHaveTextContent("6");
    await user.click(all);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
