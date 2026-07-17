/*
 * ScopedIteratePromptbox (A16) — brief → plan card → one Go through the EXISTING
 * create+launch path; Cancel creates nothing; unknown plan fields render "—";
 * the action id comes from the manifest, never a hardcoded slash-command.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ScopedIteratePromptbox } from "./ScopedIteratePromptbox";
import type { Project } from "../../types";
import type { ResolvedProjectActions } from "../../lib/externalApi";

const actionsMock = vi.fn<() => { data: ResolvedProjectActions | undefined }>();
vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: () => actionsMock(),
}));

const createTaskMock = vi.fn();
const launchMock = vi.fn();
vi.mock("../../lib/externalApi", async (orig) => {
  const actual = await orig<typeof import("../../lib/externalApi")>();
  return {
    ...actual,
    createTask: (...args: unknown[]) => createTaskMock(...args),
    launchExternalTask: (...args: unknown[]) => launchMock(...args),
  };
});

const PROJECT: Project = {
  id: "p1",
  name: "Atlas",
  path: "/tmp/atlas",
  profile: "custom",
  status: "active",
  lastActive: "2026-07-14T00:00:00Z",
  createdAt: "2026-07-14T00:00:00Z",
};

const ACTIONS: ResolvedProjectActions = {
  actions: [
    { id: "new-iterate", label: "New iterate", kind: "external_launch", command_template: "{cd.prefix}claude ..." },
  ],
  phases: [],
  defaults: { autonomy: "guided" },
  preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
  diagnostics: [],
};

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname}</div>;
}

function renderBox() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/projects/p1/log"]}>
        <Routes>
          <Route path="/projects/p1/log" element={<ScopedIteratePromptbox project={PROJECT} />} />
          <Route path="/tasks/:taskId" element={<Loc />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  actionsMock.mockReset();
  actionsMock.mockReturnValue({ data: ACTIONS });
  createTaskMock.mockReset();
  launchMock.mockReset();
  createTaskMock.mockResolvedValue({ taskId: "task-77", sessionUuid: "s", projectId: "p1" });
  launchMock.mockResolvedValue({ task: { taskId: "task-77" }, commands: { copy: "claude ..." } });
});

describe("ScopedIteratePromptbox", () => {
  // @covers FR-01.60
  it("auto-focuses the input on load", () => {
    renderBox();
    expect(screen.getByTestId("shipslog-promptbox-input")).toBe(document.activeElement);
  });

  // @covers FR-01.60
  it("brief → Plan it opens a plan card whose unknown fields render '—'", async () => {
    renderBox();
    await userEvent.type(screen.getByTestId("shipslog-promptbox-input"), "add rate-limit headers");
    await userEvent.click(screen.getByTestId("shipslog-promptbox-plan"));
    const card = await screen.findByTestId("shipslog-plan-card");
    // Every unfillable plan field is a dash — never a plausible guess.
    expect(within(card).getByTestId("shipslog-plan-complexity").textContent).toBe("—");
    expect(within(card).getByTestId("shipslog-plan-affected-frs").textContent).toBe("—");
    expect(within(card).getByTestId("shipslog-plan-risk-flags").textContent).toBe("—");
    expect(within(card).getByTestId("shipslog-plan-est-tests").textContent).toBe("—");
  });

  // @covers FR-01.60
  it("Go creates + launches ONCE through the existing path, then navigates to Mission", async () => {
    renderBox();
    await userEvent.type(screen.getByTestId("shipslog-promptbox-input"), "add rate-limit headers");
    await userEvent.click(screen.getByTestId("shipslog-promptbox-plan"));
    await userEvent.click(await screen.findByTestId("shipslog-plan-go"));

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock.mock.calls[0][0]).toMatchObject({
      projectId: "p1",
      cwd: "/tmp/atlas",
      actionId: "new-iterate", // from the manifest, not a hardcoded slash-command
      description: "add rate-limit headers",
    });
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("loc")).toHaveTextContent("/tasks/task-77");
  });

  // @covers FR-01.60
  it("Cancel closes the plan card and creates NOTHING", async () => {
    renderBox();
    await userEvent.type(screen.getByTestId("shipslog-promptbox-input"), "add rate-limit headers");
    await userEvent.click(screen.getByTestId("shipslog-promptbox-plan"));
    await userEvent.click(await screen.findByTestId("shipslog-plan-cancel"));
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  // @covers FR-01.60
  it("disables Go when the project has no iterate action (never hardcodes one)", async () => {
    actionsMock.mockReturnValue({ data: { ...ACTIONS, actions: [] } });
    renderBox();
    await userEvent.type(screen.getByTestId("shipslog-promptbox-input"), "add headers");
    await userEvent.click(screen.getByTestId("shipslog-promptbox-plan"));
    expect(await screen.findByTestId("shipslog-plan-go")).toBeDisabled();
    expect(screen.getByTestId("shipslog-plan-noaction")).toBeInTheDocument();
  });
});
