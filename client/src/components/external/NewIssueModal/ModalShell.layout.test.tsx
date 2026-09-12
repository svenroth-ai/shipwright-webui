/*
 * ModalShell layout fence — split out of ModalShell.test.tsx to keep that
 * file under its bloat-baseline ceiling (shipwright_bloat_baseline.json,
 * limit 300 / current 305 at the time of this split — this file carries no
 * entry and stays well under it).
 *
 * iterate-2026-09-12-mobile-triage-form-layout: CI fence for the flex
 * restructure that replaced the fragile `calc(100vh-280px)` chrome budget
 * (see ModalShell.tsx). jsdom cannot render real flex layout, so this pins
 * presence of every link in the height-allocation chain — not just the two
 * ends, but the `<form>` and wrapper `min-h-0 flex-1` middle links, whose
 * silent deletion would revert the body to unbounded while every other CI
 * gate (tsc, oxlint, the rest of vitest) stayed green (code-review finding,
 * medium). The behavioral proof (Launch button stays on-screen at 375×667)
 * lives in e2e/flows/mobile-triage-form-layout.spec.ts.
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ModalShell } from "./ModalShell";
import { PALETTE } from "./palette";
import type { ActionDefinition } from "../../../lib/externalApi";

const TASK_ACTION: ActionDefinition = {
  id: "new-task",
  label: "New task",
  kind: "external_launch",
  command_template: "claude /shipwright-{task.phase}",
};

afterEach(() => {
  cleanup();
});

describe("ModalShell layout (height-allocation chain)", () => {
  // @covers FR-01.38
  it("dialog is a height-capped flex column with shrink-0 header/footer and a flex-fill body", () => {
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
    const dialog = screen.getByTestId("new-issue-modal-new-task");
    expect(dialog).toHaveClass("flex", "flex-col", "max-h-[80dvh]");
    // Position is unchanged by the restructure (Internal Plan Review
    // finding #2 — a centering swap would have silently moved every
    // ModalShell consumer on desktop too).
    expect(dialog).toHaveClass("top-[10%]");

    const header = screen.getByTestId("new-issue-header-icon").parentElement;
    expect(header).toHaveClass("shrink-0");

    // The two middle links: without these, `max-h-full` on the body below
    // resolves against an auto-height ancestor (i.e. `none`) and silently
    // stops capping anything, even though the fence on the ends still passes.
    const form = screen.getByTestId("new-issue-modal-form");
    expect(form).toHaveClass("min-h-0", "flex-1", "flex-col");
    const bodySlot = screen.getByTestId("new-issue-modal-body-slot");
    // `flex flex-col` here is load-bearing, not decorative: a plain block
    // flex-item does not extend its own definite flexed height to a
    // percentage-sized descendant (ModalScrollBody's `max-h-full`) — only a
    // flex/grid container does. Found via real-browser E2E testing after
    // this fence alone (checking only min-h-0/flex-1) stayed green on a
    // build where the body silently ignored its height cap.
    expect(bodySlot).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");

    const body = screen.getByTestId("new-issue-modal-body");
    expect(body).toHaveClass("max-h-full");

    const footer = screen.getByTestId("new-issue-footer-hint").parentElement;
    expect(footer).toHaveClass("shrink-0");
  });
});
