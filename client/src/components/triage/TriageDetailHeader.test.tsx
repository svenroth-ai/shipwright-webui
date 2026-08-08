import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  const onEdit = vi.fn();
  const utils = render(
    <Dialog.Root open>
      <Dialog.Content>
        <TriageDetailHeader item={item} editMode={false} onEdit={onEdit} {...props} />
      </Dialog.Content>
    </Dialog.Root>,
  );
  return { ...utils, onEdit };
}

describe("TriageDetailHeader", () => {
  it("shows the pencil Edit toggle for a triage-status item not being edited", () => {
    renderHeader();
    expect(screen.getByTestId("triage-edit-toggle")).toBeTruthy();
  });

  it("hides the pencil for a non-triage status", () => {
    renderHeader({ item: { ...item, status: "dismissed" } });
    expect(screen.queryByTestId("triage-edit-toggle")).toBeNull();
  });

  it("hides the pencil while already in edit mode", () => {
    renderHeader({ editMode: true });
    expect(screen.queryByTestId("triage-edit-toggle")).toBeNull();
  });

  it("clicking the pencil invokes onEdit", () => {
    const { onEdit } = renderHeader();
    fireEvent.click(screen.getByTestId("triage-edit-toggle"));
    expect(onEdit).toHaveBeenCalledTimes(1);
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
