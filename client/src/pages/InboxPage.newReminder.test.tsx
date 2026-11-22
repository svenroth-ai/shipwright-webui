/**
 * InboxPage - "+ New reminder" (campaign reminders-webui, W3): project picker vs
 * "Creating in", required fields, the add route body, and the tool's own refusal
 * shown unchanged with the form kept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import InboxPage from "./InboxPage";
import { useExternalInbox } from "../hooks/useExternalInbox";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { useProjects } from "../hooks/useProjects";
import { useRemindersDue } from "../hooks/useReminders";
import { makeProject } from "./inbox/__fixtures__/inbox-fixtures";
import { makeDue } from "./inbox/__fixtures__/reminder-fixtures";

vi.mock("../hooks/useExternalInbox", () => ({ useExternalInbox: vi.fn() }));
vi.mock("../hooks/useExternalTasks", () => ({ useExternalTasks: vi.fn() }));
vi.mock("../hooks/useProjects", () => ({ useProjects: vi.fn() }));
// The mail-failure banner is W4's concern; keep it off the wire so the fetch-call assertions below stay exact.
vi.mock("../hooks/useReminderMail", () => ({ useReminderMail: () => ({ data: undefined }) }));
vi.mock("../hooks/useReminders", async (orig) => ({
  ...(await orig<typeof import("../hooks/useReminders")>()),
  useRemindersDue: vi.fn(),
}));

vi.mock("../hooks/useProjectActions", () => ({ useProjectActions: vi.fn(() => ({ data: undefined, isLoading: false, isFetching: false })) }));
vi.mock("../components/external/NewIssueModal", () => ({ NewIssueModal: () => null }));

function wire(projects: ReturnType<typeof makeDue>[]) {
  vi.mocked(useExternalInbox).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useExternalInbox>);
  vi.mocked(useExternalTasks).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useExternalTasks>);
  vi.mocked(useProjects).mockReturnValue({
    data: [makeProject({ id: "p1", name: "Shipwright WebUI" }), makeProject({ id: "p2", name: "Content Marketing" })],
    isLoading: false,
  } as unknown as ReturnType<typeof useProjects>);
  vi.mocked(useRemindersDue).mockReturnValue({
    data: { projects },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useRemindersDue>);
}

function renderPage(url = "/inbox") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <InboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn();

// @covers FR-01.76
// @covers FR-01.76
describe("InboxPage - + New reminder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("with All projects on the board it offers a project picker; with one project it says Creating in", () => {
    wire([makeDue({ projectId: "p1" })]);
    const { unmount } = renderPage("/inbox");
    fireEvent.click(screen.getByTestId("inbox-new-reminder"));
    expect(screen.getByTestId("new-reminder-project")).toBeInTheDocument();
    unmount();
    renderPage("/inbox?projectId=p2");
    fireEvent.click(screen.getByTestId("inbox-new-reminder"));
    expect(screen.queryByTestId("new-reminder-project")).toBeNull();
    expect(screen.getByTestId("project-context-name")).toHaveTextContent("Content Marketing");
  });

  it("needs title, due day and why; sends the fields (decided / open / command / link under More options) to the add route", async () => {
    wire([makeDue({ projectId: "p1" })]);
    renderPage("/inbox?projectId=p1");
    fireEvent.click(screen.getByTestId("inbox-new-reminder"));
    const submit = screen.getByTestId("new-reminder-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-reminder-title"), { target: { value: " Check the relay " } });
    fireEvent.change(screen.getByTestId("new-reminder-due"), { target: { value: "2099-12-03" } });
    fireEvent.change(screen.getByTestId("new-reminder-why"), { target: { value: "New sender rules." } });
    expect(submit).toBeEnabled();
    fireEvent.click(screen.getByTestId("new-issue-more-options-toggle"));
    fireEvent.change(screen.getByTestId("new-reminder-decided"), { target: { value: "Keep the relay." } });
    fireEvent.change(screen.getByTestId("new-reminder-link-label"), { target: { value: "Docs" } });
    fireEvent.change(screen.getByTestId("new-reminder-link-ref"), { target: { value: "https://example.org/d" } });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/reminders/p1/add");
    expect(JSON.parse(init.body)).toEqual({
      title: "Check the relay",
      due: "2099-12-03",
      why: "New sender rules.",
      decided: "Keep the relay.",
      links: [{ label: "Docs", ref: "https://example.org/d" }],
    });
    expect(await screen.findByTestId("inbox-reminder-created")).toHaveTextContent("Reminder created for 2099-12-03.");
  });

  it("shows the tool's refusal unchanged and keeps the form filled (no retry)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "refused", message: "The text looks like it contains a secret." }),
    });
    wire([makeDue({ projectId: "p1" })]);
    renderPage("/inbox?projectId=p1");
    fireEvent.click(screen.getByTestId("inbox-new-reminder"));
    fireEvent.change(screen.getByTestId("new-reminder-title"), { target: { value: "T" } });
    fireEvent.change(screen.getByTestId("new-reminder-due"), { target: { value: "2099-12-03" } });
    fireEvent.change(screen.getByTestId("new-reminder-why"), { target: { value: "password=hunter2" } });
    fireEvent.click(screen.getByTestId("new-reminder-submit"));
    expect(await screen.findByTestId("new-reminder-error")).toHaveTextContent("Not saved. The text looks like it contains a secret.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("new-reminder-why") as HTMLTextAreaElement).value).toBe("password=hunter2");
  });
});
