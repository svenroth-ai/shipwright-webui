/*
 * LeadCard.usage-consumed.test.tsx — FR-04.30 display-half AC tests, split
 * out of LeadCard.test.tsx to keep that file under the 300-line convention.
 * Covers: no "budget" wording, the un-quantified subagent-spend-gap note,
 * unpricedCallsTotal visibility, the no-data/partial/complete distinction,
 * costUsd: 0 as a real value, and backward compatibility with a payload
 * that lacks the two new optional fields.
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

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

describe("LeadCard — consumed-spend label + gap disclosure (FR-04.30)", () => {
  const BASE_USAGE = {
    leadId: "acme-lead",
    measured: true as const,
    costUsd: 12.5,
    runCount: 4,
    windowDays: 7,
  };

  it("never renders the word 'budget' anywhere on the card, measured or not", () => {
    const Wrapper = makeWrapper();
    const { rerender } = render(
      <Wrapper>
        <LeadCard lead={UNMEASURED_LEAD} />
      </Wrapper>,
    );
    expect(screen.getByTestId("lead-card").textContent?.toLowerCase()).not.toContain("budget");

    const measuredLead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, asOf: "2026-08-01T00:00:00Z" },
    };
    rerender(
      <Wrapper>
        <LeadCard lead={measuredLead} />
      </Wrapper>,
    );
    expect(screen.getByTestId("lead-card").textContent?.toLowerCase()).not.toContain("budget");
  });

  it("names the un-counted subagent-spend gap without putting a number on it", () => {
    const Wrapper = makeWrapper();
    const lead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, asOf: "2026-08-01T00:00:00Z" },
    };
    render(
      <Wrapper>
        <LeadCard lead={lead} />
      </Wrapper>,
    );
    const note = screen.getByTestId("lead-usage-note");
    expect(note).toHaveTextContent(/subagent spend/i);
    // No count/number attached to the subagent-spend clause itself.
    expect(note.textContent).not.toMatch(/\d+\s*(subagent|call)/i);
  });

  it("shows unpricedCallsTotal when > 0, and shows nothing extra when it's 0", () => {
    const Wrapper = makeWrapper();
    const leadWithUnpriced: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, asOf: "2026-08-01T00:00:00Z", unpricedCallsTotal: 3 },
    };
    const { rerender } = render(
      <Wrapper>
        <LeadCard lead={leadWithUnpriced} />
      </Wrapper>,
    );
    expect(screen.getByTestId("lead-usage-note")).toHaveTextContent("3 unpriced calls");

    const leadWithZeroUnpriced: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, asOf: "2026-08-01T00:00:00Z", unpricedCallsTotal: 0 },
    };
    rerender(
      <Wrapper>
        <LeadCard lead={leadWithZeroUnpriced} />
      </Wrapper>,
    );
    expect(screen.getByTestId("lead-usage-note").textContent).not.toMatch(/unpriced/i);
  });

  it("distinguishes no-data, partial, and complete measurement states", () => {
    const Wrapper = makeWrapper();

    // No data — measured: false.
    const { rerender } = render(
      <Wrapper>
        <LeadCard lead={UNMEASURED_LEAD} />
      </Wrapper>,
    );
    let stats = screen.getByTestId("lead-card-stats");
    expect(stats.textContent).toContain("not measured");
    expect(screen.queryByTestId("lead-usage-note")).toBeNull();

    // Partial — measured: true, anyNotMeasured: true.
    const partialLead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, asOf: "2026-08-01T00:00:00Z", anyNotMeasured: true },
    };
    rerender(
      <Wrapper>
        <LeadCard lead={partialLead} />
      </Wrapper>,
    );
    stats = screen.getByTestId("lead-card-stats");
    expect(stats.textContent).toContain("$12.50 (partial)");
    expect(screen.getByTestId("lead-usage-note")).toHaveTextContent(/partial/i);

    // Complete — measured: true, no anyNotMeasured.
    const completeLead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, asOf: "2026-08-01T00:00:00Z" },
    };
    rerender(
      <Wrapper>
        <LeadCard lead={completeLead} />
      </Wrapper>,
    );
    stats = screen.getByTestId("lead-card-stats");
    expect(stats.textContent).toContain("$12.50");
    expect(stats.textContent).not.toContain("(partial)");
    expect(screen.getByTestId("lead-usage-note").textContent).not.toMatch(/partial/i);
  });

  it("renders costUsd: 0 on a measured window as a real zero, never as 'not measured'", () => {
    const Wrapper = makeWrapper();
    const lead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, costUsd: 0, asOf: "2026-08-01T00:00:00Z" },
    };
    render(
      <Wrapper>
        <LeadCard lead={lead} />
      </Wrapper>,
    );
    const stats = screen.getByTestId("lead-card-stats");
    expect(stats.textContent).toContain("$0.00");
    // Only the other 3 permanently-unmeasured stats (Cadence, Parallel, Projects) say "not measured".
    expect(stats.textContent?.match(/not measured/g)).toHaveLength(3);
  });

  it("still renders correctly when the payload lacks the two new optional fields (older producer)", () => {
    const Wrapper = makeWrapper();
    const lead: LeadRosterEntry = {
      ...UNMEASURED_LEAD,
      usage: { ...BASE_USAGE, asOf: "2026-08-01T00:00:00Z" },
    };
    render(
      <Wrapper>
        <LeadCard lead={lead} />
      </Wrapper>,
    );
    expect(screen.getByTestId("lead-card-stats").textContent).toContain("$12.50");
    expect(screen.getByTestId("lead-usage-note")).toHaveTextContent("Excludes subagent spend");
  });
});
