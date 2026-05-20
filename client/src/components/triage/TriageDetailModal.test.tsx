/*
 * TriageDetailModal.test.tsx — dialog-shell regression guard for the
 * "match the Project Creation wizard" restyle
 * (iterate-20260515-triage-card-styling).
 *
 * Pins the Radix Dialog content to the same design tokens ProjectWizard
 * uses: white `--color-surface`, `--radius-card`, `--shadow-card`.
 *
 * iterate-2026-05-20-triage-launch-surface-webui ADDED Fix-now CTA
 * tests: button visibility gate, copy-on-click, transient confirmation,
 * clipboard-failure UX, timer cleanup on unmount.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TriageDetailModal } from "./TriageDetailModal";
import type { TriageItem } from "../../lib/triageApi";

vi.mock("../../hooks/useTriage", () => ({
  useDismissTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Hoisted spy so the mock factory has access without ESM cycle issues
// (see CLAUDE.md "module-level const reads process.env" learning —
// same hoist rule applies here for clipboard mocking).
const { copyTextSpy } = vi.hoisted(() => ({ copyTextSpy: vi.fn() }));
vi.mock("../../lib/clipboard", () => ({
  copyText: copyTextSpy,
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
  id: "trg-cccc3333",
  ts: "2026-05-14T10:00:00Z",
  originalTs: "2026-05-14T10:00:00Z",
  source: "phaseQuality",
  severity: "high",
  kind: "bug",
  title: "C1 missing phase_completed event",
  detail: "Detail body",
  evidencePath: null,
  runId: null,
  commit: null,
  dedupKey: "phaseQuality:C1",
  status: "triage",
  suggestedPriority: "P1",
  suggestedDomain: "engineering",
  statusBy: null,
  statusReason: null,
  promotedTaskId: null,
};

describe("TriageDetailModal styling", () => {
  it("dialog surface matches the Project Creation wizard tokens", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={item}
        />
      </Wrapper>,
    );
    const content = screen.getByTestId("triage-detail-modal");
    expect(content).toHaveClass("bg-[var(--color-surface)]");
    expect(content).toHaveClass("rounded-[var(--radius-card)]");
    expect(content).toHaveClass("shadow-[var(--shadow-card)]");
  });
});

describe("TriageDetailModal — Fix-now CTA (iterate-2026-05-20)", () => {
  beforeEach(() => {
    copyTextSpy.mockReset();
    copyTextSpy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderModal(props: Partial<TriageItem> = {}) {
    const Wrapper = makeWrapper();
    return render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={{ ...item, ...props }}
        />
      </Wrapper>,
    );
  }

  it("does NOT render the Fix-now button when the item has no launchPayload", () => {
    renderModal({ launchPayload: null });
    expect(screen.queryByTestId("triage-fix-now")).toBeNull();
  });

  it("does NOT render the Fix-now button on a github item with empty payload (placeholder branch)", () => {
    renderModal({ source: "github", launchPayload: null });
    // Block shows the loud-fail placeholder, but no Fix-now button:
    // there is nothing to copy.
    expect(screen.queryByTestId("triage-fix-now")).toBeNull();
    expect(screen.getByTestId("triage-launch-payload-placeholder")).toBeTruthy();
  });

  it("renders the Fix-now button when a renderable payload exists", () => {
    renderModal({
      source: "github",
      launchPayload: "/iterate fix code-scan",
    });
    expect(screen.getByTestId("triage-fix-now")).toBeTruthy();
  });

  it("copies the cleaned payload to the clipboard (not the raw bytes) on click", async () => {
    // Raw payload contains ESC + DEL — both must be stripped before
    // reaching the clipboard. The rendered <pre> shows the cleaned
    // string; the clipboard must hold the SAME cleaned string.
    const raw = "good\x1b[31mred\x7fpart";
    const cleaned = "good[31mredpart";
    renderModal({ source: "phaseQuality", launchPayload: raw });

    fireEvent.click(screen.getByTestId("triage-fix-now"));
    // copyText is async; wait a microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(copyTextSpy).toHaveBeenCalledTimes(1);
    expect(copyTextSpy).toHaveBeenCalledWith(cleaned);
    // The <pre> renders the SAME cleaned string.
    expect(
      screen.getByTestId("triage-launch-payload-content").textContent,
    ).toBe(cleaned);
  });

  it("shows the transient confirmation for ~3 s, then clears it", async () => {
    vi.useFakeTimers();
    renderModal({ source: "phaseQuality", launchPayload: "/iterate something" });

    await act(async () => {
      fireEvent.click(screen.getByTestId("triage-fix-now"));
      await Promise.resolve();
    });

    // External review MED #5: the test must prove the banner is
    // visible BEFORE the timeout, not only that it's gone after.
    // Otherwise an implementation that clears the confirmation
    // immediately would still pass the post-advance assertion.
    expect(screen.getByTestId("triage-fix-now-confirmation")).toBeTruthy();

    // Just before the 3 s mark it is still visible.
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByTestId("triage-fix-now-confirmation")).toBeTruthy();

    // After crossing 3 s it disappears.
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("triage-fix-now-confirmation")).toBeNull();
  });

  it("resets the fix-now status when the displayed item changes (MED #4)", async () => {
    vi.useFakeTimers();
    const Wrapper = makeWrapper();
    const itemA: TriageItem = {
      ...item,
      id: "trg-aaaaaaaa",
      source: "phaseQuality",
      launchPayload: "/iterate first item",
    };
    const itemB: TriageItem = {
      ...item,
      id: "trg-bbbbbbbb",
      source: "phaseQuality",
      launchPayload: "/iterate second item",
    };

    const { rerender } = render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={itemA}
        />
      </Wrapper>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("triage-fix-now"));
      await Promise.resolve();
    });
    expect(screen.getByTestId("triage-fix-now-confirmation")).toBeTruthy();

    // Re-render with the second item BEFORE the 3 s window closes.
    // Without the fix the stale "Copied" banner would persist on the
    // newly displayed item.
    rerender(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={itemB}
        />
      </Wrapper>,
    );

    expect(screen.queryByTestId("triage-fix-now-confirmation")).toBeNull();
  });

  it("shows an inline failure line if copyText rejects (clipboard MED #7)", async () => {
    copyTextSpy.mockRejectedValueOnce(new Error("permission denied"));
    renderModal({ source: "phaseQuality", launchPayload: "/iterate something" });

    fireEvent.click(screen.getByTestId("triage-fix-now"));

    const fail = await waitFor(() => screen.getByTestId("triage-fix-now-failure"));
    expect(fail.textContent).toContain("Copy failed");
    expect(fail.textContent).toContain("permission denied");
    // No confirmation shown.
    expect(screen.queryByTestId("triage-fix-now-confirmation")).toBeNull();
  });

  it("does not throw if the modal unmounts before the confirmation timer fires (LOW #8)", async () => {
    vi.useFakeTimers();
    const Wrapper = makeWrapper();
    const { unmount } = render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={{ ...item, source: "phaseQuality", launchPayload: "/foo" }}
        />
      </Wrapper>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("triage-fix-now"));
      await Promise.resolve();
    });
    unmount();
    // Advance the timer AFTER unmount — there should be no setState
    // call on a missing component. We assert by not throwing.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});
