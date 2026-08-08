import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TriageAmendForm } from "./TriageAmendForm";
import type { TriageItem } from "../../lib/triageApi";

const { amendMutateAsyncSpy } = vi.hoisted(() => ({
  amendMutateAsyncSpy: vi.fn(),
}));
vi.mock("../../hooks/useTriage", () => ({
  useAmendTriageItem: () => ({ mutateAsync: amendMutateAsyncSpy, isPending: false }),
}));

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const item: TriageItem = {
  id: "trg-aaaa1111",
  ts: "2026-05-14T10:00:00Z",
  originalTs: "2026-05-14T10:00:00Z",
  source: "phaseQuality",
  severity: "high",
  kind: "bug",
  title: "Original title",
  detail: "Original detail",
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

function renderForm(props: Partial<Parameters<typeof TriageAmendForm>[0]> = {}) {
  const Wrapper = makeWrapper();
  const onCancel = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <Wrapper>
      <TriageAmendForm
        projectId="proj-a"
        item={item}
        writesRouteToOutbox={undefined}
        onCancel={onCancel}
        onSaved={onSaved}
        {...props}
      />
    </Wrapper>,
  );
  return { ...utils, onCancel, onSaved };
}

describe("TriageAmendForm", () => {
  beforeEach(() => {
    amendMutateAsyncSpy.mockReset();
  });

  it("pre-fills title/detail/severity from the item", () => {
    renderForm();
    expect(screen.getByTestId("triage-amend-title")).toHaveValue("Original title");
    expect(screen.getByTestId("triage-amend-detail")).toHaveValue("Original detail");
    expect(screen.getByTestId("triage-amend-severity")).toHaveValue("high");
  });

  it("Cancel invokes onCancel without submitting anything", () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByTestId("triage-amend-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(amendMutateAsyncSpy).not.toHaveBeenCalled();
  });

  it("Save with only title changed sends a title-only delta", async () => {
    amendMutateAsyncSpy.mockResolvedValue({ ok: true });
    const { onSaved } = renderForm();
    fireEvent.change(screen.getByTestId("triage-amend-title"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByTestId("triage-amend-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(amendMutateAsyncSpy).toHaveBeenCalledWith({
      triageId: "trg-aaaa1111",
      title: "New title",
    });
  });

  it("Save with title + detail + severity all changed sends all three", async () => {
    amendMutateAsyncSpy.mockResolvedValue({ ok: true });
    renderForm();
    fireEvent.change(screen.getByTestId("triage-amend-title"), {
      target: { value: "New title" },
    });
    fireEvent.change(screen.getByTestId("triage-amend-detail"), {
      target: { value: "New detail" },
    });
    fireEvent.change(screen.getByTestId("triage-amend-severity"), {
      target: { value: "critical" },
    });
    fireEvent.click(screen.getByTestId("triage-amend-save"));
    await waitFor(() =>
      expect(amendMutateAsyncSpy).toHaveBeenCalledWith({
        triageId: "trg-aaaa1111",
        title: "New title",
        detail: "New detail",
        severity: "critical",
      }),
    );
  });

  it("Save with nothing changed behaves like Cancel (no network call)", () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByTestId("triage-amend-save"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(amendMutateAsyncSpy).not.toHaveBeenCalled();
  });

  it("shows an inline error and stays open when the server rejects the amend", async () => {
    amendMutateAsyncSpy.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "triage_item_not_in_triage_state", message: "Item is dismissed." },
    });
    const { onSaved } = renderForm();
    fireEvent.change(screen.getByTestId("triage-amend-title"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByTestId("triage-amend-save"));
    await waitFor(() =>
      expect(screen.getByTestId("triage-amend-error")).toHaveTextContent("Item is dismissed."),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("external-review regression: a rejected mutation (network failure) shows an inline error instead of an unhandled rejection", async () => {
    amendMutateAsyncSpy.mockRejectedValue(new Error("fetch failed"));
    const { onSaved } = renderForm();
    fireEvent.change(screen.getByTestId("triage-amend-title"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByTestId("triage-amend-save"));
    await waitFor(() =>
      expect(screen.getByTestId("triage-amend-error")).toHaveTextContent(
        "could not reach the server",
      ),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("disables Save when the title is blank", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("triage-amend-title"), { target: { value: "   " } });
    expect(screen.getByTestId("triage-amend-save")).toBeDisabled();
  });

  it("AC9: shows the tracked-store disclosure when writesRouteToOutbox is false", () => {
    renderForm({ writesRouteToOutbox: false });
    expect(screen.getByTestId("triage-amend-tracked-disclosure")).toBeTruthy();
  });

  it("AC9: shows the tracked-store disclosure when writesRouteToOutbox is unknown (undefined)", () => {
    renderForm({ writesRouteToOutbox: undefined });
    expect(screen.getByTestId("triage-amend-tracked-disclosure")).toBeTruthy();
  });

  it("AC9: shows no disclosure when writesRouteToOutbox is explicitly true", () => {
    renderForm({ writesRouteToOutbox: true });
    expect(screen.queryByTestId("triage-amend-tracked-disclosure")).toBeNull();
  });

  it("external-review regression: an untouched title with incidental stored whitespace is not sent as changed", async () => {
    // buildDelta used to compare a .trim()'d local value against the
    // UN-trimmed stored title (title.trim() !== item.title) — if the stored
    // title itself carried incidental leading/trailing whitespace, that
    // false-positived "changed" even though the operator never touched the
    // field. The fix compares raw local state against the raw stored value
    // (title !== item.title) and trims only the value actually sent.
    amendMutateAsyncSpy.mockResolvedValue({ ok: true });
    const itemWithWhitespace = { ...item, title: "Original title " };
    const { onSaved } = renderForm({ item: itemWithWhitespace });
    fireEvent.change(screen.getByTestId("triage-amend-detail"), {
      target: { value: "New detail" },
    });
    fireEvent.click(screen.getByTestId("triage-amend-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(amendMutateAsyncSpy).toHaveBeenCalledWith({
      triageId: "trg-aaaa1111",
      detail: "New detail",
    });
  });

  it("doubt-review regression: an untouched field is NOT reverted when the live item prop changes underneath the open form (useTriageDisplayItem's poll)", async () => {
    // The form's local fields are seeded once at mount. If a background poll
    // (TriageDetailModal's useTriageDisplayItem) refreshes the `item` prop to
    // a concurrent edit elsewhere while this form stays open, the delta must
    // diff against the MOUNT-time snapshot (`initialItem`), never the live
    // prop — otherwise an operator who only edits the title silently reverts
    // whichever field changed underneath them back to the stale value they
    // never touched.
    amendMutateAsyncSpy.mockResolvedValue({ ok: true });
    const Wrapper = makeWrapper();
    const onCancel = vi.fn();
    const onSaved = vi.fn();
    const { rerender } = render(
      <Wrapper>
        <TriageAmendForm
          projectId="proj-a"
          item={item}
          writesRouteToOutbox={undefined}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      </Wrapper>,
    );

    // A concurrent amend elsewhere changes severity high -> critical; the
    // live poll refreshes the prop this form receives, WITHOUT the operator
    // touching the severity field in this still-open form.
    rerender(
      <Wrapper>
        <TriageAmendForm
          projectId="proj-a"
          item={{ ...item, severity: "critical" }}
          writesRouteToOutbox={undefined}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      </Wrapper>,
    );

    fireEvent.change(screen.getByTestId("triage-amend-title"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByTestId("triage-amend-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(amendMutateAsyncSpy).toHaveBeenCalledWith({
      triageId: "trg-aaaa1111",
      title: "New title",
    });
  });
});
