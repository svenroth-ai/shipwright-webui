/*
 * InboxResumeButton — navigation CTA contract (A19, FR-01.63).
 *
 * The CTA used to COPY a resume command to the clipboard. It now NAVIGATES to
 * the task's embedded terminal (the honest fallback — the operator types the
 * reply themselves). This test pins the new contract:
 *   - clicking navigates to the terminal deep link;
 *   - it writes NOTHING (no clipboard, no launch mutation);
 *   - it stops propagation so the containing card doesn't double-navigate.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";

import { InboxResumeButton } from "./InboxResumeButton";
import { buildTaskTerminalDeepLink } from "../../lib/taskDeepLink";
import type { ExternalTask } from "../../lib/externalApi";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-A",
    sessionUuid: "sess-A",
    cwd: "/tmp",
    pluginDirs: [],
    title: "task-A",
    projectId: "proj-a",
    state: "active",
    createdAt: "2026-04-20T00:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

function Probe() {
  const loc = useLocation();
  const params = useParams();
  return (
    <div
      data-testid="task-detail-probe"
      data-task-id={params.id ?? ""}
      data-search={loc.search}
    />
  );
}

function renderBtn(task: ExternalTask, toolUseId = "tu-A", onCardClick?: () => void) {
  return render(
    <MemoryRouter initialEntries={["/inbox"]}>
      <Routes>
        <Route
          path="/inbox"
          element={
            <div onClick={onCardClick} data-testid="card">
              <InboxResumeButton task={task} idKey={toolUseId} />
            </div>
          }
        />
        <Route path="/tasks/:id" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InboxResumeButton — navigation CTA", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });
  });

  // @covers FR-01.04
  it("renders an 'Answer in the terminal' button (not a copy button)", () => {
    renderBtn(makeTask());
    const btn = screen.getByTestId("inbox-resume-tu-A");
    expect(btn.textContent).toMatch(/answer in the terminal/i);
    expect(btn.textContent ?? "").not.toMatch(/copy/i);
  });

  // @covers FR-01.04
  it("click navigates to the task's terminal deep link", () => {
    renderBtn(makeTask());
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    const probe = screen.getByTestId("task-detail-probe");
    expect(probe).toHaveAttribute("data-task-id", "task-A");
    const expected = buildTaskTerminalDeepLink("task-A");
    expect(probe.getAttribute("data-search")).toBe(
      expected.slice(expected.indexOf("?")),
    );
  });

  // @covers FR-01.04
  it("writes NOTHING — no clipboard, no launch mutation", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    renderBtn(makeTask());
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    expect(writeText).not.toHaveBeenCalled();
  });

  // @covers FR-01.04
  it("stops propagation so the card doesn't also fire its onClick", () => {
    const cardClick = vi.fn();
    renderBtn(makeTask(), "tu-A", cardClick);
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    expect(cardClick).not.toHaveBeenCalled();
  });

  // @covers FR-01.04
  it("carries NO misleading legacy copy testid", () => {
    renderBtn(makeTask());
    expect(screen.queryByTestId("inbox-copy-resume-tu-A")).not.toBeInTheDocument();
    expect(screen.getByTestId("inbox-resume-tu-A")).toBeInTheDocument();
  });
});
