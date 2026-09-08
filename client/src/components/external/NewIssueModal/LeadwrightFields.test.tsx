/*
 * LeadwrightFields.test.tsx — the org-chart-presence gate on
 * `LeadwrightFieldsFragment` (iterate-2026-09-09-leadwright-gate-org-
 * presence). Mirrors CommandCenter.test.tsx's approach: mock
 * `useOrgChartPresence` directly so all 4 states are exercised
 * synchronously without a real fetch (the hook itself is unit-tested in
 * `hooks/useOrgChartPresence.test.ts`). `useDomainVocabulary` is mocked
 * too, since this fragment doesn't need a real React Query round trip to
 * prove the presence gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LeadwrightFieldsFragment, type LeadwrightFieldsProps } from "./LeadwrightFields";
import { useOrgChartPresence } from "../../../hooks/useOrgChartPresence";
import { useDomainVocabulary } from "../../../hooks/useDomainVocabulary";

vi.mock("../../../hooks/useOrgChartPresence");
vi.mock("../../../hooks/useDomainVocabulary");

const mockedPresence = vi.mocked(useOrgChartPresence);
const mockedDomainVocabulary = vi.mocked(useDomainVocabulary);

function baseProps(): LeadwrightFieldsProps {
  return {
    showLeadDomain: true,
    showLeadPriority: false,
    showLeadComplexityHint: false,
    showLeadTags: false,
    showLeadBlockedBy: false,
    leadDomain: "",
    setLeadDomain: vi.fn(),
    leadPriority: "",
    setLeadPriority: vi.fn(),
    leadComplexityHint: "",
    setLeadComplexityHint: vi.fn(),
    leadTagsRaw: "",
    setLeadTagsRaw: vi.fn(),
    leadBlockedByRaw: "",
    setLeadBlockedByRaw: vi.fn(),
  };
}

beforeEach(() => {
  mockedDomainVocabulary.mockReturnValue({
    data: { domains: [], unclaimedCounts: {} },
    isError: false,
  } as unknown as ReturnType<typeof useDomainVocabulary>);
});

afterEach(() => {
  cleanup();
  // resetAllMocks (not clearAllMocks) so a stray mockReturnValue from one
  // test can't leak into the next test's implementation (external review
  // finding, iterate-2026-09-09-leadwright-gate-org-presence).
  vi.resetAllMocks();
});

// @covers FR-04.11
describe("LeadwrightFieldsFragment — org-chart presence gate", () => {
  it("hides the fields on a confirmed absent org chart (no leads installed)", () => {
    mockedPresence.mockReturnValue("absent");
    render(<LeadwrightFieldsFragment {...baseProps()} />);
    expect(screen.queryByTestId("new-issue-lead-fields")).toBeNull();
  });

  it("still renders the fields while presence is loading", () => {
    mockedPresence.mockReturnValue("loading");
    render(<LeadwrightFieldsFragment {...baseProps()} />);
    expect(screen.getByTestId("new-issue-lead-fields")).toBeInTheDocument();
  });

  it("still renders the fields when presence is broken (e.g. a 502, not absent)", () => {
    mockedPresence.mockReturnValue("broken");
    render(<LeadwrightFieldsFragment {...baseProps()} />);
    expect(screen.getByTestId("new-issue-lead-fields")).toBeInTheDocument();
  });

  it("renders the fields once the org chart is present", () => {
    mockedPresence.mockReturnValue("present");
    render(<LeadwrightFieldsFragment {...baseProps()} />);
    expect(screen.getByTestId("new-issue-lead-fields")).toBeInTheDocument();
  });
});
