/*
 * ShipsLogDocList (iterate-2026-08-31-shipslog-documents-panel) — honest
 * empty state, one row per doc with date + label, click calls onOpen(path).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { ShipsLogDocList, fmtDocDate } from "./ShipsLogDocList";
import type { ShipsLogDocRow } from "../../lib/shipsLogDocsApi";

describe("fmtDocDate", () => {
  it("formats an ISO ts as short month + day", () => {
    expect(fmtDocDate("2026-08-29T00:00:00.000Z")).toBe("Aug 29");
  });
  it("renders — for null/unparseable", () => {
    expect(fmtDocDate(null)).toBe("—");
    expect(fmtDocDate("not-a-date")).toBe("—");
  });
});

describe("ShipsLogDocList", () => {
  it("shows the empty label when there are no rows", () => {
    render(<ShipsLogDocList rows={[]} emptyLabel="Nothing here." onOpen={vi.fn()} />);
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });

  it("renders one row per doc with its label and date", () => {
    const rows: ShipsLogDocRow[] = [
      { path: ".shipwright/agent_docs/architecture.md", label: "Architecture", when: "2026-08-29T00:00:00.000Z" },
      { path: ".shipwright/agent_docs/decision_log.md", label: "Decision Log", when: null },
    ];
    render(<ShipsLogDocList rows={rows} emptyLabel="—" onOpen={vi.fn()} />);
    expect(screen.getByText("Architecture")).toBeTruthy();
    expect(screen.getByText("Decision Log")).toBeTruthy();
    expect(screen.getByText("Aug 29")).toBeTruthy();
  });

  it("calls onOpen with the row's path when clicked", () => {
    const onOpen = vi.fn();
    const rows: ShipsLogDocRow[] = [
      { path: ".shipwright/compliance/dashboard.md", label: "Dashboard", when: "2026-08-27T00:00:00.000Z" },
    ];
    render(<ShipsLogDocList rows={rows} emptyLabel="—" onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("shipslog-doc-.shipwright/compliance/dashboard.md"));
    expect(onOpen).toHaveBeenCalledWith(".shipwright/compliance/dashboard.md");
  });
});
