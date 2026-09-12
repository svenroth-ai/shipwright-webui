import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { TriageFilterSortBar } from "./TriageFilterSortBar";
import { DEFAULT_FILTER_STATE, DEFAULT_SORT_STATE } from "../../lib/triageFilterSort";
import type { TriageViewState } from "../../hooks/useTriageViewState";
import { PHONE_MEDIA_QUERY } from "../../hooks/useIsCompactViewport";

// iterate-2026-09-12-mobile-triage-form-layout — same matchMedia-mock
// convention as TaskDescriptionDisclosure.test.tsx.
const originalMatchMedia = window.matchMedia;

function setPhone(phone: boolean) {
  // External code review (glm) finding: matching a hardcoded query string
  // literal decouples silently from the hook if its query ever changes —
  // the phone branch would then never fire while this mock still reports
  // `matches: true`. Import the hook's own constant instead.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === PHONE_MEDIA_QUERY ? phone : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

function makeView(overrides: Partial<TriageViewState> = {}): TriageViewState {
  return {
    filters: DEFAULT_FILTER_STATE,
    sort: DEFAULT_SORT_STATE,
    togglePriority: vi.fn(),
    toggleDomain: vi.fn(),
    toggleComplexity: vi.fn(),
    setShowParked: vi.fn(),
    clearFilters: vi.fn(),
    setPrimarySort: vi.fn(),
    setSecondarySort: vi.fn(),
    ...overrides,
  };
}

describe("TriageFilterSortBar", () => {
  it("renders all four filter groups including Complexity, always visible", () => {
    render(<TriageFilterSortBar view={makeView()} availableDomains={["engineering"]} />);
    expect(screen.getByTestId("triage-filter-priority-group")).toBeInTheDocument();
    expect(screen.getByTestId("triage-filter-domain-group")).toBeInTheDocument();
    // AC3 / operator decision: Complexity stays visible even with zero populated data.
    expect(screen.getByTestId("triage-filter-complexity-group")).toBeInTheDocument();
    expect(screen.getByTestId("triage-filter-complexity-unset")).toBeInTheDocument();
    expect(screen.getByTestId("triage-filter-parked-group")).toBeInTheDocument();
  });

  it("renders domain options from availableDomains", () => {
    render(<TriageFilterSortBar view={makeView()} availableDomains={["engineering", "security"]} />);
    expect(screen.getByTestId("triage-filter-domain-engineering")).toBeInTheDocument();
    expect(screen.getByTestId("triage-filter-domain-security")).toBeInTheDocument();
  });

  it("renders both sort levels", () => {
    render(<TriageFilterSortBar view={makeView()} availableDomains={[]} />);
    expect(screen.getByTestId("triage-sort-primary-group")).toBeInTheDocument();
    expect(screen.getByTestId("triage-sort-secondary-group")).toBeInTheDocument();
  });

  it("wires distinct ariaLabel props into the two sort levels — nothing regresses to the shared default (re-review finding NEW-4: the per-level unit test alone didn't prove this bar actually passes them)", () => {
    render(<TriageFilterSortBar view={makeView()} availableDomains={[]} />);
    expect(screen.getByTestId("triage-sort-primary-key")).toHaveAttribute(
      "aria-label",
      "Primary — Sort open items sort key",
    );
    expect(screen.getByTestId("triage-sort-secondary-key")).toHaveAttribute(
      "aria-label",
      "Secondary — then sort key",
    );
  });

  it("Parked toggle calls setShowParked with the flipped value", () => {
    const setShowParked = vi.fn();
    render(<TriageFilterSortBar view={makeView({ setShowParked })} availableDomains={[]} />);
    fireEvent.click(screen.getByTestId("triage-filter-parked-parked"));
    expect(setShowParked).toHaveBeenCalledWith(true);
  });

  it("Parked toggle reflects the current showParked state", () => {
    const filters = { ...DEFAULT_FILTER_STATE, showParked: true };
    render(<TriageFilterSortBar view={makeView({ filters })} availableDomains={[]} />);
    expect(screen.getByTestId("triage-filter-parked-parked")).toHaveAttribute("aria-pressed", "true");
  });

  // AC1/AC3: filters are EXCLUDE sets — every chip starts active
  // (aria-pressed=true, nothing excluded yet), and only the value the
  // operator has explicitly excluded un-highlights. Rejected at
  // spec-reviewer Stage 1 when the first build shipped the inverse
  // (nothing highlighted until clicked, an include-by-selection model).
  it("AC1/AC3: every Priority and Complexity chip is active by default (nothing excluded)", () => {
    render(<TriageFilterSortBar view={makeView()} availableDomains={[]} />);
    for (const p of ["P0", "P1", "P2", "P3"]) {
      expect(screen.getByTestId(`triage-filter-priority-${p}`)).toHaveAttribute("aria-pressed", "true");
    }
    for (const c of ["small", "medium", "large", "unset"]) {
      expect(screen.getByTestId(`triage-filter-complexity-${c}`)).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("AC2: every Domain chip is active by default (nothing excluded)", () => {
    render(<TriageFilterSortBar view={makeView()} availableDomains={["engineering", "security"]} />);
    expect(screen.getByTestId("triage-filter-domain-engineering")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("triage-filter-domain-security")).toHaveAttribute("aria-pressed", "true");
  });

  it("AC1: an excluded priority renders un-highlighted while its siblings stay active", () => {
    const filters = { ...DEFAULT_FILTER_STATE, excludedPriorities: new Set(["P3" as const]) };
    render(<TriageFilterSortBar view={makeView({ filters })} availableDomains={[]} />);
    expect(screen.getByTestId("triage-filter-priority-P3")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("triage-filter-priority-P0")).toHaveAttribute("aria-pressed", "true");
  });

  it("AC1: clicking an active Priority chip calls togglePriority with that value (excludes it)", () => {
    const togglePriority = vi.fn();
    render(<TriageFilterSortBar view={makeView({ togglePriority })} availableDomains={[]} />);
    fireEvent.click(screen.getByTestId("triage-filter-priority-P3"));
    expect(togglePriority).toHaveBeenCalledWith("P3");
  });

  describe("phone collapse (iterate-2026-09-12-mobile-triage-form-layout, AC4)", () => {
    it("desktop/tablet (>=768px): no toggle renders, content always visible", () => {
      setPhone(false);
      render(<TriageFilterSortBar view={makeView()} availableDomains={[]} />);
      expect(screen.queryByTestId("triage-filter-sort-toggle")).not.toBeInTheDocument();
      expect(screen.getByTestId("triage-filter-priority-group")).toBeInTheDocument();
      expect(screen.getByTestId("triage-sort-primary-group")).toBeInTheDocument();
    });

    it("phone (<768px): toggle renders, content collapsed on first render", () => {
      setPhone(true);
      render(<TriageFilterSortBar view={makeView()} availableDomains={[]} />);
      const toggle = screen.getByTestId("triage-filter-sort-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("triage-filter-priority-group")).not.toBeInTheDocument();
      expect(screen.queryByTestId("triage-sort-primary-group")).not.toBeInTheDocument();
    });

    it("phone: clicking the toggle expands the filter/sort content", () => {
      setPhone(true);
      render(<TriageFilterSortBar view={makeView()} availableDomains={[]} />);
      fireEvent.click(screen.getByTestId("triage-filter-sort-toggle"));
      expect(screen.getByTestId("triage-filter-sort-toggle")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByTestId("triage-filter-priority-group")).toBeInTheDocument();
      expect(screen.getByTestId("triage-sort-primary-group")).toBeInTheDocument();
    });
  });
});
