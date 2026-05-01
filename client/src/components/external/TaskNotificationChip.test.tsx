import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TaskNotificationChip } from "./TaskNotificationChip";

describe("TaskNotificationChip", () => {
  it("renders the summary as plain text (XSS-safe)", () => {
    render(
      <TaskNotificationChip
        status="completed"
        summary={'Background command "git push" completed (exit code 0)'}
        taskId="b20yl2hq3"
      />,
    );
    const chip = screen.getByTestId("task-notification-chip");
    expect(chip.textContent).toContain('Background command "git push" completed');
    expect(chip.querySelector("script")).toBeNull();
  });

  it("uses the success palette for completed status", () => {
    render(
      <TaskNotificationChip status="completed" summary="ok" taskId="t1" />,
    );
    const chip = screen.getByTestId("task-notification-chip");
    expect(chip.getAttribute("data-status")).toBe("completed");
  });

  it("uses the error palette for failed status", () => {
    render(
      <TaskNotificationChip status="failed" summary="boom" taskId="t1" />,
    );
    const chip = screen.getByTestId("task-notification-chip");
    expect(chip.getAttribute("data-status")).toBe("failed");
  });

  it("falls back to a generic label when summary is empty", () => {
    render(<TaskNotificationChip status="completed" summary="" taskId="t1" />);
    const chip = screen.getByTestId("task-notification-chip");
    // Some readable text must render even when summary is missing — the chip
    // should not be visually empty.
    expect(chip.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("does not parse HTML-ish payload — angle brackets render as text", () => {
    render(
      <TaskNotificationChip
        status="completed"
        summary={"<script>alert(1)</script>"}
        taskId="t1"
      />,
    );
    const chip = screen.getByTestId("task-notification-chip");
    expect(chip.querySelector("script")).toBeNull();
    expect(chip.textContent).toContain("<script>");
  });
});
