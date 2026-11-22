import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { MainLayout } from "./MainLayout";
import { useExternalInbox } from "../hooks/useExternalInbox";
import { useRemindersDue } from "../hooks/useReminders";
import { makeDue, makeReminderItem, makeTriageItem } from "../pages/inbox/__fixtures__/reminder-fixtures";

vi.mock("../hooks/useExternalInbox", () => ({ useExternalInbox: vi.fn() }));
vi.mock("../hooks/useReminders", async (orig) => ({
  ...(await orig<typeof import("../hooks/useReminders")>()),
  useRemindersDue: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal(
    "EventSource",
    vi.fn().mockImplementation(() => ({ close: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

function renderLayout() {
  const router = createMemoryRouter(
    [{ path: "/", element: <MainLayout />, children: [{ index: true, element: <div>Page Content</div> }] }],
    { initialEntries: ["/"] },
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// @covers FR-01.76
describe("MainLayout - the Inbox count is the reminder alert", () => {
  it("counts due reminders and expired parked triage next to the waiting entries", () => {
    vi.mocked(useExternalInbox).mockReturnValue({ data: [{ kind: "ask_tool" }] } as unknown as ReturnType<typeof useExternalInbox>);
    vi.mocked(useRemindersDue).mockReturnValue({
      data: {
        projects: [
          makeDue({ projectId: "a", items: [makeReminderItem(), makeTriageItem()] }),
          makeDue({ projectId: "b", items: [makeReminderItem({ id: "rem-2" })] }),
        ],
      },
    } as unknown as ReturnType<typeof useRemindersDue>);
    renderLayout();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("an unreadable project adds nothing to the number (the Inbox page names the problem)", () => {
    vi.mocked(useExternalInbox).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useExternalInbox>);
    vi.mocked(useRemindersDue).mockReturnValue({
      data: { projects: [{ projectId: "a", state: "engine-unavailable", reason: "no uv" }] },
    } as unknown as ReturnType<typeof useRemindersDue>);
    renderLayout();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("1")).toBeNull();
  });
});
