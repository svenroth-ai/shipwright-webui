/*
 * IntentWizard end-to-end — the door picker + NEW + ADOPT doors (A08,
 * AC1/AC3/AC4). The GRADE door has its own suite in `IntentWizard.grade.test.tsx`
 * (split in A09b so each file stays ≤300 LOC). Also asserts the readiness gate
 * makes the doors inert when the environment is not ready. RED on pre-A08 main
 * (the component does not exist) and green after.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { IntentWizard } from "./IntentWizard";
import { server } from "../../../test/mocks/server";
import type { WizardDoor } from "./types";

const READY = {
  ready: true,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [
    { key: "claude", label: "Claude CLI", ok: true, detail: "2.1.9", why: "", critical: true },
    { key: "plugins", label: "Shipwright plugins", ok: true, detail: "8 installed", why: "", critical: true },
    { key: "cache", label: "Plugin cache", ok: true, detail: "shared/ present", why: "", critical: true },
    { key: "uv", label: "uv", ok: true, detail: "0.5.11", why: "", critical: true },
    { key: "python", label: "Python", ok: true, detail: "3.13 (python3)", why: "", critical: true },
    { key: "git", label: "git", ok: true, detail: "2.47", why: "", critical: true },
  ],
};

function mockReadiness(report: Record<string, unknown>) {
  server.use(http.get("/api/readiness", () => HttpResponse.json(report)));
}

function renderWizard(initialDoor: WizardDoor | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IntentWizard initialDoor={initialDoor} tickMs={1} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function doorsReady() {
  await waitFor(() => expect(screen.getByTestId("wizard-door-new")).not.toBeDisabled());
}

afterEach(() => cleanup());

describe("IntentWizard — door picker + readiness gate", () => {
  beforeEach(() => mockReadiness(READY));

  // @covers FR-01.52
  it("renders the three canonical First-Contact doors + the add-existing line", async () => {
    renderWizard();
    await doorsReady();
    expect(screen.getByTestId("wizard-door-new")).toHaveTextContent("Build something new");
    expect(screen.getByTestId("wizard-door-adopt")).toHaveTextContent("Bring Shipwright to an existing repo");
    expect(screen.getByTestId("wizard-door-grade")).toHaveTextContent("Grade your repo");
    expect(screen.getByTestId("wizard-add-existing")).toHaveTextContent("Add the existing project");
  });

  // @covers FR-01.52
  it("when NOT ready the doors are inert and the gate names what's missing + the repair command", async () => {
    mockReadiness({
      ready: false,
      repairCommand: "npx @svenroth-ai/shipwright@latest",
      checks: [
        { key: "claude", label: "Claude CLI", ok: true, detail: "2.1.9", why: "", critical: true },
        { key: "uv", label: "uv", ok: false, detail: "not found", why: "every plugin hook runs through it", critical: true },
      ],
    });
    renderWizard();
    await screen.findByTestId("readiness-not-ready");
    // The door is a real disabled button, not merely dimmed.
    expect(screen.getByTestId("wizard-door-new")).toBeDisabled();
    expect(screen.getByTestId("wizard-door-adopt")).toBeDisabled();
    expect(screen.getByTestId("readiness-missing-uv")).toHaveTextContent("uv");
    expect(screen.getByTestId("readiness-missing-uv")).toHaveTextContent("every plugin hook runs through it");
    expect(screen.getByTestId("readiness-repair-command")).toHaveTextContent(
      "npx @svenroth-ai/shipwright@latest",
    );
  });

  // @covers FR-01.52
  it("a probe error is treated as NOT ready — never assume success", async () => {
    server.use(http.get("/api/readiness", () => HttpResponse.error()));
    renderWizard();
    await screen.findByTestId("readiness-not-ready");
    expect(screen.getByTestId("wizard-door-grade")).toBeDisabled();
  });
});

describe("IntentWizard — NEW door walks to the plan card (AC1)", () => {
  beforeEach(() => mockReadiness(READY));

  // @covers FR-01.52
  it("4 questions → plan card, with live flight-plan translations", async () => {
    renderWizard();
    await doorsReady();

    // Before the door is picked, the unanswered fields are dim spine NODES.
    expect(screen.getByTestId("fp-node-Users")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("wizard-door-new"));
    expect(await screen.findByTestId("wizard-question-brief")).toBeInTheDocument();

    // Chip picks the brief and advances to "who".
    fireEvent.click(screen.getAllByTestId("wizard-brief-chip")[0]);
    expect(await screen.findByTestId("wizard-question-who")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("wizard-opt-who")[1]); // "My team"
    // The rail now translates the answer.
    expect(screen.getByTestId("fp-row-Users")).toHaveTextContent("Because you said “My team”");

    fireEvent.click(screen.getByTestId("wizard-next"));
    expect(await screen.findByTestId("wizard-question-remember")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("wizard-opt-remember")[1]); // "No"
    fireEvent.click(screen.getByTestId("wizard-next"));

    expect(await screen.findByTestId("wizard-question-where")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("wizard-opt-where")[1]); // "On the web"
    expect(screen.getByTestId("wizard-next")).toHaveTextContent("See the plan");
    fireEvent.click(screen.getByTestId("wizard-next"));

    // Plan card — 7 phases + a NOT-yet-live Go.
    expect(await screen.findByTestId("wizard-plan-card")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-phase-Project")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-phase-Deploy")).toHaveTextContent("I ship it to the web");
    expect(screen.getByTestId("wizard-go")).toBeDisabled();
  });
});

describe("IntentWizard — ADOPT door walks to the result card (AC1)", () => {
  beforeEach(() => mockReadiness(READY));

  // @covers FR-01.52
  it("pick → scan → two-column result + mission CTA", async () => {
    renderWizard("adopt");
    // Deep-link lands INSIDE the flow at step 1 (AC4), not the picker.
    expect(await screen.findByTestId("wizard-pick-adopt")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[0]);
    // Working screen is real (AC — the middle step exists).
    expect(await screen.findByTestId("wizard-working")).toBeInTheDocument();

    const result = await screen.findByTestId("wizard-adopt-result");
    expect(within(result).getByTestId("wizard-adopt-found")).toHaveTextContent("Vite · Hono");
    expect(within(result).getByTestId("wizard-adopt-writes")).toHaveTextContent("CLAUDE.md");
    expect(within(result).getByTestId("wizard-adopt-start")).toHaveTextContent("Adopt this repo");
    // Stub is tagged, not presented as live (AC3).
    expect(within(result).getByTestId("wizard-adopt-stub-note")).toHaveTextContent("not a live read");
  });
});

describe("IntentWizard — deep links (AC4)", () => {
  beforeEach(() => mockReadiness(READY));

  // @covers FR-01.52
  it("/wizard (picker), /wizard/adopt, /wizard/grade land on the right entry", async () => {
    const { unmount } = renderWizard(null);
    await doorsReady();
    expect(screen.getByTestId("wizard-door-picker")).toBeInTheDocument();
    unmount();

    renderWizard("adopt");
    expect(await screen.findByTestId("wizard-pick-adopt")).toBeInTheDocument();
    cleanup();

    renderWizard("grade");
    expect(await screen.findByTestId("wizard-pick-grade")).toBeInTheDocument();
  });
});
