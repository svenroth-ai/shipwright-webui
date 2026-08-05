import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeferredTriageSection } from "./DeferredTriageSection";
import type { TriageItem } from "../../lib/triageApi";

function item(overrides: Partial<TriageItem> & Pick<TriageItem, "id">): TriageItem {
  return {
    ts: "2026-06-01T08:00:00Z",
    originalTs: "2026-06-01T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: "A parked finding",
    detail: "d",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "snoozed",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    ...overrides,
  };
}

describe("DeferredTriageSection", () => {
  it("renders nothing when there are no deferred items (AC6)", () => {
    const { container } = render(<DeferredTriageSection items={[]} onClick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the section heading with a count", () => {
    render(<DeferredTriageSection items={[item({ id: "trg-a" })]} onClick={vi.fn()} />);
    expect(screen.getByTestId("triage-deferred-section")).toHaveTextContent("Deferred (1)");
  });

  it("shows the revisit date when set", () => {
    render(
      <DeferredTriageSection
        items={[item({ id: "trg-a", revisitAt: "2099-06-01" })]}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("triage-deferred-item-trg-a-revisit")).toHaveTextContent(
      "Returns on 2099-06-01",
    );
    expect(screen.getByTestId("triage-deferred-item-trg-a-state")).toHaveTextContent("Parked");
  });

  it("shows 'No revisit date set' and the not-due label for a parked-without-date item", () => {
    render(
      <DeferredTriageSection items={[item({ id: "trg-a", revisitAt: null })]} onClick={vi.fn()} />,
    );
    expect(screen.getByTestId("triage-deferred-item-trg-a-revisit")).toHaveTextContent(
      "No revisit date set",
    );
    expect(screen.getByTestId("triage-deferred-item-trg-a-state")).toHaveTextContent(
      "Parked — not due",
    );
  });

  it("invokes onClick with the item when its card is clicked", () => {
    const onClick = vi.fn();
    render(<DeferredTriageSection items={[item({ id: "trg-a" })]} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("triage-deferred-item-trg-a"));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: "trg-a" }));
  });
});
