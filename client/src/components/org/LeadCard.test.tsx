/*
 * LeadCard.test.tsx — iterate spec AC-2/AC-3/AC-4/AC-5 component tests:
 * fixed five-block order (via `data-block`, never a snapshot), the
 * not-measured contract, the usage-fills-budget-and-runs behavior with a
 * non-7 `windowDays` fixture, and the disabled pause switch issuing no
 * network request.
 */
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { LeadCard } from "./LeadCard";
import type { LeadRosterEntry } from "../../lib/orgApi";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const UNMEASURED_LEAD: LeadRosterEntry = {
  leadId: "acme-lead",
  domain: "acme",
  name: "Acme Lead",
  reportsTo: null,
  role: { measured: false },
  now: { state: "not-measured" },
  cadence: { measured: false },
  usage: { leadId: "acme-lead", measured: false },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeadCard — block order (AC-2)", () => {
  it("renders the five blocks in the fixed order: header, role, now, stats, docs", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <LeadCard lead={UNMEASURED_LEAD} />
      </Wrapper>,
    );
    const card = screen.getByTestId("lead-card");
    const blocks = Array.from(card.querySelectorAll("[data-block]")).map((el) =>
      el.getAttribute("data-block"),
    );
    expect(blocks).toEqual(["header", "role", "now", "stats", "docs"]);
  });
});

describe("LeadCard — not-measured contract (AC-3)", () => {
  it("every unmeasured figure renders the literal text 'not measured', never blank/zero/dash", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <LeadCard lead={UNMEASURED_LEAD} />
      </Wrapper>,
    );
    expect(screen.getByTestId("lead-card-role")).toHaveTextContent("not measured");
    expect(screen.getByTestId("lead-now-unmeasured")).toHaveTextContent("not measured");
    const stats = screen.getByTestId("lead-card-stats");
    // Cadence, Parallel, budget, Projects, Runs — all five figures unmeasured.
    expect(stats.textContent?.match(/not measured/g)).toHaveLength(5);
  });

  it("`parallel` and `projects` stay 'not measured' even with usage data (permanent gap, not a bug)", () => {
    const Wrapper = makeWrapper();
    const lead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: {
        leadId: "acme-lead",
        measured: true,
        costUsd: 12.5,
        runCount: 4,
        windowDays: 30,
        asOf: "2026-08-01T00:00:00Z",
      },
    };
    render(
      <Wrapper>
        <LeadCard lead={lead} />
      </Wrapper>,
    );
    const stats = screen.getByTestId("lead-card-stats");
    // Budget + Runs are now measured; Cadence, Parallel, Projects stay unmeasured.
    expect(stats.textContent?.match(/not measured/g)).toHaveLength(3);
  });
});

describe("LeadCard — Now block renders relative time, not an absolute timestamp", () => {
  it("a resting lead with a measured last run reads 'Last active {relative time}', per the spec's Now contract (external-review fix)", () => {
    const Wrapper = makeWrapper();
    const lead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      now: {
        state: "resting",
        lastRun: { measured: true, lastRunAt: new Date(Date.now() - 5 * 60_000).toISOString() },
      },
    };
    render(
      <Wrapper>
        <LeadCard lead={lead} />
      </Wrapper>,
    );
    const nowLine = screen.getByTestId("lead-now-resting");
    expect(nowLine).toHaveTextContent(/Last active \d+m ago/);
    // Never an absolute locale timestamp (the bug this test guards against).
    expect(nowLine.textContent).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  });
});

describe("LeadCard — usage fills budget and runs (AC-4)", () => {
  it("derives the budget label from windowDays and never hardcodes 7", () => {
    const Wrapper = makeWrapper();
    const lead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: {
        leadId: "acme-lead",
        measured: true,
        costUsd: 42.75,
        runCount: 9,
        windowDays: 30,
        asOf: "2026-08-01T00:00:00Z",
      },
    };
    render(
      <Wrapper>
        <LeadCard lead={lead} />
      </Wrapper>,
    );
    const stats = screen.getByTestId("lead-card-stats");
    expect(stats.textContent).toContain("30-day budget");
    expect(stats.textContent).not.toContain("7-day budget");
    expect(stats.textContent).toContain("$42.75");
    expect(stats.textContent).toContain("9");
  });
});

describe("LeadCard — disabled pause switch (AC-5)", () => {
  it("renders disabled with a stated reason and issues no network request on click", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <LeadCard lead={UNMEASURED_LEAD} />
      </Wrapper>,
    );
    const pauseSwitch = screen.getByTestId("lead-pause-switch");
    expect(pauseSwitch).toBeDisabled();
    expect(pauseSwitch).toHaveAttribute("title", "Pause — no route exists yet");
    fireEvent.click(pauseSwitch);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
