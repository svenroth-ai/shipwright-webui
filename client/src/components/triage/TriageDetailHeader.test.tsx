// @covers FR-01.30
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as Dialog from "@radix-ui/react-dialog";

import { TriageDetailHeader } from "./TriageDetailHeader";
import type { TriageItem } from "../../lib/triageApi";

const item: TriageItem = {
  id: "trg-aaaa1111",
  ts: "2026-05-14T10:00:00Z",
  originalTs: "2026-05-14T10:00:00Z",
  source: "phaseQuality",
  severity: "high",
  kind: "bug",
  title: "A finding",
  detail: "d",
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

function renderHeader(props: Partial<Parameters<typeof TriageDetailHeader>[0]> = {}) {
  const utils = render(
    <Dialog.Root open>
      <Dialog.Content>
        <TriageDetailHeader item={item} projectId="p1" editMode={false} {...props} />
      </Dialog.Content>
    </Dialog.Root>,
  );
  return utils;
}

describe("TriageDetailHeader", () => {
  it("has no Edit control any more — Edit lives in the action row at the bottom", () => {
    renderHeader();
    expect(screen.queryByTestId("triage-edit-toggle")).toBeNull();
  });

  it("shows the same pills as the card: source label, severity, no severity help", () => {
    renderHeader();
    expect(screen.getByTestId("triage-source-phaseQuality")).toHaveTextContent("Phase quality");
    expect(screen.getByTestId("triage-help-source-phaseQuality")).toBeTruthy();
    expect(screen.queryByTestId("triage-help-severity-high")).toBeNull();
  });

  it("shows the project pill only when a label is given", () => {
    renderHeader({ projectLabel: "alpha" });
    expect(screen.getByTestId("triage-item-trg-aaaa1111-project")).toHaveTextContent("alpha");
  });

  it("shows no provenance subtitle when never amended", () => {
    renderHeader();
    expect(screen.queryByTestId("triage-amend-provenance")).toBeNull();
  });

  it("shows the provenance subtitle when amendedBy is set", () => {
    renderHeader({ item: { ...item, amendedBy: "sven", amendedAt: "2026-08-08T10:00:00Z" } });
    expect(screen.getByTestId("triage-amend-provenance")).toHaveTextContent("sven");
  });

  it("external-review regression: hides the visible title text and the severity badge while editing (TriageAmendForm shows editable equivalents)", () => {
    renderHeader({ editMode: true });
    // Dialog.Title still renders (Radix a11y requirement) but visually hidden.
    expect(screen.getByText("A finding")).toHaveClass("sr-only");
    expect(screen.queryByTestId("triage-severity-high")).toBeNull();
  });

  it("shows the title and severity badge normally when not editing", () => {
    renderHeader({ editMode: false });
    expect(screen.getByText("A finding")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("triage-severity-high")).toBeTruthy();
  });
});
