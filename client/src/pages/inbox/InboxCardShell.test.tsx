/**
 * InboxCardShell — pressing Enter/Space on a control INSIDE the card (a button,
 * a markdown link) must never also open the task: the card only reacts to keys
 * pressed on the card itself.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { InboxCardShell } from "./InboxCardShell";
import { makeTask } from "./__fixtures__/inbox-fixtures";

// @covers FR-01.04
describe("InboxCardShell keyboard", () => {
  function setup() {
    const task = makeTask({ taskId: "task-A", sessionUuid: "sess-A" });
    render(
      <MemoryRouter>
        <InboxCardShell testId="card" itemKey="k" sessionUuid="sess-A" task={task}>
          <a href="#x" data-testid="nested-link">link</a>
        </InboxCardShell>
      </MemoryRouter>,
    );
    return screen.getByTestId("card");
  }

  it("does not swallow Enter pressed on a nested link", () => {
    setup();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    screen.getByTestId("nested-link").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("still handles Enter pressed on the card itself", () => {
    const card = setup();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    card.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
