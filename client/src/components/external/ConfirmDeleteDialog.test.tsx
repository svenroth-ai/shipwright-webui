import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import type { ExternalTask } from "../../lib/externalApi";

// Minimal stub — the dialog only reads task.title / task.state for copy.
const TASK = {
  taskId: "t1",
  title: "demo",
  state: "active",
} as unknown as ExternalTask;

describe("ConfirmDeleteDialog", () => {
  it("clamps width to the viewport (max-w-[95vw]) so the modal fits narrow screens", () => {
    // iterate-2026-06-14-tablet-responsive-view AC-5 (defensive; the clamp bites
    // below ~463px → primarily an iterate-2/phone safeguard).
    render(
      <ConfirmDeleteDialog
        open
        task={TASK}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );
    const content = document.querySelector('[role="dialog"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("max-w-[95vw]");
  });
});
