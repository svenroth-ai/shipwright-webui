// @covers FR-01.30
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TriageDetailMeta } from "./TriageDetailMeta";
import type { TriageItem } from "../../lib/triageApi";

vi.mock("../../hooks/useFileExistence", () => ({ useFileExistence: () => new Set<string>() }));
vi.mock("./TriageAmendForm", () => ({ TriageAmendForm: () => null }));

const item: TriageItem = {
  id: "trg-eeee5555",
  ts: "2026-11-08T08:00:00Z",
  originalTs: "2026-11-08T08:00:00Z",
  source: "compliance",
  severity: "high",
  kind: "maintenance",
  title: "Compliance: 2 open finding(s)",
  detail: "Compliance: 2 open finding(s)\n- B/B7: Orphan FR — detail | hint: fix\n- C/C1: Design manifest — x",
  evidencePath: null,
  runId: null,
  commit: null,
  dedupKey: null,
  status: "triage",
  suggestedPriority: "P1",
  suggestedDomain: "engineering",
  statusBy: null,
  statusReason: null,
  promotedTaskId: null,
  revisitAt: null,
  revisitDue: false,
  amendedBy: null,
  amendedAt: null,
};

function mount(over: Partial<TriageItem> = {}) {
  render(
    <TriageDetailMeta
      projectId="p"
      item={{ ...item, ...over }}
      editMode={false}
      onEditDone={vi.fn()}
      writesRouteToOutbox={undefined}
      writeDisabled={false}
      writeDisabledReason=""
      onOpenFile={vi.fn()}
    />,
  );
}

// @covers FR-01.30
describe("TriageDetailMeta (dialog)", () => {
  it("explains each audit check in words inline (no question-mark icon), and keeps the raw detail folded", () => {
    mount();
    const list = screen.getByTestId("triage-detail-findings");
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.queryByTestId("triage-help-check-B/B7")).toBeNull();
    expect(list).toHaveTextContent("What Fix now does");
    expect(screen.getByTestId("triage-detail-raw")).not.toHaveAttribute("open");
    expect(screen.getByTestId("triage-detail-more")).not.toHaveAttribute("open");
    expect(screen.getByTestId("triage-detail-body")).toHaveTextContent("hint: fix");
  });

  it("keeps the secondary fields in a collapsed Metadata section", () => {
    mount();
    const more = screen.getByTestId("triage-detail-more");
    expect(more.tagName).toBe("DETAILS");
    expect(more).not.toHaveAttribute("open");
    expect(more).toContainElement(screen.getByTestId("triage-detail-complexity"));
  });

  it("shows no findings list for a plain item", () => {
    mount({ source: "manual", detail: "plain text" });
    expect(screen.queryByTestId("triage-detail-findings")).toBeNull();
  });

  it("shows complexity read-only and notes that priority follows severity", () => {
    mount();
    expect(screen.getByTestId("triage-detail-complexity")).toBeInTheDocument();
    expect(screen.getByText(/follows severity/i)).toBeInTheDocument();
  });
});
