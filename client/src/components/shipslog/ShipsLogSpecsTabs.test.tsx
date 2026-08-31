/*
 * ShipsLogSpecsTabs (iterate-2026-08-31-shipslog-documents-panel) — Radix
 * Tabs keyboard nav (Requirements/Iterate) + the Iterate tab's client-side
 * search filter, with an accessible (visually-hidden) label on the input.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { ShipsLogSpecsTabs } from "./ShipsLogSpecsTabs";
import type { ShipsLogDocRow } from "../../lib/shipsLogDocsApi";

const REQUIREMENTS: ShipsLogDocRow[] = [
  { path: ".shipwright/planning/01-adopted/spec.md", label: "01 — Adopted", when: "2026-08-29T00:00:00.000Z" },
];
const ITERATE: ShipsLogDocRow[] = [
  { path: ".shipwright/planning/iterate/2026-08-30-triage.md", label: "2026-08-30-triage.md", when: "2026-08-30T00:00:00.000Z" },
  { path: ".shipwright/planning/iterate/2026-08-01-org-page.md", label: "2026-08-01-org-page.md", when: "2026-08-01T00:00:00.000Z" },
];

describe("ShipsLogSpecsTabs", () => {
  it("defaults to the Requirements tab", () => {
    render(<ShipsLogSpecsTabs requirements={REQUIREMENTS} iterateSpecs={ITERATE} onOpen={vi.fn()} />);
    expect(screen.getByTestId("shipslog-specs-tab-requirements")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("01 — Adopted")).toBeTruthy();
    expect(screen.queryByText("2026-08-30-triage.md")).toBeNull();
  });

  it("switching to Iterate shows the mini-spec rows and a labeled search input", async () => {
    const user = userEvent.setup();
    render(<ShipsLogSpecsTabs requirements={REQUIREMENTS} iterateSpecs={ITERATE} onOpen={vi.fn()} />);
    await user.click(screen.getByTestId("shipslog-specs-tab-iterate"));
    expect(screen.getByText("2026-08-30-triage.md")).toBeTruthy();
    expect(screen.getByText("2026-08-01-org-page.md")).toBeTruthy();
    // Accessible name comes from the associated <label>, not a bare placeholder.
    expect(screen.getByLabelText("Search iterate specs")).toBeTruthy();
  });

  it("search filters the Iterate list by filename substring, case-insensitive", async () => {
    const user = userEvent.setup();
    render(<ShipsLogSpecsTabs requirements={REQUIREMENTS} iterateSpecs={ITERATE} onOpen={vi.fn()} />);
    await user.click(screen.getByTestId("shipslog-specs-tab-iterate"));
    fireEvent.change(screen.getByTestId("shipslog-iterate-search"), { target: { value: "TRIAGE" } });
    expect(screen.getByText("2026-08-30-triage.md")).toBeTruthy();
    expect(screen.queryByText("2026-08-01-org-page.md")).toBeNull();
  });

  it("calls onOpen with the clicked row's path", () => {
    const onOpen = vi.fn();
    render(<ShipsLogSpecsTabs requirements={REQUIREMENTS} iterateSpecs={ITERATE} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("shipslog-doc-.shipwright/planning/01-adopted/spec.md"));
    expect(onOpen).toHaveBeenCalledWith(".shipwright/planning/01-adopted/spec.md");
  });
});
