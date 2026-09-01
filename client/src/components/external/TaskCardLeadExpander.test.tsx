/*
 * TaskCardLeadExpander — bot glyph gating (lead: only, not the broader
 * three-prefix match) and the in-place expander (render-gate, open/close,
 * click isolation from a parent's whole-card navigation handler).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { LeadOriginGlyph, TaskCardLeadExpander } from "./TaskCardLeadExpander";
import type { ExternalTask } from "../../lib/externalApi";

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Audit drift",
    cwd: "/tmp/project",
    pluginDirs: [],
    projectId: "project-001",
    state: "draft",
    createdAt: "2026-04-23T15:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

describe("LeadOriginGlyph", () => {
  // @covers FR-01.01
  it("renders for a task with a lead: origin tag", () => {
    render(<LeadOriginGlyph taskId="task-1" tags={["lead:helper-01"]} />);
    expect(screen.getByTestId("task-card-lead-glyph-task-1")).toBeInTheDocument();
  });

  // @covers FR-01.01
  it("is exposed to assistive tech via role=img + aria-label — the glyph is the SOLE signal, so it must not be aria-hidden", () => {
    render(<LeadOriginGlyph taskId="task-1" tags={["lead:helper-01"]} />);
    expect(screen.getByRole("img", { name: "Lead-originated task" })).toBeInTheDocument();
  });

  // @covers FR-01.01
  it("does NOT render for an ordinary task with no tags", () => {
    render(<LeadOriginGlyph taskId="task-1" tags={undefined} />);
    expect(screen.queryByTestId("task-card-lead-glyph-task-1")).toBeNull();
  });

  // @covers FR-01.01
  it("does NOT render for a task carrying only lead-wait: or lead-dedup: (no origin tag)", () => {
    render(<LeadOriginGlyph taskId="task-1" tags={["lead-wait:po"]} />);
    expect(screen.queryByTestId("task-card-lead-glyph-task-1")).toBeNull();
    render(<LeadOriginGlyph taskId="task-2" tags={["lead-dedup:abc"]} />);
    expect(screen.queryByTestId("task-card-lead-glyph-task-2")).toBeNull();
  });
});

describe("TaskCardLeadExpander", () => {
  // @covers FR-01.01
  it("renders nothing for an ordinary task (no lead tags, no metadata)", () => {
    render(<TaskCardLeadExpander task={baseTask()} />);
    expect(screen.queryByTestId("task-card-lead-expander-task-1")).toBeNull();
  });

  // @covers FR-01.01
  it("renders nothing for a task with only unrelated, non-lead tags", () => {
    render(<TaskCardLeadExpander task={baseTask({ tags: ["urgent", "backend"] })} />);
    expect(screen.queryByTestId("task-card-lead-expander-task-1")).toBeNull();
  });

  // @covers FR-01.01
  it("renders the toggle (collapsed) when a lead tag is present", () => {
    render(<TaskCardLeadExpander task={baseTask({ tags: ["lead:helper-01"] })} />);
    const toggle = screen.getByTestId("task-card-lead-expander-toggle-task-1");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("task-card-lead-expander-body-task-1")).toBeNull();
  });

  // @covers FR-01.01
  it("renders the toggle when only metadata (priority/domain/complexityHint) is present, no lead tag", () => {
    render(<TaskCardLeadExpander task={baseTask({ priority: "P0" })} />);
    expect(screen.getByTestId("task-card-lead-expander-toggle-task-1")).toBeInTheDocument();
  });

  // @covers FR-01.01
  it("opens the panel showing priority (color-coded), domain, complexityHint, and lead tag readouts", async () => {
    const user = userEvent.setup();
    render(
      <TaskCardLeadExpander
        task={baseTask({
          priority: "P0",
          domain: "billing",
          complexityHint: "large",
          tags: ["lead:helper-07", "lead-wait:po", "lead-dedup:card-9f3"],
        })}
      />,
    );
    await user.click(screen.getByTestId("task-card-lead-expander-toggle-task-1"));
    const body = screen.getByTestId("task-card-lead-expander-body-task-1");
    expect(body).toBeInTheDocument();
    expect(screen.getByTestId("task-card-lead-priority-task-1")).toHaveTextContent("P0");
    expect(screen.getByTestId("task-card-lead-domain-task-1")).toHaveTextContent("billing");
    expect(screen.getByTestId("task-card-lead-complexity-task-1")).toHaveTextContent("large");
    expect(screen.getByTestId("task-card-lead-origin-task-1")).toHaveTextContent("helper-07");
    expect(screen.getByTestId("task-card-lead-wait-task-1")).toHaveTextContent("Waiting on PO");
    expect(screen.getByTestId("task-card-lead-dedup-task-1")).toHaveTextContent("card-9f3");
  });

  // @covers FR-01.01
  it("closes again on a second toggle click", async () => {
    const user = userEvent.setup();
    render(<TaskCardLeadExpander task={baseTask({ tags: ["lead:x"] })} />);
    const toggle = screen.getByTestId("task-card-lead-expander-toggle-task-1");
    await user.click(toggle);
    expect(screen.getByTestId("task-card-lead-expander-body-task-1")).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByTestId("task-card-lead-expander-body-task-1")).toBeNull();
  });

  // @covers FR-01.01
  it("stops propagation on the toggle AND on the open panel — a click on either never reaches a parent handler", async () => {
    const user = userEvent.setup();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <TaskCardLeadExpander task={baseTask({ tags: ["lead:x"], priority: "P1" })} />
      </div>,
    );
    await user.click(screen.getByTestId("task-card-lead-expander-toggle-task-1"));
    expect(onParentClick).not.toHaveBeenCalled();

    const priorityBadge = screen.getByTestId("task-card-lead-priority-task-1");
    await user.click(priorityBadge);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  // @covers FR-01.01
  it("Enter/Space on the toggle expands the panel and does not reach a parent keydown handler (dnd-kit isolation)", async () => {
    const user = userEvent.setup();
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <TaskCardLeadExpander task={baseTask({ tags: ["lead:x"] })} />
      </div>,
    );
    const toggle = screen.getByTestId("task-card-lead-expander-toggle-task-1");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("task-card-lead-expander-body-task-1")).toBeInTheDocument();
    expect(onParentKeyDown).not.toHaveBeenCalled();

    await user.keyboard(" ");
    expect(screen.queryByTestId("task-card-lead-expander-body-task-1")).toBeNull();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  // @covers FR-01.01
  it("a press-and-drag starting on the toggle does not reach a parent pointerdown handler", async () => {
    const user = userEvent.setup();
    const onParentPointerDown = vi.fn();
    render(
      <div onPointerDown={onParentPointerDown}>
        <TaskCardLeadExpander task={baseTask({ tags: ["lead:x"] })} />
      </div>,
    );
    await user.pointer({ target: screen.getByTestId("task-card-lead-expander-toggle-task-1"), keys: "[MouseLeft]" });
    expect(onParentPointerDown).not.toHaveBeenCalled();
  });

  // @covers FR-01.01
  it("an unrelated key on the toggle (e.g. the board's global 'i' shortcut) is NOT stopped — only Enter/Space/Arrow* are", async () => {
    const user = userEvent.setup();
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <TaskCardLeadExpander task={baseTask({ tags: ["lead:x"] })} />
      </div>,
    );
    screen.getByTestId("task-card-lead-expander-toggle-task-1").focus();
    await user.keyboard("i");
    expect(onParentKeyDown).toHaveBeenCalledTimes(1);
  });
});
