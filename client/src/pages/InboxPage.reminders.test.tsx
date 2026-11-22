/**
 * InboxPage — reminders and expired parked triage (campaign reminders-webui, W3).
 * Rows + chips, filter chips, header count, Done / Snooze through the W1 routes,
 * Start task = a pre-filled New Task dialog (never the stored command), error
 * states that never read as "nothing due", hostile text as plain text, and the
 * New reminder dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import InboxPage from "./InboxPage";
import { useExternalInbox } from "../hooks/useExternalInbox";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { useProjects } from "../hooks/useProjects";
import { useRemindersDue } from "../hooks/useReminders";
import type { ReminderProjectDue } from "../lib/remindersApi";
import { makeProject } from "./inbox/__fixtures__/inbox-fixtures";
import { makeDue, makeReminderItem, makeTriageItem } from "./inbox/__fixtures__/reminder-fixtures";

vi.mock("../hooks/useExternalInbox", () => ({ useExternalInbox: vi.fn() }));
vi.mock("../hooks/useExternalTasks", () => ({ useExternalTasks: vi.fn() }));
vi.mock("../hooks/useProjects", () => ({ useProjects: vi.fn() }));
vi.mock("../hooks/useReminders", async (orig) => ({
  ...(await orig<typeof import("../hooks/useReminders")>()),
  useRemindersDue: vi.fn(),
}));
vi.mock("../hooks/useProjectActions", () => ({
  useProjectActions: vi.fn((projectId: string | null) => ({
    data: { projectId, actions: [{ id: "new-iterate", label: "New iterate" }] },
    isLoading: false,
    isFetching: false,
  })),
}));
vi.mock("../components/external/NewIssueModal", () => ({
  NewIssueModal: (p: { open: boolean; projectActions?: { projectId?: string }; initialTitle?: string; initialDescription?: string; initialProjectId?: string; action: { id: string } | null }) =>
    p.open ? (
      <div data-testid="stub-new-issue" data-project={p.initialProjectId} data-action={p.action?.id}>
        <span data-testid="stub-catalog">{p.projectActions?.projectId}</span>
        <span data-testid="stub-title">{p.initialTitle}</span>
        <span data-testid="stub-desc">{p.initialDescription}</span>
      </div>
    ) : null,
}));

const mockedInbox = vi.mocked(useExternalInbox);
const mockedTasks = vi.mocked(useExternalTasks);
const mockedProjects = vi.mocked(useProjects);
const mockedDue = vi.mocked(useRemindersDue);

function wire(projects: ReminderProjectDue[], opts: { isError?: boolean } = {}) {
  mockedInbox.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useExternalInbox>);
  mockedTasks.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useExternalTasks>);
  mockedProjects.mockReturnValue({
    data: [makeProject({ id: "p1", name: "Shipwright WebUI" }), makeProject({ id: "p2", name: "Content Marketing" })],
    isLoading: false,
  } as unknown as ReturnType<typeof useProjects>);
  mockedDue.mockReturnValue({
    data: opts.isError ? undefined : { projects },
    isLoading: false,
    isError: Boolean(opts.isError),
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
describe("InboxPage - reminders", () => {
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

  it("shows a green reminder row and a grey parked-triage row in the project card, counted in the header and the filter chips", () => {
    wire([makeDue({ projectId: "p1", items: [makeReminderItem(), makeTriageItem()] })]);
    renderPage();
    expect(screen.getByTestId("inbox-chip-reminder-p1-rem-a41c09")).toHaveTextContent("reminder");
    expect(screen.getByTestId("inbox-chip-triage-p1-trg-1a2b3c4d")).toHaveTextContent("parked triage");
    expect(screen.getByTestId("inbox-row-due-reminder-p1-rem-a41c09")).toHaveTextContent("due today");
    expect(screen.getByTestId("inbox-row-due-triage-p1-trg-1a2b3c4d")).toHaveTextContent("park expired 4d ago");
    expect(screen.getByTestId("inbox-header-count")).toHaveTextContent("(2 open)");
    expect(screen.getByTestId("inbox-filter-reminders")).toHaveTextContent("1 Reminders due");
    expect(screen.getByTestId("inbox-filter-parked")).toHaveTextContent("1 Parked triage");
  });

  it("filters to the parked entries and back", () => {
    wire([makeDue({ projectId: "p1", items: [makeReminderItem(), makeTriageItem()] })]);
    renderPage();
    fireEvent.click(screen.getByTestId("inbox-filter-parked"));
    expect(screen.queryByTestId("inbox-card-reminder-p1-rem-a41c09")).toBeNull();
    expect(screen.getByTestId("inbox-card-triage-p1-trg-1a2b3c4d")).toBeInTheDocument();
  });

  it("a parked-triage row offers only Open in Triage: no Done, no Snooze", () => {
    wire([makeDue({ projectId: "p1", items: [makeTriageItem()] })]);
    renderPage();
    expect(screen.getByTestId("reminder-open-triage-triage-p1-trg-1a2b3c4d")).toBeInTheDocument();
    expect(screen.queryByTestId("reminder-done-triage-p1-trg-1a2b3c4d")).toBeNull();
    expect(screen.queryByTestId("reminder-snooze-triage-p1-trg-1a2b3c4d")).toBeNull();
  });

  it("Done calls the W1 done route for that project and id", async () => {
    wire([makeDue({ projectId: "p1", items: [makeReminderItem()] })]);
    renderPage();
    fireEvent.click(screen.getByTestId("reminder-done-reminder-p1-rem-a41c09"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/reminders/p1/done");
    expect(JSON.parse(init.body)).toEqual({ id: "rem-a41c09" });
    expect(init.method).toBe("POST");
  });

  it("Snooze: picking Next week and confirming calls the snooze route with that day", async () => {
    wire([makeDue({ projectId: "p1", items: [makeReminderItem()] })]);
    renderPage();
    fireEvent.click(screen.getByTestId("reminder-snooze-reminder-p1-rem-a41c09"));
    const panel = await screen.findByTestId("reminder-snooze-popover-reminder-p1-rem-a41c09");
    fireEvent.click(within(panel).getByTestId("reminder-row-reminder-p1-rem-a41c09-snooze-week"));
    const day = (within(panel).getByTestId("reminder-row-reminder-p1-rem-a41c09-snooze-date") as HTMLInputElement).value;
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(within(panel).getByTestId("reminder-row-reminder-p1-rem-a41c09-snooze-go"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/reminders/p1/snooze");
    expect(JSON.parse(init.body)).toEqual({ id: "rem-a41c09", until: day });
  });

  it("a refused Done shows the tool's own message under the row", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "not_found", message: "No such reminder." }) });
    wire([makeDue({ projectId: "p1", items: [makeReminderItem()] })]);
    renderPage();
    fireEvent.click(screen.getByTestId("reminder-done-reminder-p1-rem-a41c09"));
    expect(await screen.findByTestId("inbox-row-error-reminder-p1-rem-a41c09")).toHaveTextContent("No such reminder.");
  });

  it("Start task opens the New Task dialog pre-filled from the reminder; the stored command is never passed on", async () => {
    const command = "/shipwright-iterate rm -rf everything";
    wire([makeDue({ projectId: "p1", items: [makeReminderItem({ command, why: "Because.", open: "Who pays?" })] })]);
    renderPage();
    fireEvent.click(screen.getByTestId("reminder-start-reminder-p1-rem-a41c09"));
    const modal = await screen.findByTestId("stub-new-issue");
    expect(modal).toHaveAttribute("data-project", "p1");
    expect(modal).toHaveAttribute("data-action", "new-iterate");
    expect(screen.getByTestId("stub-title")).toHaveTextContent("Renew the code-signing certificate");
    expect(screen.getByTestId("stub-desc")).toHaveTextContent("Because.");
    expect(screen.getByTestId("stub-desc")).toHaveTextContent("Who pays?");
    expect(modal.textContent).not.toContain("rm -rf");
    // nothing was sent to the server by clicking Start task
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Start task in a second project uses THAT project's catalog, not the previous one", async () => {
    wire([
      makeDue({ projectId: "p1", items: [makeReminderItem({ command: "x" })] }),
      makeDue({ projectId: "p2", items: [makeReminderItem({ id: "rem-b", command: "y" })] }),
    ]);
    renderPage();
    fireEvent.click(screen.getByTestId("reminder-start-reminder-p1-rem-a41c09"));
    expect(await screen.findByTestId("stub-catalog")).toHaveTextContent("p1");
    fireEvent.click(screen.getByTestId("reminder-start-reminder-p2-rem-b"));
    await waitFor(() => expect(screen.getByTestId("stub-catalog")).toHaveTextContent("p2"));
    expect(screen.getByTestId("stub-new-issue")).toHaveAttribute("data-project", "p2");
  });

  it("a busy reminder file says so (try again), not 'could not be started'", () => {
    wire([{ projectId: "p1", state: "store-busy" } as ReminderProjectDue]);
    renderPage();
    const b = screen.getByTestId("inbox-reminders-unavailable");
    expect(b).toHaveTextContent("busy right now");
    expect(b).not.toHaveTextContent("could not be started");
    expect(screen.queryByText(/Your inbox is clear/i)).toBeNull();
  });

  it("a reminder without a command has no Start task", () => {
    wire([makeDue({ projectId: "p1", items: [makeReminderItem()] })]);
    renderPage();
    expect(screen.queryByTestId("reminder-start-reminder-p1-rem-a41c09")).toBeNull();
  });

  it("renders hostile text as plain text in the row and the dialog: no script or bold element appears", () => {
    const title = "<b>bold</b> <script>alert(1)</script> in title";
    wire([
      makeDue({
        projectId: "p1",
        items: [makeReminderItem({ title, why: "<img src=x onerror=alert(1)>", open: "<script>alert(2)</script>", command: "<script>c()</script>" })],
      }),
    ]);
    const { container } = renderPage();
    expect(screen.getByTestId("inbox-row-title-reminder-p1-rem-a41c09")).toHaveTextContent(title);
    fireEvent.click(screen.getByTestId("inbox-row-title-reminder-p1-rem-a41c09"));
    const dialog = screen.getByTestId("inbox-detail-reminder-p1-rem-a41c09");
    expect(dialog).toHaveTextContent("<script>alert(2)</script>");
    expect(dialog).toHaveTextContent("<img src=x onerror=alert(1)>");
    for (const root of [container, document.body]) {
      expect(root.querySelector("script")).toBeNull();
      expect(root.querySelector("img[onerror]")).toBeNull();
      expect(root.querySelector("b")?.textContent ?? "").not.toBe("bold");
    }
  });

  it("the detail dialog leaves empty fields out and keeps file links as plain text, only http(s) as a link", () => {
    wire([
      makeDue({
        projectId: "p1",
        items: [
          makeReminderItem({
            decided: "Renew.",
            links: [
              { label: "Order page", kind: "url", ref: "https://example.org/order" },
              { label: "Notes", kind: "file", ref: "C:/secret/notes.md" },
            ],
          }),
        ],
      }),
    ]);
    renderPage();
    fireEvent.click(screen.getByTestId("inbox-row-title-reminder-p1-rem-a41c09"));
    const dialog = screen.getByTestId("inbox-detail-reminder-p1-rem-a41c09");
    expect(within(dialog).queryByTestId("reminder-open-reminder-p1-rem-a41c09")).toBeNull();
    expect(within(dialog).queryByTestId("reminder-command-reminder-p1-rem-a41c09")).toBeNull();
    const links = within(dialog).getByTestId("reminder-links-reminder-p1-rem-a41c09");
    expect(links.querySelectorAll("a")).toHaveLength(1);
    expect(links.querySelector("a")).toHaveAttribute("href", "https://example.org/order");
    expect(links).toHaveTextContent("C:/secret/notes.md");
  });

  it("when the reminder tool is unavailable: a red banner with Try again, never the 'inbox is clear' message", () => {
    wire([{ projectId: "p1", state: "unsupported-version", contractVersion: "2" } as ReminderProjectDue]);
    renderPage();
    expect(screen.getByTestId("inbox-reminders-unavailable")).toHaveTextContent("Reminders are unavailable.");
    expect(screen.getByTestId("inbox-reminders-unavailable")).toHaveTextContent("Shipwright WebUI");
    expect(screen.queryByTestId("inbox-empty")).toBeNull();
    expect(screen.getByTestId("inbox-reminders-unavailable-retry")).toBeInTheDocument();
  });

  it("when the request itself failed it is the same unavailable banner", () => {
    wire([], { isError: true });
    renderPage();
    expect(screen.getByTestId("inbox-reminders-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-empty")).toBeNull();
  });

  it("triageError: an orange banner next to the reminders that were read", () => {
    wire([makeDue({ projectId: "p1", state: "degraded", triageError: "triage.jsonl: unreadable at line 12", items: [makeReminderItem()] })]);
    renderPage();
    expect(screen.getByTestId("inbox-reminders-triage-error")).toHaveTextContent("could not be checked");
    expect(screen.getByTestId("inbox-reminders-triage-error")).toHaveTextContent("triage.jsonl: unreadable at line 12");
    expect(screen.getByTestId("inbox-card-reminder-p1-rem-a41c09")).toBeInTheDocument();
  });

  it("damaged lines: a banner and a pill with the count, only above 0", () => {
    wire([makeDue({ projectId: "p1", state: "degraded", reminderCorruptLines: 2, items: [makeReminderItem()] })]);
    renderPage();
    expect(screen.getByTestId("inbox-reminders-damaged")).toHaveTextContent("2 lines in the reminder file are damaged");
    expect(screen.getByTestId("inbox-filter-damaged")).toHaveTextContent("2 damaged reminder lines");
  });

  it("no damaged-line notice when the count is 0, and nothing due is the honest empty state", () => {
    wire([makeDue({ projectId: "p1" })]);
    renderPage();
    expect(screen.queryByTestId("inbox-reminders-damaged")).toBeNull();
    expect(screen.getByTestId("inbox-empty")).toBeInTheDocument();
  });
});
