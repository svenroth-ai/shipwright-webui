/*
 * ModalShell focused tests: header, footer, ESC + close button, error bar.
 *
 * Radix Dialog handles ESC + backdrop close internally. We assert the
 * close button fires onOpenChange(false) — the rest of the dialog
 * close pathway is Radix-tested.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { ModalShell } from "./ModalShell";
import { PALETTE } from "./palette";
import type { ActionDefinition } from "../../../lib/externalApi";

const TASK_ACTION: ActionDefinition = {
  id: "new-task",
  label: "New task",
  kind: "external_launch",
  command_template: "claude /shipwright-{task.phase}",
};

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("ModalShell", () => {
  // @covers FR-01.38
  it("renders the header icon + title + subtitle + close button", () => {
    render(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={() => {}}
      >
        <div data-testid="body-marker">body</div>
      </ModalShell>,
    );
    expect(screen.getByTestId("new-issue-modal-new-task")).toBeTruthy();
    expect(screen.getByTestId("new-issue-header-icon")).toBeTruthy();
    expect(screen.getByTestId("new-issue-modal-close")).toBeTruthy();
    expect(screen.getByText("New Task")).toBeTruthy();
    expect(screen.getByTestId("body-marker")).toBeTruthy();
  });

  // @covers FR-01.38
  it("close button fires onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <ModalShell
        open
        onOpenChange={onOpenChange}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={() => {}}
      >
        <div />
      </ModalShell>,
    );
    fireEvent.click(screen.getByTestId("new-issue-modal-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // @covers FR-01.38
  it("footer hint is exactly 'Esc to cancel'", () => {
    render(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={() => {}}
      >
        <div />
      </ModalShell>,
    );
    const hint = screen.getByTestId("new-issue-footer-hint");
    expect(hint.textContent?.replace(/\s+/g, " ").trim()).toBe("Esc to cancel");
  });

  // @covers FR-01.38
  it("Save + Launch buttons disabled when canSubmit=false", () => {
    render(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={false}
        submitting={false}
        error={null}
        onSubmit={() => {}}
      >
        <div />
      </ModalShell>,
    );
    expect(
      (screen.getByTestId("new-issue-save-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("new-issue-launch-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  // @covers FR-01.38
  it("error string renders inside the error bar; otherwise hidden", () => {
    const { rerender } = render(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={() => {}}
      >
        <div />
      </ModalShell>,
    );
    expect(screen.queryByTestId("new-issue-error")).toBeNull();
    rerender(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error="Something broke"
        onSubmit={() => {}}
      >
        <div />
      </ModalShell>,
    );
    expect(screen.getByTestId("new-issue-error").textContent).toBe(
      "Something broke",
    );
  });

  /*
   * iterate-2026-07-14-more-options-flex-clip — CI fence.
   *
   * jsdom has no layout engine, so it CANNOT catch the actual bug (a flex
   * item with `overflow-hidden` losing its automatic minimum size, being
   * squeezed below its content and clipping it). The behavioral proof lives
   * in e2e/flows/triage-fix-now-more-options-clip.spec.ts — but Playwright
   * is NOT a CI gate in this repo (CI gates tsc + lint + vitest +
   * diff-coverage), so without this test the fix could be deleted by a
   * refactor or a class-sorter and every gating check would stay green.
   *
   * Class presence is not a layout assertion — it is a fence. Precedent:
   * ProjectContextStrip.test.tsx does the same for its layout-critical
   * classes. See ModalShell.tsx for why the class is load-bearing.
   */
  // @covers FR-01.38
  it("modal body pins [&>*]:shrink-0 so an overflow-hidden child cannot be squeezed + clipped", () => {
    render(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={() => {}}
      >
        <div />
      </ModalShell>,
    );
    const body = screen.getByTestId("new-issue-modal-body");
    // The scroll container is what creates the negative free space...
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("max-h-[calc(100vh-280px)]");
    // ...and this is the rule that stops its children absorbing it.
    expect(body.className).toContain("[&>*]:shrink-0");
  });

  // @covers FR-01.38
  it("Launch button is type=submit (form triggers onSubmit(launch))", () => {
    const onSubmit = vi.fn();
    render(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={onSubmit}
      >
        <div />
      </ModalShell>,
    );
    const form = screen.getByTestId("new-issue-modal-form");
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
    // Last arg is "launch" per ModalShell wiring.
    expect(onSubmit.mock.calls[0][1]).toBe("launch");
  });

  // @covers FR-01.38
  it("Escape key fires onOpenChange(false) via Radix Dialog (Step 3.7 OpenAI #5)", () => {
    const onOpenChange = vi.fn();
    render(
      <ModalShell
        open
        onOpenChange={onOpenChange}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={() => {}}
      >
        <div />
      </ModalShell>,
    );
    // Radix listens for Escape on the document; fire on the modal content.
    const dialog = screen.getByTestId("new-issue-modal-new-task");
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // @covers FR-01.38
  it("Save button triggers onSubmit(save)", () => {
    const onSubmit = vi.fn();
    render(
      <ModalShell
        open
        onOpenChange={() => {}}
        mode="new-task"
        action={TASK_ACTION}
        palette={PALETTE["new-task"]}
        canSubmit={true}
        submitting={false}
        error={null}
        onSubmit={onSubmit}
      >
        <div />
      </ModalShell>,
    );
    fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][1]).toBe("save");
  });
});
