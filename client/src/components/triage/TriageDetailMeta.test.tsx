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

describe("TriageDetailMeta (dialog)", () => {
  it("lists each audit check on its own line with a help marker, and keeps the raw detail", () => {
    mount();
    const list = screen.getByTestId("triage-detail-findings");
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByTestId("triage-help-check-B/B7")).toBeInTheDocument();
    expect(screen.getByTestId("triage-detail-body")).toHaveTextContent("hint: fix");
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
