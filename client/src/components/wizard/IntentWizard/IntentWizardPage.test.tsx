/*
 * IntentWizardPage — the route host that maps the deep-link segment to the entry
 * door (doorFromParam) and hands it to <IntentWizard> (A08, AC4). These tests
 * drive the REAL router (/wizard, /wizard/new, /wizard/adopt, /wizard/grade) so
 * the whole URL→door→landed-screen chain is exercised, not just initialDoor.
 *
 * The "new" case is the iterate-2026-08-24 fix: /wizard/new must land on the
 * first question, never re-open the door picker.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import IntentWizardPage from "./IntentWizardPage";
import { server } from "../../../test/mocks/server";

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

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/wizard" element={<IntentWizardPage />} />
          <Route path="/wizard/:door" element={<IntentWizardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("IntentWizardPage — deep-link segment → entry door (AC4)", () => {
  beforeEach(() => server.use(http.get("/api/readiness", () => HttpResponse.json(READY))));

  // @covers FR-01.51 — bare /wizard is the door picker.
  it("/wizard renders the door picker", async () => {
    renderAt("/wizard");
    await waitFor(() => expect(screen.getByTestId("wizard-door-new")).not.toBeDisabled());
    expect(screen.getByTestId("wizard-door-picker")).toBeInTheDocument();
  });

  // @covers FR-01.51 — /wizard/new lands on the first question, NOT the picker
  // (iterate-2026-08-24: the reported "Build something new → picker" defect).
  it("/wizard/new lands on the first question, not the picker", async () => {
    renderAt("/wizard/new");
    expect(await screen.findByTestId("wizard-question-brief")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-door-picker")).toBeNull();
  });

  // @covers FR-01.51
  it("/wizard/adopt lands inside the adopt flow at step 1", async () => {
    renderAt("/wizard/adopt");
    expect(await screen.findByTestId("wizard-pick-adopt")).toBeInTheDocument();
  });

  // @covers FR-01.51
  it("/wizard/grade lands inside the grade flow at step 1", async () => {
    renderAt("/wizard/grade");
    expect(await screen.findByTestId("wizard-pick-grade")).toBeInTheDocument();
  });

  // @covers FR-01.51 — an unknown segment falls back to the picker (null door).
  it("an unknown /wizard/:door segment falls back to the picker", async () => {
    renderAt("/wizard/bogus");
    await waitFor(() => expect(screen.getByTestId("wizard-door-new")).not.toBeDisabled());
    expect(screen.getByTestId("wizard-door-picker")).toBeInTheDocument();
  });
});
