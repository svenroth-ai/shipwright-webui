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
    amendedBy: null,
    amendedAt: null,
    ...overrides,
  };
}

describe("DeferredTriageSection", () => {
  it("renders nothing when there are no deferred items and nothing is hidden (AC6)", () => {
    const { container } = render(<DeferredTriageSection items={[]} hiddenCount={0} onClick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a bare count in the heading when nothing is hidden", () => {
    render(<DeferredTriageSection items={[item({ id: "trg-a" })]} hiddenCount={0} onClick={vi.fn()} />);
    expect(screen.getByTestId("triage-deferred-section")).toHaveTextContent("Deferred (1)");
  });

  it("shows the revisit date when set", () => {
    render(
      <DeferredTriageSection
        items={[item({ id: "trg-a", revisitAt: "2099-06-01" })]}
        hiddenCount={0}
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
      <DeferredTriageSection
        items={[item({ id: "trg-a", revisitAt: null })]}
        hiddenCount={0}
        onClick={vi.fn()}
      />,
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
    render(<DeferredTriageSection items={[item({ id: "trg-a" })]} hiddenCount={0} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("triage-deferred-item-trg-a"));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: "trg-a" }));
  });

  describe("hiddenCount hint (AC7, iterate-2026-08-08-triage-filters-sort-parked)", () => {
    it("shows no hint when nothing is hidden", () => {
      render(<DeferredTriageSection items={[item({ id: "trg-a" })]} hiddenCount={0} onClick={vi.fn()} />);
      expect(screen.queryByTestId("triage-deferred-hidden-count")).not.toBeInTheDocument();
    });

    it("shows the hint with the hidden count", () => {
      render(<DeferredTriageSection items={[item({ id: "trg-a" })]} hiddenCount={3} onClick={vi.fn()} />);
      expect(screen.getByTestId("triage-deferred-hidden-count")).toHaveTextContent(
        "3 parked items hidden by the current view.",
      );
    });

    it("renders the section (heading absent, hint present) when EVERY parked item is hidden — items.length === 0", () => {
      render(<DeferredTriageSection items={[]} hiddenCount={4} onClick={vi.fn()} />);
      expect(screen.getByTestId("triage-deferred-section")).toBeInTheDocument();
      // Count-form convention (spec-reviewer Stage 1 finding): the heading
      // must carry its own denominator whenever visible !== total, never a
      // bare number next to an ambiguous hidden-count line.
      expect(screen.getByTestId("triage-deferred-section")).toHaveTextContent("Deferred (0 of 4)");
      expect(screen.getByTestId("triage-deferred-hidden-count")).toHaveTextContent(
        "4 parked items hidden by the current view.",
      );
    });

    it("shows the hint even when some parked items ARE visible — the mixed dateless+dated case (plan-review fix)", () => {
      render(
        <DeferredTriageSection
          items={[item({ id: "trg-dateless", revisitAt: null })]}
          hiddenCount={2}
          onClick={vi.fn()}
        />,
      );
      expect(screen.getByTestId("triage-deferred-item-trg-dateless")).toBeInTheDocument();
      // 1 visible of 3 total (1 shown + 2 hidden) — the exact ambiguity the
      // count-form convention exists to prevent (a bare "Deferred (1)" next
      // to "2 ... hidden" reads as if 1 were the whole population).
      expect(screen.getByTestId("triage-deferred-section")).toHaveTextContent("Deferred (1 of 3)");
      expect(screen.getByTestId("triage-deferred-hidden-count")).toHaveTextContent(
        "2 parked items hidden by the current view.",
      );
    });

    it("uses singular phrasing for exactly one hidden item", () => {
      render(<DeferredTriageSection items={[]} hiddenCount={1} onClick={vi.fn()} />);
      expect(screen.getByTestId("triage-deferred-hidden-count")).toHaveTextContent(
        "1 parked item hidden by the current view.",
      );
    });
  });
});
