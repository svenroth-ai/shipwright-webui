/*
 * IntentWizard end-to-end (A08, AC1/AC2/AC3/AC4/AC5).
 *
 * Drives EACH of the three doors forward and asserts the flight-plan
 * translations, the four dimensions (incl. the honest n/a), and both result
 * cards. Also asserts the readiness gate makes the doors inert when the
 * environment is not ready. This suite is RED on pre-A08 main (the component
 * does not exist) and green after.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { IntentWizard } from "./IntentWizard";
import { server } from "../../../test/mocks/server";
import { GRADE_REPORT } from "./stubData";
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

/** Mock the real read-only Grade route (A09b) — the flow now fetches the report
 *  from POST /api/wizard/grade instead of reading a client stub. */
function mockGrade(outcome: Record<string, unknown>) {
  server.use(http.post("/api/wizard/grade", () => HttpResponse.json(outcome)));
}

const READY_GRADE = { status: "report-ready", model: GRADE_REPORT };

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

  it("renders the three canonical First-Contact doors + the add-existing line", async () => {
    renderWizard();
    await doorsReady();
    expect(screen.getByTestId("wizard-door-new")).toHaveTextContent("Build something new");
    expect(screen.getByTestId("wizard-door-adopt")).toHaveTextContent("Bring Shipwright to an existing repo");
    expect(screen.getByTestId("wizard-door-grade")).toHaveTextContent("Grade your repo");
    expect(screen.getByTestId("wizard-add-existing")).toHaveTextContent("Add the existing project");
  });

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

  it("a probe error is treated as NOT ready — never assume success", async () => {
    server.use(http.get("/api/readiness", () => HttpResponse.error()));
    renderWizard();
    await screen.findByTestId("readiness-not-ready");
    expect(screen.getByTestId("wizard-door-grade")).toBeDisabled();
  });
});

describe("IntentWizard — NEW door walks to the plan card (AC1)", () => {
  beforeEach(() => mockReadiness(READY));

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

describe("IntentWizard — GRADE door: ring, four dimensions, honest n/a (AC1/AC2)", () => {
  beforeEach(() => {
    mockReadiness(READY);
    mockGrade(READY_GRADE); // the real route returns the plugin's ReportModel
  });

  it("pick → grade → the underivable dimension renders n/a with NO numeric score", async () => {
    renderWizard("grade");
    expect(await screen.findByTestId("wizard-pick-grade")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[2]); // a github url
    const result = await screen.findByTestId("wizard-grade-result");

    expect(within(result).getByTestId("wizard-grade-ring")).toBeInTheDocument();
    // Four dimensions.
    expect(within(result).getByTestId("grade-dim-requirement_traceability")).toBeInTheDocument();
    expect(within(result).getByTestId("grade-dim-test_health")).toBeInTheDocument();
    expect(within(result).getByTestId("grade-dim-security")).toBeInTheDocument();
    expect(within(result).getByTestId("grade-dim-change_traceability")).toBeInTheDocument();

    // THE honest n/a: requirement traceability is n/a — dashed bar, literal "n/a",
    // and NO number anywhere in the value.
    const naValue = within(result).getByTestId("grade-value-requirement_traceability");
    expect(naValue).toHaveTextContent("n/a");
    expect(naValue.textContent ?? "").not.toMatch(/\d/);
    expect(within(result).getByTestId("grade-bar-na-requirement_traceability")).toBeInTheDocument();
    // A measurable dimension still shows a real number.
    expect(within(result).getByTestId("grade-value-test_health")).toHaveTextContent("71/100");

    // Ceiling note is present ABOVE the dimensions (DOM order), network receipt for a remote.
    const ceiling = within(result).getByTestId("wizard-grade-ceiling");
    const dims = within(result).getByTestId("wizard-grade-dimensions");
    expect(ceiling).toHaveTextContent("finding about the record");
    expect(ceiling.compareDocumentPosition(dims) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(result).getByTestId("wizard-grade-network")).toHaveTextContent("What left your machine");
  });

  it("would_light_up badges ONLY the dimensions that would light up — not the ones already scoring", async () => {
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[2]);
    const result = await screen.findByTestId("wizard-grade-result");
    // n/a trace + gap dims light up; the already-ok Security does NOT (dilution guard).
    expect(within(result).getByTestId("grade-lightup-requirement_traceability")).toBeInTheDocument();
    expect(within(result).getByTestId("grade-lightup-test_health")).toBeInTheDocument();
    expect(within(result).getByTestId("grade-lightup-change_traceability")).toBeInTheDocument();
    expect(within(result).queryByTestId("grade-lightup-security")).not.toBeInTheDocument();
  });

  it("each dimension can show its work — provenance is a per-row disclosure", async () => {
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[2]);
    const result = await screen.findByTestId("wizard-grade-result");
    // Collapsed by default; the "why?" toggle reveals the structured provenance.
    expect(within(result).queryByTestId("grade-provenance-test_health")).not.toBeInTheDocument();
    fireEvent.click(within(result).getByTestId("grade-why-test_health"));
    expect(within(result).getByTestId("grade-provenance-test_health")).toHaveTextContent(
      "package.json scripts",
    );
  });

  it("Grade → “Adopt this repo →” converts to the adopt result WITHOUT re-asking the folder (AC4)", async () => {
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[2]);
    await screen.findByTestId("wizard-grade-result");

    fireEvent.click(screen.getByTestId("wizard-grade-to-adopt"));
    // Re-scans, lands on the adopt result — no RepoPicker in between.
    expect(await screen.findByTestId("wizard-adopt-result")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-pick-adopt")).not.toBeInTheDocument();
  });
});

describe("IntentWizard — GRADE door renders REAL route output + honest states (A09b, AC5)", () => {
  beforeEach(() => mockReadiness(READY));

  it("renders ONLY what the route returned — a null-score dimension stays n/a (no client fill)", async () => {
    mockGrade(READY_GRADE);
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[2]);
    const result = await screen.findByTestId("wizard-grade-result");
    // n/a dimension: literal "n/a", NO digit — the client never estimates it.
    const naValue = within(result).getByTestId("grade-value-requirement_traceability");
    expect(naValue).toHaveTextContent("n/a");
    expect(naValue.textContent ?? "").not.toMatch(/\d/);
    // A real 0..1 dimension score is scaled to the 0..100 idiom (0.71 → 71/100).
    expect(within(result).getByTestId("grade-value-test_health")).toHaveTextContent("71/100");
  });

  it("a target grade.py couldn't grade → an honest 'couldn't grade' card, never a fake grade", async () => {
    mockGrade({ status: "grade-failed", reason: "path does not exist: C:/x" });
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[0]);
    const failed = await screen.findByTestId("wizard-grade-failed");
    expect(failed).toHaveTextContent(/couldn.t grade/i);
    expect(failed).toHaveTextContent("path does not exist");
    // No fabricated grade card.
    expect(screen.queryByTestId("wizard-grade-result")).not.toBeInTheDocument();
  });

  it("engine not installed → 'grade engine unavailable' with the repair command", async () => {
    mockGrade({
      status: "engine-unavailable",
      reason: "The grade engine isn't installed.",
      repairCommand: "npx @svenroth-ai/shipwright@latest",
    });
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[0]);
    const unavail = await screen.findByTestId("wizard-grade-engine-unavailable");
    expect(unavail).toHaveTextContent(/engine unavailable/i);
    expect(unavail).toHaveTextContent("npx @svenroth-ai/shipwright@latest");
  });

  it("a malformed report shape → 'report shape not recognised', not a half-empty card", async () => {
    // report-ready but the model fails the cross-repo shape guard (missing fields).
    mockGrade({ status: "report-ready", model: { schema_version: "1.0", grade: "A" } });
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[0]);
    expect(await screen.findByTestId("wizard-grade-unrecognised")).toHaveTextContent(/shape not recognised/i);
  });

  it("a synthesized score for an n/a dimension is REJECTED at the client guard (AC5)", async () => {
    const poisoned = structuredClone(GRADE_REPORT) as unknown as {
      dimensions: Array<{ status: string; score: number | null }>;
    };
    poisoned.dimensions.find((d) => d.status === "n/a")!.score = 0.5; // a fabricated value
    mockGrade({ status: "report-ready", model: poisoned });
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[0]);
    // The guard refuses it → honest "shape not recognised", never a fake bar.
    expect(await screen.findByTestId("wizard-grade-unrecognised")).toBeInTheDocument();
  });
});

describe("IntentWizard — deep links (AC4)", () => {
  beforeEach(() => mockReadiness(READY));

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
