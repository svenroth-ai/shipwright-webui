/*
 * CommandCenter.test.tsx — FR-01.71's SECOND nav-presence call site (the
 * palette's "Open Org" command). SidebarNav.test.tsx covers the sidebar call
 * site; this covers CommandCenter's `getNavDestinations().filter((d) =>
 * d.id !== "org" || orgPresence !== "absent")` predicate directly, mocking
 * `useOrgChartPresence` so all 4 states are exercised synchronously without
 * a real fetch (the hook itself is unit-tested in
 * `hooks/useOrgChartPresence.test.ts`).
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { CommandCenter } from "./CommandCenter";
import { useOrgChartPresence } from "../../hooks/useOrgChartPresence";

vi.mock("../../hooks/useOrgChartPresence");
vi.mock("../../hooks/useProjects", () => ({
  useProjects: () => ({ data: [] }),
}));

const mockedPresence = vi.mocked(useOrgChartPresence);

function renderCenter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CommandCenter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Ctrl+K is the palette-open chord (useKeyboardMap). */
function openPalette() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommandCenter — Org command palette entry (FR-01.71, both call sites)", () => {
  it("shows 'Open Org' while presence is still loading (only 'absent' hides it)", () => {
    mockedPresence.mockReturnValue("loading");
    renderCenter();
    openPalette();
    expect(screen.getByTestId("command-item-open:org")).toBeInTheDocument();
  });

  it("hides 'Open Org' on a confirmed absent (AC-6a)", () => {
    mockedPresence.mockReturnValue("absent");
    renderCenter();
    openPalette();
    expect(screen.queryByTestId("command-item-open:org")).toBeNull();
  });

  it("shows 'Open Org' once present (200)", () => {
    mockedPresence.mockReturnValue("present");
    renderCenter();
    openPalette();
    expect(screen.getByTestId("command-item-open:org")).toBeInTheDocument();
  });

  it("still shows 'Open Org' when broken (502/network error, not absent) — AC-7", () => {
    mockedPresence.mockReturnValue("broken");
    renderCenter();
    openPalette();
    expect(screen.getByTestId("command-item-open:org")).toBeInTheDocument();
  });
});
