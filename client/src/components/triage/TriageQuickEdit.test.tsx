import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TriageQuickEdit } from "./TriageQuickEdit";
import { TriageSnoozeMenu } from "./TriageSnoozeMenu";
import { entry } from "../../test/triageFixtures";

const h = vi.hoisted(() => ({
  amend: vi.fn(),
  snooze: vi.fn(),
  write: { available: true as boolean, reason: undefined as string | undefined },
}));
vi.mock("../../hooks/useTriage", () => ({
  useAmendTriageItem: () => ({ mutateAsync: h.amend, isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: h.snooze, isPending: false }),
  useTriageDrift: () => ({ data: { write: h.write } }),
}));

const item = entry("p1", { id: "trg-q1", title: "Old title", severity: "high" }).item;

beforeEach(() => {
  h.amend.mockReset();
  h.snooze.mockReset();
  h.write.available = true;
  h.write.reason = undefined;
});

// @covers FR-01.30
describe("TriageQuickEdit", () => {
  const open = () => {
    render(<TriageQuickEdit projectId="p1" item={item} />);
    fireEvent.click(screen.getByTestId("triage-quick-edit-trigger-trg-q1"));
  };

  it("sends only the changed fields", async () => {
    h.amend.mockResolvedValue({ ok: true });
    open();
    fireEvent.change(screen.getByTestId("triage-quick-edit-title"), { target: { value: " New " } });
    fireEvent.change(screen.getByTestId("triage-quick-edit-severity"), { target: { value: "low" } });
    fireEvent.click(screen.getByTestId("triage-quick-edit-save"));
    await waitFor(() =>
      expect(h.amend).toHaveBeenCalledWith({ triageId: "trg-q1", title: "New", severity: "low" }),
    );
  });

  it("closes without a request when nothing changed", () => {
    open();
    fireEvent.click(screen.getByTestId("triage-quick-edit-save"));
    expect(h.amend).not.toHaveBeenCalled();
  });

  it("shows the server message on a failed save", async () => {
    h.amend.mockResolvedValue({ ok: false, status: 400, body: { message: "Nope" } });
    open();
    fireEvent.change(screen.getByTestId("triage-quick-edit-title"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("triage-quick-edit-save"));
    expect((await screen.findByTestId("triage-quick-edit-error")).textContent).toBe("Nope");
  });

  it("shows a network error when the request throws", async () => {
    h.amend.mockRejectedValue(new Error("down"));
    open();
    fireEvent.change(screen.getByTestId("triage-quick-edit-title"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("triage-quick-edit-save"));
    expect((await screen.findByTestId("triage-quick-edit-error")).textContent).toContain("could not reach");
  });

  it("disables Save and says why when writing is unavailable", () => {
    h.write.available = false;
    h.write.reason = "Read-only checkout";
    open();
    expect((screen.getByTestId("triage-quick-edit-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("triage-quick-edit-unavailable").textContent).toContain("Read-only checkout");
  });
});

// @covers FR-01.30
describe("TriageSnoozeMenu", () => {
  const open = (onSnoozed?: () => void) => {
    render(
      <TriageSnoozeMenu projectId="p1" itemId="trg-q1" reason=" r " buttonClassName="x" onSnoozed={onSnoozed} />,
    );
    fireEvent.click(screen.getByTestId("triage-snooze-menu-trg-q1"));
  };

  it("a preset snoozes with a date and the trimmed reason", async () => {
    h.snooze.mockResolvedValue({ ok: true });
    const done = vi.fn();
    open(done);
    fireEvent.click(await screen.findByTestId("triage-snooze-week"));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const arg = h.snooze.mock.calls[0][0];
    expect(arg.triageId).toBe("trg-q1");
    expect(arg.reason).toBe("r");
    expect(arg.revisitAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("No date snoozes without a revisit date", async () => {
    h.snooze.mockResolvedValue({ ok: true });
    open();
    fireEvent.click(await screen.findByTestId("triage-snooze-nodate"));
    await waitFor(() => expect(h.snooze).toHaveBeenCalled());
    expect(h.snooze.mock.calls[0][0].revisitAt).toBeUndefined();
  });

  it("the date button stays off until a valid date is picked, then snoozes", async () => {
    h.snooze.mockResolvedValue({ ok: true });
    open();
    const go = (await screen.findByTestId("triage-snooze-date-go")) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("triage-snooze-date"), { target: { value: "2099-01-01" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(h.snooze.mock.calls[0][0].revisitAt).toBe("2099-01-01"));
  });

  it("shows the server message and keeps the menu open on a rejected snooze", async () => {
    h.snooze.mockResolvedValue({ ok: false, status: 400, body: { message: "Date too soon" } });
    open();
    fireEvent.click(await screen.findByTestId("triage-snooze-tomorrow"));
    expect((await screen.findByTestId("triage-snooze-error")).textContent).toBe("Date too soon");
  });

  it("snooze shows a network error when the request throws", async () => {
    h.snooze.mockRejectedValue(new Error("down"));
    open();
    fireEvent.click(await screen.findByTestId("triage-snooze-month"));
    expect((await screen.findByTestId("triage-snooze-error")).textContent).toContain("could not reach");
  });
});
