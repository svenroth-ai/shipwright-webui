// @covers FR-01.76
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { makeTriageItem } from "./__fixtures__/reminder-fixtures";
import type { ReminderEntry } from "./reminderModel";
import { useReminderActions } from "./useReminderActions";

vi.mock("../../hooks/useProjectActions", () => ({ useProjectActions: () => ({ data: undefined }) }));

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/inbox"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => ({ actions: useReminderActions(), location: useLocation() }), { wrapper });
}

const entryFor = (projectId: string, id: string | null): ReminderEntry => ({
  projectId,
  on: "2026-11-23",
  item: makeTriageItem({ id }),
  key: `triage-${projectId}-${id}`,
});

describe("Open in Triage (parked row)", () => {
  it("opens THAT item in Triage, not just the list", async () => {
    const { result } = setup();
    result.current.actions.ui.openTriage(entryFor("p1", "trg-1a2b3c4d"));
    await vi.waitFor(() => {
      expect(result.current.location.pathname).toBe("/triage");
      expect(result.current.location.search).toBe("?project=p1&item=trg-1a2b3c4d");
    });
  });

  it("an entry without an id falls back to the list", async () => {
    const { result } = setup();
    result.current.actions.ui.openTriage(entryFor("p1", null));
    await vi.waitFor(() => {
      expect(result.current.location.pathname).toBe("/triage");
      expect(result.current.location.search).toBe("");
    });
  });
});
