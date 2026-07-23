/*
 * FirstContact — the dedicated first-run hero (iterate-2026-07-23-first-contact-
 * hero, FR-01.51 delta). The hero-framed presentation of the SAME three-door
 * picker + readiness gate the wizard uses. These tests prove: the welcome copy
 * renders, the doors deep-link into the wizard flow, the readiness gate makes the
 * doors inert when not ready, and the hero renders its complete final state under
 * prefers-reduced-motion (content is never hidden-then-revealed — CLAUDE.md A20).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import FirstContact from "./FirstContact";
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

function mockReadiness(report: Record<string, unknown>) {
  server.use(http.get("/api/readiness", () => HttpResponse.json(report)));
}

let currentLocation = "";
function LocationEcho() {
  const l = useLocation();
  currentLocation = l.pathname + l.search;
  return null;
}

function renderFirstContact() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/first-contact"]}>
        <FirstContact />
        <LocationEcho />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function doorsReady() {
  await waitFor(() => expect(screen.getByTestId("wizard-door-new")).not.toBeDisabled());
}

afterEach(() => cleanup());

describe("FirstContact — the hero", () => {
  beforeEach(() => mockReadiness(READY));

  // @covers FR-01.51
  it("renders the lighthouse-hero welcome copy + the three canonical doors", async () => {
    renderFirstContact();
    expect(screen.getByTestId("first-contact")).toBeInTheDocument();
    expect(screen.getByText("Welcome to the Command Center")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /Say what you want\.\s*A competent room takes it from here\./,
    );
    // The lead promise — locked so a silent copy drift from the SSoT is caught.
    expect(screen.getByText(/You describe the change in normal words\./)).toBeInTheDocument();
    expect(screen.getByText(/You keep control — and the proof\./)).toBeInTheDocument();
    await doorsReady();
    expect(screen.getByTestId("wizard-door-new")).toHaveTextContent("Build something new");
    expect(screen.getByTestId("wizard-door-adopt")).toHaveTextContent(
      "Bring Shipwright to an existing repo",
    );
    expect(screen.getByTestId("wizard-door-grade")).toHaveTextContent("Grade your repo");
    expect(screen.getByTestId("wizard-add-existing")).toHaveTextContent("Register a project manually");
  });

  // @covers FR-01.51 — the doors DEEP-LINK into the wizard flow (Rule 1: navigate only).
  it.each([
    ["new", "/wizard"],
    ["adopt", "/wizard/adopt"],
    ["grade", "/wizard/grade"],
  ])("the %s door navigates to %s", async (door, route) => {
    renderFirstContact();
    await doorsReady();
    fireEvent.click(screen.getByTestId(`wizard-door-${door}`));
    await waitFor(() => expect(currentLocation).toBe(route));
  });

  // @covers FR-01.51 — the register-manually line reuses the wizard escape hatch.
  it("the register-manually line deep-links to /projects?new=1", async () => {
    renderFirstContact();
    await doorsReady();
    fireEvent.click(screen.getByTestId("wizard-add-existing"));
    await waitFor(() => expect(currentLocation).toBe("/projects?new=1"));
  });

  // @covers FR-01.51 — the readiness GATE is reused, not rebuilt.
  it("when NOT ready the doors are inert and the gate names the fix", async () => {
    mockReadiness({
      ready: false,
      repairCommand: "npx @svenroth-ai/shipwright@latest",
      checks: [
        { key: "uv", label: "uv", ok: false, detail: "not found", why: "every plugin hook runs through it", critical: true },
      ],
    });
    renderFirstContact();
    await screen.findByTestId("readiness-not-ready");
    expect(screen.getByTestId("wizard-door-new")).toBeDisabled();
    expect(screen.getByTestId("wizard-door-grade")).toBeDisabled();
    expect(screen.getByTestId("readiness-repair-command")).toHaveTextContent(
      "npx @svenroth-ai/shipwright@latest",
    );
  });
});

describe("FirstContact — reduced motion (A20)", () => {
  beforeEach(() => mockReadiness(READY));

  // @covers FR-01.51 — under prefers-reduced-motion the hero is COMPLETE + opaque:
  // no content is hidden-then-revealed. FirstContact ships with no entrance motion,
  // so its content presence must not depend on any animation running.
  it("renders the complete hero even when reduced motion is preferred", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      renderFirstContact();
      expect(screen.getByText("Welcome to the Command Center")).toBeVisible();
      expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
      await doorsReady();
      expect(screen.getByTestId("wizard-door-new")).toBeVisible();
      expect(screen.getByTestId("wizard-door-adopt")).toBeVisible();
      expect(screen.getByTestId("wizard-door-grade")).toBeVisible();
    } finally {
      window.matchMedia = original;
    }
  });
});
