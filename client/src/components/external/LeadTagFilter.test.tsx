/*
 * LeadTagFilter — the Bot dropdown (three-prefix checkbox menu) and the
 * BellDot shortcut toggle (FR-04.11). Mirrors BoardStatusFilter.test.tsx's
 * structure: open/toggle/reset for the menu, plus BellDot's derived-state
 * sync with the shared filter Set.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { LeadTagFilterMenu, LeadWaitToggleButton } from "./LeadTagFilter";
import { useBoardFilters } from "../../hooks/useBoardFilters";
import {
  LEAD_ORIGIN_TAG_PREFIX,
  LEAD_WAIT_TAG_PREFIX,
  LEAD_DEDUP_TAG_PREFIX,
  type LeadTagPrefix,
} from "../../lib/leadTags";
import type { ExternalTask } from "../../lib/externalApi";

function task(tags: string[]): ExternalTask {
  return {
    taskId: `t-${Math.random()}`,
    sessionUuid: "u",
    title: "t",
    cwd: "/tmp",
    pluginDirs: [],
    projectId: "p",
    state: "draft",
    createdAt: "2026-04-23T15:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    tags,
  };
}

function WiredMenuAndBellDot() {
  const { leadTagCounts, leadTagTotal, leadTagFilter, toggleLeadTag, clearLeadTagFilter } = useBoardFilters([
    task(["lead-wait:po"]),
  ]);
  return (
    <>
      <LeadTagFilterMenu
        counts={leadTagCounts}
        total={leadTagTotal}
        active={leadTagFilter}
        onToggle={toggleLeadTag}
        onReset={clearLeadTagFilter}
      />
      <LeadWaitToggleButton active={leadTagFilter} onToggle={toggleLeadTag} />
    </>
  );
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});

const COUNTS: Record<LeadTagPrefix, number> = {
  [LEAD_ORIGIN_TAG_PREFIX]: 2,
  [LEAD_WAIT_TAG_PREFIX]: 1,
  [LEAD_DEDUP_TAG_PREFIX]: 3,
};

const set = (...s: LeadTagPrefix[]) => new Set<LeadTagPrefix>(s);

describe("LeadTagFilterMenu (Bot dropdown)", () => {
  // @covers FR-01.01
  it("shows no active dot when the filter is empty", () => {
    render(<LeadTagFilterMenu counts={COUNTS} total={9} active={set()} onToggle={() => {}} onReset={() => {}} />);
    expect(screen.getByTestId("board-lead-filter-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("board-lead-filter-menu-dot")).toBeNull();
  });

  // @covers FR-01.01
  it("shows the active dot when at least one prefix is selected", () => {
    render(
      <LeadTagFilterMenu counts={COUNTS} total={9} active={set(LEAD_ORIGIN_TAG_PREFIX)} onToggle={() => {}} onReset={() => {}} />,
    );
    expect(screen.getByTestId("board-lead-filter-menu-dot")).toBeInTheDocument();
  });

  // @covers FR-01.01
  it("opens a menu with all three prefixes asserted by name, each toggling and keeping the menu open", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<LeadTagFilterMenu counts={COUNTS} total={9} active={set()} onToggle={onToggle} onReset={() => {}} />);
    await user.click(screen.getByTestId("board-lead-filter-menu-trigger"));
    const menu = await screen.findByTestId("board-lead-filter-menu");

    expect(within(menu).getByTestId("board-lead-filter-menu-item-lead")).toBeInTheDocument();
    expect(within(menu).getByTestId("board-lead-filter-menu-item-lead-wait")).toBeInTheDocument();
    expect(within(menu).getByTestId("board-lead-filter-menu-item-lead-dedup")).toBeInTheDocument();

    await user.click(within(menu).getByTestId("board-lead-filter-menu-item-lead-dedup"));
    expect(onToggle).toHaveBeenCalledWith(LEAD_DEDUP_TAG_PREFIX);
    // preventDefault on the CheckboxItem keeps it open for multi-select.
    expect(screen.getByTestId("board-lead-filter-menu")).toBeInTheDocument();
  });

  // @covers FR-01.01
  it("has an 'All' row that clears the filter and shows the caller-supplied total — NOT the sum of the per-prefix counts", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    // total=9 is deliberately NOT 2+1+3=6: lead-tag prefixes can overlap
    // (a task can carry more than one) and are not exhaustive (an ordinary
    // task carries none), so the "All" count must come from the caller
    // (the real project-filtered task count), never a sum of the buckets
    // (code review finding, iterate-2026-09-01-lead-board-surface).
    render(
      <LeadTagFilterMenu counts={COUNTS} total={9} active={set(LEAD_WAIT_TAG_PREFIX)} onToggle={() => {}} onReset={onReset} />,
    );
    await user.click(screen.getByTestId("board-lead-filter-menu-trigger"));
    const all = await screen.findByTestId("board-lead-filter-menu-all");
    expect(all).toHaveTextContent("9");
    await user.click(all);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("LeadWaitToggleButton (BellDot)", () => {
  // @covers FR-01.01
  it("is not pressed when lead-wait: is not in the active set", () => {
    render(<LeadWaitToggleButton active={set()} onToggle={() => {}} />);
    expect(screen.getByTestId("board-lead-wait-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  // @covers FR-01.01
  it("derives pressed state from the SAME shared Set the Bot menu uses (no independent state)", () => {
    render(<LeadWaitToggleButton active={set(LEAD_WAIT_TAG_PREFIX)} onToggle={() => {}} />);
    expect(screen.getByTestId("board-lead-wait-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  // @covers FR-01.01
  it("calls onToggle with exactly the lead-wait: prefix — the same value the menu checkbox uses", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<LeadWaitToggleButton active={set()} onToggle={onToggle} />);
    await user.click(screen.getByTestId("board-lead-wait-toggle"));
    expect(onToggle).toHaveBeenCalledWith(LEAD_WAIT_TAG_PREFIX);
  });

  // @covers FR-01.01
  it("stays in sync when the SAME active Set is shared with the Bot menu (menu selection reflected in BellDot)", () => {
    const shared = set(LEAD_WAIT_TAG_PREFIX);
    const { rerender } = render(<LeadWaitToggleButton active={shared} onToggle={() => {}} />);
    expect(screen.getByTestId("board-lead-wait-toggle")).toHaveAttribute("aria-pressed", "true");
    rerender(<LeadWaitToggleButton active={set()} onToggle={() => {}} />);
    expect(screen.getByTestId("board-lead-wait-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  // @covers FR-01.01
  it("selecting lead-wait: in the real Bot menu flips the real BellDot to pressed (both mounted against one shared useBoardFilters — external code review, iterate-2026-09-01-lead-board-surface)", async () => {
    const user = userEvent.setup();
    render(<WiredMenuAndBellDot />);
    expect(screen.getByTestId("board-lead-wait-toggle")).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByTestId("board-lead-filter-menu-trigger"));
    const menu = await screen.findByTestId("board-lead-filter-menu");
    await user.click(within(menu).getByTestId("board-lead-filter-menu-item-lead-wait"));

    expect(screen.getByTestId("board-lead-wait-toggle")).toHaveAttribute("aria-pressed", "true");
  });
});
