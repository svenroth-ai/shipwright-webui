/*
 * ProjectFilterDropdown width (iterate-2026-06-15 phone-header-polish #3).
 * The phone top-bar `fluid` variant must size to content (capped at 60vw +
 * truncate), NOT span the full bar width; the default keeps its 220px floor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ProjectFilterDropdown } from "./ProjectFilterDropdown";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  // Unseeded project/task queries would hit fetch — stall them so the trigger
  // renders with its default ("All projects") label and no rejection escapes.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

function renderDropdown(props: { fluid?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProjectFilterDropdown {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByTestId("project-filter-dropdown");
}

describe("ProjectFilterDropdown width (#3)", () => {
  it("fluid: content-width capped at 60vw + min-w-0, not full-width", () => {
    const btn = renderDropdown({ fluid: true });
    expect(btn.className).toContain("max-w-[60vw]");
    expect(btn.className).toContain("min-w-0");
    expect(btn.className).not.toContain("w-full");
    expect(btn.className).not.toContain("min-w-[220px]");
  });

  it("default (non-fluid): keeps the 220px min-width floor", () => {
    const btn = renderDropdown();
    expect(btn.className).toContain("min-w-[220px]");
    expect(btn.className).not.toContain("max-w-[60vw]");
  });
});
