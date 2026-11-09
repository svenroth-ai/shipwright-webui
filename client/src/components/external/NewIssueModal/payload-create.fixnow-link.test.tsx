/*
 * iterate-2026-11-09-triage-fixnow-task — the create body carries the triage
 * item a Fix-now task is started from, and omits the key otherwise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

import { makeFetchMock, renderModal } from "./__testFixtures";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function saveWith(props: Record<string, unknown>) {
  const cap: { body?: string } = {};
  globalThis.fetch = makeFetchMock({ captureCreate: cap }) as unknown as typeof fetch;
  const onOpenChange = vi.fn();
  renderModal({ onOpenChange, onToast: () => {}, ...props });
  await act(async () => {
    fireEvent.change(screen.getByTestId("new-issue-title-input"), { target: { value: "Fix it" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("new-issue-save-btn"));
  });
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  return JSON.parse(cap.body!) as Record<string, unknown>;
}

// @covers FR-01.30
describe("createTask POST body — Fix-now triage link", () => {
  it("sends fixNowForTriageId when the modal was opened from a triage item", async () => {
    const parsed = await saveWith({ fixNowForTriageId: "trg-0a1b2c3d", initialProjectId: "proj-1" });
    expect(parsed.fixNowForTriageId).toBe("trg-0a1b2c3d");
  });

  it("omits the key when the task is not tied to the item's own project", async () => {
    const parsed = await saveWith({ fixNowForTriageId: "trg-0a1b2c3d" });
    expect("fixNowForTriageId" in parsed).toBe(false);
  });

  it("omits the key for an ordinary task", async () => {
    const parsed = await saveWith({});
    expect("fixNowForTriageId" in parsed).toBe(false);
  });
});
