/*
 * IntentWizard — the GRADE door end-to-end (A08 render + A09b real route wiring).
 *
 * Split out of IntentWizard.test.tsx (which kept the New/Adopt/door-picker
 * suites) so each test file stays ≤300 LOC — the grade door is an independent
 * suite (its own state machine branch + its own /api/wizard/grade mock), so it
 * splits naturally. Covers the ring + dimensions + honest n/a (AC1/AC2) and the
 * A09b real-route render + every honest degraded state (AC5).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
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

/** Mock the real read-only Grade route (A09b) — the flow fetches the report from
 *  POST /api/wizard/grade instead of reading a client stub. */
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

afterEach(() => cleanup());

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

  it("a report missing `reasons` → shape-unrecognised (guarded — never a .map TypeError)", async () => {
    const { reasons: _drop, ...noReasons } = GRADE_REPORT;
    void _drop;
    mockGrade({ status: "report-ready", model: noReasons });
    renderWizard("grade");
    fireEvent.click(screen.getAllByTestId("wizard-repo-chip")[0]);
    expect(await screen.findByTestId("wizard-grade-unrecognised")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-grade-result")).not.toBeInTheDocument();
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
