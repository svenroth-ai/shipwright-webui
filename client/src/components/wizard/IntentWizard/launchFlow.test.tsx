/*
 * IntentWizard New-door end-to-end launch (A09a, FR-01.52 — AC3).
 *
 * Drives the New door through the plan card and clicks "Go", exercising the
 * real `useWizardLaunch` hook against a mocked create/launch server: project
 * create → task create → launch → the `webui:pending-auto-launch` hand-off the
 * embedded terminal consumes. Covers the success path AND the fail-closed path
 * (a rejected launch surfaces the launch-failed screen, no hand-off).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { IntentWizard } from "./IntentWizard";
import { server } from "../../../test/mocks/server";

const READY = {
  ready: true,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [
    { key: "claude", label: "Claude CLI", ok: true, detail: "2.1.9", why: "", critical: true },
    { key: "uv", label: "uv", ok: true, detail: "0.5.11", why: "", critical: true },
    { key: "git", label: "git", ok: true, detail: "2.47", why: "", critical: true },
  ],
};

const TASK = { taskId: "tid-1", sessionUuid: "u-1", projectId: "p1" };
const COMMANDS = { powershell: "p", cmd: "c", posix: "x" };

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IntentWizard initialDoor={null} tickMs={1} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockCreateLaunch(launchOk: boolean) {
  server.use(
    http.get("/api/readiness", () => HttpResponse.json(READY)),
    http.post("/api/projects", () => HttpResponse.json({ data: { id: "p1", path: "C:\\dev\\yoga" } })),
    http.post("/api/external/tasks", () => HttpResponse.json({ task: TASK })),
    http.post("/api/external/tasks/tid-1/launch", () =>
      launchOk
        ? HttpResponse.json({ task: TASK, commands: COMMANDS })
        : HttpResponse.json({ error: "unknown_action_id" }, { status: 400 }),
    ),
  );
}

async function walkToPlanCard() {
  renderWizard();
  await waitFor(() => expect(screen.getByTestId("wizard-door-new")).not.toBeDisabled());
  fireEvent.click(screen.getByTestId("wizard-door-new"));
  fireEvent.click((await screen.findAllByTestId("wizard-brief-chip"))[0]);
  fireEvent.click((await screen.findAllByTestId("wizard-opt-who"))[0]);
  fireEvent.click(screen.getByTestId("wizard-next"));
  fireEvent.click((await screen.findAllByTestId("wizard-opt-remember"))[1]); // No
  fireEvent.click(screen.getByTestId("wizard-next"));
  fireEvent.click((await screen.findAllByTestId("wizard-opt-where"))[0]); // local
  fireEvent.click(screen.getByTestId("wizard-next"));
  await screen.findByTestId("wizard-plan-card");
}

afterEach(() => cleanup());

describe("IntentWizard — New door Go really launches (AC3)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("Go creates the project + task, launches, shows launching, hands off", async () => {
    mockCreateLaunch(true);
    await walkToPlanCard();
    // Edit the derived name (covers the name input) + give the target folder.
    fireEvent.change(screen.getByTestId("wizard-plan-name"), { target: { value: "yoga" } });
    fireEvent.change(screen.getByTestId("wizard-plan-folder"), { target: { value: "C:\\dev\\yoga" } });
    fireEvent.click(screen.getByTestId("wizard-go"));

    expect(await screen.findByTestId("wizard-launching")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.sessionStorage.getItem("webui:pending-auto-launch:tid-1")).toBeTruthy(),
    );
    const parsed = JSON.parse(window.sessionStorage.getItem("webui:pending-auto-launch:tid-1")!);
    expect(parsed.commands.posix).toBe("x");
    expect(parsed.resume).toBe(false);
  });

  it("a rejected launch fails closed → launch-failed screen, no hand-off", async () => {
    mockCreateLaunch(false);
    await walkToPlanCard();
    fireEvent.change(screen.getByTestId("wizard-plan-folder"), { target: { value: "C:\\dev\\yoga" } });
    fireEvent.click(screen.getByTestId("wizard-go"));

    expect(await screen.findByTestId("wizard-launch-failed")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-launch-error")).toHaveTextContent("unknown_action_id");
    expect(window.sessionStorage.getItem("webui:pending-auto-launch:tid-1")).toBeNull();
  });

  it("from launch-failed: Try again re-runs; then Back returns to the plan card", async () => {
    mockCreateLaunch(false);
    await walkToPlanCard();
    fireEvent.change(screen.getByTestId("wizard-plan-folder"), { target: { value: "C:\\dev\\yoga" } });
    fireEvent.click(screen.getByTestId("wizard-go"));
    await screen.findByTestId("wizard-launch-failed");

    // Try again re-runs the SAME request (still rejected → stays failed).
    fireEvent.click(screen.getByTestId("wizard-launch-retry"));
    expect(await screen.findByTestId("wizard-launch-failed")).toBeInTheDocument();

    // Back clears the error and returns to the wizard.
    fireEvent.click(screen.getByTestId("wizard-launch-back"));
    await waitFor(() =>
      expect(screen.queryByTestId("wizard-launch-failed")).not.toBeInTheDocument(),
    );
  });
});
